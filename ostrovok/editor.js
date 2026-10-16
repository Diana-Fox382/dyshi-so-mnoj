/* Островок: редактор.
   Открывается, если в конце адреса страницы дописать #edit. Гости его не видят и без ключа ничего изменить не могут.
   Всё, что сделано в редакторе, уходит на GitHub одним коммитом: новые картинки и видео в папку media,
   расположение плеера и список видео в data.json. Через минуту-две GitHub Pages показывает это всем. */
(() => {
"use strict";
const I = window.Island;
if (!I || I.editing) return;
I.editing = true;
document.documentElement.classList.add("editing");

const $ = s => document.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const btn = (cls, txt, fn) => { const b = el("button", cls, txt); b.type = "button"; if (fn) b.addEventListener("click", fn); return b; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r5 = v => Math.round(v * 1e5) / 1e5;
const MB = n => (n / 1048576).toFixed(n < 10485760 ? 1 : 0).replace(".", ",") + " МБ";

// ---------- where the site lives on GitHub ----------
const LIVE = /\.github\.io$/i.test(location.hostname);
const REPO = (() => {
  const d = {owner: "Diana-Fox382", repo: "dyshi-so-mnoj", branch: "main", dir: "ostrovok"};
  if (!LIVE) return d;
  const host = location.hostname.toLowerCase(), parts = location.pathname.split("/").filter(Boolean);
  if (parts.length && /\.html?$/i.test(parts[parts.length - 1])) parts.pop();
  d.owner = host.slice(0, -".github.io".length);
  if (parts.length >= 2) { d.repo = decodeURIComponent(parts[0]); d.dir = parts.slice(1).map(decodeURIComponent).join("/"); }
  else if (parts.length === 1) { d.repo = host; d.dir = decodeURIComponent(parts[0]); }
  return d;
})();
const API = "https://api.github.com";
const MAX_IMG = 2000;                 // the long side of a picture after upload, px
const VIDEO_SOFT = 25 * 1048576;      // above this a video loads slowly on a weak connection
const VIDEO_HARD = 95 * 1048576;      // GitHub does not take files of 100 MB and more

// ---------- state ----------
const KEY = "ostrovok-key";
const E = {
  key: (() => { try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; } })(),
  dirty: false, saving: false, busy: 0,
  files: new Map(),   // path in the folder -> Blob waiting to be uploaded
  urls: new Map(),    // path -> object URL, so new files show before they are on the site
  removed: new Set(), // files to delete from the repository on save
  sent: new Map(),    // path -> sha of a blob already uploaded (a retry does not upload twice)
  baseSha: null,      // data.json as it was when the editor opened, to notice changes from another device
  lock: null,         // keeps the screen's shape while dragging a corner (width / height in px)
  toolsFor: ""
};
const baseUrl = I.url;
I.url = p => E.urls.get(p) || baseUrl(p);
let readyDone = false, readyResolve;
const ready = new Promise(r => { readyResolve = r; });
const storeKey = k => { E.key = k; try { k ? localStorage.setItem(KEY, k) : localStorage.removeItem(KEY); } catch (e) {} };

// ---------- styles ----------
const css = el("style");
css.textContent = `
html.editing body{padding-bottom:150px}
html.editing .page{overflow-x:hidden;overflow-x:clip}
.ed-bar{position:fixed;left:0;right:0;bottom:0;z-index:25;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px;padding:10px max(14px,env(safe-area-inset-right,0px)) max(10px,env(safe-area-inset-bottom,0px)) max(14px,env(safe-area-inset-left,0px));background:rgba(30,21,14,.95);border-top:1px solid var(--line2);box-shadow:0 -10px 40px rgba(0,0,0,.4);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);text-align:left}
.ed-left{display:flex;align-items:baseline;gap:10px;min-width:0;flex:1 1 230px}
.ed-badge{font-family:var(--display);font-style:italic;font-size:20px;color:var(--honey);flex:none}
.ed-status{font-size:13px;line-height:1.35;color:var(--muted);min-width:0}
.ed-status.warn{color:#f2b46e}.ed-status.err{color:#ffa08a}.ed-status.ok{color:#cfe3a6}
.ed-btns{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}
.ed-btns .soft{padding:8px 14px}
.ed-frame{position:absolute;z-index:6;transform-origin:50% 50%;touch-action:none;cursor:move;border:1.5px dashed rgba(255,232,190,.95);box-shadow:0 0 0 1px rgba(20,12,6,.6),inset 0 0 0 1px rgba(20,12,6,.6)}
.ed-frame[hidden]{display:none}
.ed-frame:focus{outline:none}
.ed-frame:focus-visible{outline:2px solid var(--honey);outline-offset:4px}
.ed-h{position:absolute;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:var(--honey);border:2px solid #2a1a0e;box-shadow:0 1px 6px rgba(0,0,0,.5);touch-action:none}
.ed-h::before,.ed-rot::before{content:"";position:absolute;inset:-12px;border-radius:50%}
.ed-h[data-h=nw]{left:0;top:0;cursor:nwse-resize}.ed-h[data-h=n]{left:50%;top:0;cursor:ns-resize}.ed-h[data-h=ne]{left:100%;top:0;cursor:nesw-resize}.ed-h[data-h=e]{left:100%;top:50%;cursor:ew-resize}
.ed-h[data-h=se]{left:100%;top:100%;cursor:nwse-resize}.ed-h[data-h=s]{left:50%;top:100%;cursor:ns-resize}.ed-h[data-h=sw]{left:0;top:100%;cursor:nesw-resize}.ed-h[data-h=w]{left:0;top:50%;cursor:ew-resize}
.ed-small .ed-h[data-h=n],.ed-small .ed-h[data-h=e],.ed-small .ed-h[data-h=s],.ed-small .ed-h[data-h=w]{display:none}
.ed-rot{position:absolute;left:50%;top:-40px;width:20px;height:20px;margin-left:-10px;border-radius:50%;background:#2a1a0e;border:2px solid var(--honey);cursor:grab;touch-action:none;box-shadow:0 1px 6px rgba(0,0,0,.5)}
.ed-rot::after{content:"";position:absolute;left:50%;top:100%;width:2px;height:20px;margin-left:-1px;background:rgba(255,232,190,.9)}
.stage.ed-dragging[data-layer=under] .art{opacity:.45!important;transition:none}
.stage.ed-phone{width:min(100%,360px)!important}
html.editing .stage.novideo .screen{background:repeating-linear-gradient(45deg,#22170f 0 12px,#1a120c 12px 24px)}
html.editing .stage.novideo .screen::before{content:"здесь будет видео";position:absolute;inset:0;display:grid;place-items:center;font-size:13px;color:var(--muted)}
.ed-tools{display:flex;flex-direction:column;gap:16px;padding:18px;border:1px dashed var(--line2);border-radius:18px;background:rgba(36,26,17,.45);text-align:left}
@media (min-width:1180px){
  html.editing .page{padding-right:372px}
  .ed-tools{position:fixed;z-index:20;right:16px;top:16px;bottom:84px;width:340px;overflow:auto;background:rgba(30,21,14,.97);border-style:solid;box-shadow:0 20px 60px rgba(0,0,0,.45)}
}
.ed-tools h3{margin:0;font-family:var(--display);font-weight:500;font-style:italic;font-size:22px;color:var(--honey)}
.ed-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.ed-lbl{width:100%;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.ed-in{font:inherit;font-size:15px;color:var(--fg);background:#1a120c;border:1px solid var(--line2);border-radius:12px;padding:9px 12px;width:100%;min-width:0}
.ed-in:focus{outline:2px solid var(--honey);outline-offset:1px;border-color:transparent}
.ed-range{flex:1;min-width:120px;margin:0;accent-color:var(--honey)}
.ed-val{font-size:13px;color:var(--soft);min-width:52px;text-align:right;font-variant-numeric:tabular-nums}
.ed-hint{margin:0;font-size:12.5px;line-height:1.5;color:var(--muted)}
.ed-hint.warn{color:#f2b46e}
.ed-danger{color:#ffb4a2!important;border-color:rgba(255,150,120,.35)!important}
.chip.ed-add{border-style:dashed;color:var(--honey)}
.ed-addcard .thumb{display:grid;place-items:center;background:rgba(36,26,17,.5);box-shadow:none;border:1.5px dashed var(--line2)}
.ed-addcard:hover .thumb{border-color:var(--glow)}
.ed-plus{font-size:34px;line-height:1;color:var(--honey)}
.ed-pen{position:absolute;right:6px;top:6px;z-index:2;width:34px;height:34px;padding:0;border-radius:50%;border:1px solid rgba(240,194,122,.5);background:rgba(23,17,12,.86);color:var(--honey);display:grid;place-items:center;cursor:pointer}
.ed-pen svg{width:16px;height:16px;display:block}
.ed-pen:focus-visible{outline:2px solid var(--honey);outline-offset:2px}
.ed-sheet{max-width:560px}
.ed-sheet video{width:100%;max-height:42vh;border-radius:12px;background:#000;display:block}
.ed-check{display:flex;align-items:center;gap:10px;font-size:15px;color:var(--fg);cursor:pointer}
.ed-check input{width:18px;height:18px;margin:0;flex:none;accent-color:var(--honey)}
.ed-steps{margin:0;padding-left:22px;display:flex;flex-direction:column;gap:8px;color:var(--soft);font-size:14px}
.ed-steps b{color:var(--fg);font-weight:600}
.ed-steps a{color:var(--honey)}
.ed-steps code{font-size:13px;color:var(--fg);background:#1a120c;border-radius:6px;padding:1px 5px;white-space:nowrap}
.ed-ask{margin:0;font-size:15px;line-height:1.55;color:var(--soft)}
.go.ed-go-danger{background:#e9a48c;box-shadow:none}
.ed-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px}
.ed-foot .go{margin-left:auto}
html.ed-drop .page{outline:2px dashed var(--honey);outline-offset:-10px;border-radius:24px}
`;
document.head.append(css);

const PEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5h4l10.2-10.2a2.8 2.8 0 0 0-4-4L4.5 15.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.5 6.5l4 4" stroke="currentColor" stroke-width="1.8"/></svg>';

// ---------- the bar at the bottom ----------
const barEl = el("div", "ed-bar");
barEl.setAttribute("role", "region"); barEl.setAttribute("aria-label", "Редактор");
const left = el("div", "ed-left"), statusEl = el("span", "ed-status");
statusEl.setAttribute("role", "status");
left.append(el("span", "ed-badge", "Редактор"), statusEl);
const keyBtn = btn("soft", "Ключ", () => openKeySheet(false));
const exitBtn = btn("soft", "Выйти", exitEditor);
const saveBtn = btn("go small", "Сохранить", save);
saveBtn.disabled = true;
const btns = el("div", "ed-btns"); btns.append(keyBtn, exitBtn, saveBtn);
keyBtn.hidden = !LIVE;
barEl.append(left, btns);
document.body.append(barEl);

function status(t, kind) { statusEl.textContent = t; statusEl.className = "ed-status" + (kind ? " " + kind : ""); }
function totals() {
  const v = I.data.videos, bytes = v.reduce((a, x) => a + (x.size || 0), 0);
  return v.length ? v.length + " видео, " + MB(bytes) : "видео пока нет";
}
function idle() {
  if (E.saving || E.busy) return;
  const bytes = I.data.videos.reduce((a, x) => a + (x.size || 0), 0) + I.data.scenes.reduce((a, x) => a + (x.bytes || 0), 0);
  const roomy = bytes > 700 * 1048576 ? " · GitHub Pages вмещает около 1 ГБ, места остаётся немного" : "";
  if (E.dirty) status("Есть несохранённые изменения · " + totals() + roomy, "warn");
  else status("Всё сохранено · " + totals() + roomy, roomy ? "warn" : "");
}
function changed() { E.dirty = true; saveBtn.disabled = E.saving; idle(); }
addEventListener("beforeunload", e => { if (E.dirty || E.saving) { e.preventDefault(); e.returnValue = ""; } });

async function exitEditor() {
  if (E.dirty && !(await ask("Выйти без сохранения?", "Несохранённые изменения пропадут.", "Выйти", "Остаться", true))) return;
  E.dirty = false;
  const q = location.search.replace(/([?&])edit(=[^&]*)?&?/, "$1").replace(/[?&]$/, "");
  history.replaceState(null, "", location.pathname + q);
  location.reload();
}

// ---------- files people pick ----------
function picker(accept, multiple, cb) {
  const i = el("input"); i.type = "file"; i.accept = accept; i.multiple = multiple; i.hidden = true;
  i.addEventListener("change", () => { const f = [...i.files]; i.value = ""; if (f.length) cb(f); });
  document.body.append(i); return i;
}
const pickScene = picker("image/*", false, f => addScene(f[0]));
const pickReplace = picker("image/*", false, f => replaceScene(f[0]));
const pickVideos = picker("video/mp4,video/*,.mp4,.m4v,.mov", true, f => addVideos(f));
function keep(path, blob) { E.files.set(path, blob); E.sent.delete(path); const old = E.urls.get(path); if (old) URL.revokeObjectURL(old); E.urls.set(path, URL.createObjectURL(blob)); }
function drop(path) {
  if (!path || path.startsWith("data:")) return;
  if (E.files.has(path)) { E.files.delete(path); E.sent.delete(path); } else E.removed.add(path);
}
// drag files onto the page: pictures become new pictures, videos are added to the list
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
document.addEventListener("dragenter", e => { if (!hasFiles(e)) return; dragDepth++; document.documentElement.classList.add("ed-drop"); });
document.addEventListener("dragleave", e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; document.documentElement.classList.remove("ed-drop"); } });
document.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
document.addEventListener("drop", e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; document.documentElement.classList.remove("ed-drop");
  const files = [...e.dataTransfer.files];
  const imgs = files.filter(f => /^image\//.test(f.type)), vids = files.filter(f => /^video\//.test(f.type) || /\.(mp4|m4v|mov)$/i.test(f.name));
  (async () => { for (const f of imgs) await addScene(f); if (vids.length) await addVideos(vids); })();
});

// ---------- pictures ----------
const loadImg = blob => new Promise((res, rej) => {
  const u = URL.createObjectURL(blob), im = new Image();
  im.onload = () => res({im, u}); im.onerror = () => { URL.revokeObjectURL(u); rej(new Error("img")); }; im.src = u;
});
const toBlob = (c, type, q) => new Promise(res => { try { c.toBlob(b => res(b), type, q); } catch (e) { res(null); } });
function smallCanvas(src, max) {
  const k = Math.min(1, max / Math.max(src.width, src.height)), c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k));
  const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, c.width, c.height); return c;
}
function hasAlpha(c) {
  const s = smallCanvas(c, 320), d = s.getContext("2d").getImageData(0, 0, s.width, s.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 245) return true;
  return false;
}
// the biggest see-through hole that does not touch the edge: a cut-out screen or window, the place for the video
function findHole(c) {
  const s = smallCanvas(c, 360), W = s.width, H = s.height, d = s.getContext("2d").getImageData(0, 0, W, H).data;
  const clear = new Uint8Array(W * H), seen = new Uint8Array(W * H), q = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) clear[i] = d[i * 4 + 3] < 128 ? 1 : 0;
  let best = null;
  for (let i = 0; i < W * H; i++) {
    if (!clear[i] || seen[i]) continue;
    let head = 0, tail = 0, area = 0, edge = false, x0 = W, y0 = H, x1 = 0, y1 = 0;
    q[tail++] = i; seen[i] = 1;
    while (head < tail) {
      const j = q[head++], x = j % W, y = (j / W) | 0; area++;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const nb = [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1];
      for (const n of nb) if (n >= 0 && clear[n] && !seen[n]) { seen[n] = 1; q[tail++] = n; }
    }
    if (!edge && area > W * H * 0.004 && (!best || area > best.area)) best = {area, x0, y0, x1, y1};
  }
  if (!best) return null;
  const pad = 1.5; // a little under the frame on every side, so no thin gap shows
  const x = (best.x0 - pad) / W, y = (best.y0 - pad) / H, w = (best.x1 - best.x0 + 1 + 2 * pad) / W, h = (best.y1 - best.y0 + 1 + 2 * pad) / H;
  return {x: r5(clamp(x, 0, 1)), y: r5(clamp(y, 0, 1)), w: r5(Math.min(w, 1)), h: r5(Math.min(h, 1))};
}
function thumbOf(c, size = 96) {
  const t = document.createElement("canvas"); t.width = t.height = size;
  const x = t.getContext("2d"), s = Math.min(c.width, c.height);
  x.fillStyle = "#17110c"; x.fillRect(0, 0, size, size);
  x.imageSmoothingQuality = "high";
  x.drawImage(c, (c.width - s) / 2, (c.height - s) / 2, s, s, 0, 0, size, size);
  return t.toDataURL("image/jpeg", 0.72);
}
async function processImage(file) {
  const {im, u} = await loadImg(file);
  const w0 = im.naturalWidth, h0 = im.naturalHeight, k = Math.min(1, MAX_IMG / Math.max(w0, h0));
  const c = document.createElement("canvas"); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
  const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(im, 0, 0, c.width, c.height);
  URL.revokeObjectURL(u);
  const alpha = file.type !== "image/jpeg" && hasAlpha(c);
  let blob = await toBlob(c, "image/webp", 0.86);
  if (!blob || blob.type !== "image/webp") blob = alpha ? await toBlob(c, "image/png") : await toBlob(c, "image/jpeg", 0.88);
  if (k === 1 && /^image\/(jpeg|png|webp)$/.test(file.type) && (!blob || file.size <= blob.size)) blob = file;
  const ext = {"image/webp": "webp", "image/png": "png", "image/jpeg": "jpg"}[blob.type] || "png";
  return {blob, ext, w: c.width, h: c.height, alpha, hole: alpha ? findHole(c) : null, thumb: thumbOf(c)};
}
function defaultScreen(iw, ih) {
  const w = 0.42, h = Math.min(0.8, (w * iw * 9 / 16) / ih);
  return {x: r5((1 - w) / 2), y: r5((1 - h) / 2), w, h: r5(h), rot: 0, rad: 0.012, layer: "over", fit: "contain", zoom: 1};
}
const cleanName = n => {
  let s = String(n || "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
  if (!/[a-zа-яё]{2}/i.test(s) || /^(img|image|photo|pic|vid|video|mov|dsc|pxl|screenshot|snaptik|ssstik|tiktok|download|file)\b[\s\d]*$/i.test(s)) return "";
  return (s.charAt(0).toUpperCase() + s.slice(1)).slice(0, 60);
};
async function addScene(file) {
  await ready;
  if (!file || !/^image\//.test(file.type)) { status("Это не похоже на картинку. Подойдут PNG, JPG или WebP.", "err"); return; }
  E.busy++; status("Готовлю картинку…");
  try {
    const p = await processImage(file);
    const id = I.uid("s"), path = "media/" + id + "." + p.ext;
    keep(path, p.blob);
    const sc = {id, name: cleanName(file.name) || "Картинка " + (I.data.scenes.length + 1), img: path, iw: p.w, ih: p.h, thumb: p.thumb, alpha: p.alpha, bytes: p.blob.size,
      p: p.hole ? Object.assign(defaultScreen(p.w, p.h), p.hole, {layer: "under", fit: "cover", rad: 0}) : defaultScreen(p.w, p.h)};
    if (p.hole) sc.hole = p.hole;
    I.data.scenes.push(sc);
    E.toolsFor = "";
    I.render(); I.selectScene(id, {instant: true}); buildTools(true);
    E.busy--; changed();
    status(p.hole ? "Картинка добавлена. В ней нашлось прозрачное окно, плеер встал в него." : "Картинка добавлена. Перетащи плеер туда, где ему место.", "ok");
    setTimeout(idle, 6000);
    try { I.el.stage.scrollIntoView({block: "center", behavior: "smooth"}); } catch (e) {}
  } catch (e) {
    E.busy--; console.error(e); status("Не получилось открыть эту картинку. Попробуй PNG или JPG.", "err");
  }
}
async function replaceScene(file) {
  await ready;
  const sc = I.curScene(); if (!sc || !file) return;
  E.busy++; status("Меняю картинку…");
  try {
    const p = await processImage(file);
    const path = "media/" + I.uid("s") + "." + p.ext;
    keep(path, p.blob); drop(sc.img);
    Object.assign(sc, {img: path, iw: p.w, ih: p.h, thumb: p.thumb, alpha: p.alpha, bytes: p.blob.size});
    if (p.hole) sc.hole = p.hole; else delete sc.hole;
    E.busy--; changed(); E.toolsFor = ""; I.render();
    status(p.hole ? "Картинка заменена. В ней есть прозрачное окно: кнопка «Поставить в окно» подгонит плеер." : "Картинка заменена, плеер остался на том же месте.", "ok");
    setTimeout(idle, 6000);
  } catch (e) { E.busy--; console.error(e); status("Не получилось открыть эту картинку.", "err"); }
}

// ---------- the screen frame with handles ----------
const frame = el("div", "ed-frame");
frame.tabIndex = 0;
frame.setAttribute("role", "group");
frame.setAttribute("aria-label", "Плеер. Стрелки двигают его, с Shift на 10 точек, с Alt меняют размер.");
frame.innerHTML = '<span class="ed-rot" data-h="rot" title="Повернуть"></span>' + ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map(h => '<span class="ed-h" data-h="' + h + '"></span>').join("");
I.el.stage.append(frame);
I.noZoom = true; // in the editor the whole picture is shown, unless "Как на телефоне" is on
// the frame sits over the screen; on a phone preview the picture is closer, so its box (I.cam) is bigger than the stage
function placeFrame() {
  const sc = I.curScene();
  frame.hidden = !sc;
  if (!sc) return;
  const p = sc.p, c = I.cam;
  frame.style.left = (c.ox + p.x * c.aw) + "px"; frame.style.top = (c.oy + p.y * c.ah) + "px";
  frame.style.width = p.w * c.aw + "px"; frame.style.height = p.h * c.ah + "px";
  frame.style.transform = p.rot ? "rotate(" + p.rot + "deg)" : "";
  frame.classList.toggle("ed-small", p.w * c.aw < 120 || p.h * c.ah < 80); // on a small frame the side handles would sit on the corners
}
let drag = null;
frame.addEventListener("pointerdown", e => {
  const sc = I.curScene(); if (!readyDone || !sc || (e.pointerType === "mouse" && e.button !== 0)) return;
  e.preventDefault();
  I.camFrozen = true;
  const sr = I.el.stage.getBoundingClientRect(), c = I.cam, p = sc.p;
  const r = {left: sr.left + c.ox, top: sr.top + c.oy}, W = c.aw, H = c.ah;
  drag = {h: e.target.dataset.h || "move", id: e.pointerId, r, W, H, sc,
    cx: (p.x + p.w / 2) * W, cy: (p.y + p.h / 2) * H, w: p.w * W, hh: p.h * H, rot: p.rot || 0,
    px: e.clientX - r.left, py: e.clientY - r.top, moved: false};
  try { frame.setPointerCapture(e.pointerId); } catch (err) {}
  I.el.stage.classList.add("ed-dragging");
  frame.focus({preventScroll: true});
});
frame.addEventListener("pointermove", e => {
  const d = drag; if (!d || e.pointerId !== d.id) return;
  const x = e.clientX - d.r.left, y = e.clientY - d.r.top;
  let cx = d.cx, cy = d.cy, w = d.w, h = d.hh, rot = d.rot;
  if (d.h === "move") {
    cx = clamp(d.cx + x - d.px, 0, d.W); cy = clamp(d.cy + y - d.py, 0, d.H);
    // a gentle pull toward the middle lines of the picture
    if (Math.abs(cx - d.W / 2) < 5) cx = d.W / 2;
    if (Math.abs(cy - d.H / 2) < 5) cy = d.H / 2;
  } else if (d.h === "rot") {
    const a0 = Math.atan2(d.py - d.cy, d.px - d.cx), a1 = Math.atan2(y - d.cy, x - d.cx);
    rot = d.rot + (a1 - a0) * 180 / Math.PI;
    rot = ((rot + 180) % 360 + 360) % 360 - 180;
    const step = e.shiftKey ? 15 : 90, near = Math.round(rot / step) * step;
    if (Math.abs(rot - near) < (e.shiftKey ? 7.5 : 2.5)) rot = near;
    rot = Math.round(rot * 10) / 10;
    if (rot === -180) rot = 180;
  } else {
    const sx = d.h.includes("e") ? 1 : d.h.includes("w") ? -1 : 0, sy = d.h.includes("s") ? 1 : d.h.includes("n") ? -1 : 0;
    const t = d.rot * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
    // the opposite side stays put; the pointer is measured from it along the screen's own axes
    const ax = d.cx - c * sx * d.w / 2 + s * sy * d.hh / 2, ay = d.cy - s * sx * d.w / 2 - c * sy * d.hh / 2;
    const vx = x - ax, vy = y - ay, lx = c * vx + s * vy, ly = -s * vx + c * vy, MIN = 24;
    if (sx) w = Math.max(MIN, sx * lx);
    if (sy) h = Math.max(MIN, sy * ly);
    const lock = E.lock || (e.shiftKey ? d.w / d.hh : null);
    if (lock) {
      if (sx && sy) { if (w / h > lock) h = w / lock; else w = h * lock; }
      else if (sx) h = w / lock; else w = h * lock;
    }
    const ox = sx * w / 2, oy = sy * h / 2;
    cx = ax + c * ox - s * oy; cy = ay + s * ox + c * oy;
  }
  const p = d.sc.p;
  p.w = r5(w / d.W); p.h = r5(h / d.H); p.x = r5(cx / d.W - p.w / 2); p.y = r5(cy / d.H - p.h / 2); p.rot = rot;
  d.moved = true;
  I.applyScene();
});
const endDrag = e => {
  const d = drag; if (!d || (e && e.pointerId !== d.id)) return;
  drag = null; I.el.stage.classList.remove("ed-dragging");
  I.camFrozen = false; I.applyScene();
  if (d.moved) { changed(); syncTools(); }
};
frame.addEventListener("pointerup", endDrag);
frame.addEventListener("pointercancel", endDrag);
frame.addEventListener("lostpointercapture", endDrag);
frame.addEventListener("keydown", e => {
  const sc = I.curScene(); if (!readyDone || !sc) return;
  const m = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[e.key];
  if (!m) return;
  e.preventDefault();
  const r = {width: I.cam.aw, height: I.cam.ah}, step = e.shiftKey ? 10 : 1, p = sc.p;
  if (e.altKey) { p.w = r5(Math.max(24 / r.width, p.w + m[0] * step / r.width)); p.h = r5(Math.max(24 / r.height, p.h + m[1] * step / r.height)); }
  else { p.x = r5(p.x + m[0] * step / r.width); p.y = r5(p.y + m[1] * step / r.height); }
  I.applyScene(); changed(); syncTools();
});

// ---------- the panel under the picture ----------
const tools = el("div", "ed-tools wide");
tools.id = "edTools";
I.el.scenes.after(tools);
const SHAPES = [["free", "Свободная"], ["video", "Как у видео"], ["1.77778", "16:9"], ["0.5625", "9:16"], ["1.33333", "4:3"], ["1", "1:1"]];
let T = {};
function seg(title, opts, get, set) {
  const row = el("div", "ed-row");
  row.append(el("div", "ed-lbl", title));
  const bs = opts.map(([v, t]) => { const b = btn("chip", t, () => { set(v); paint(); }); b.dataset.v = v; row.append(b); return b; });
  const paint = () => { const g = String(get()); bs.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === g))); };
  paint(); row.paint = paint; return row;
}
function slider(title, min, max, step, get, set, show) {
  const row = el("div", "ed-row");
  row.append(el("div", "ed-lbl", title));
  const r = el("input", "ed-range"); r.type = "range"; r.min = min; r.max = max; r.step = step;
  const out = el("span", "ed-val");
  const paint = () => { const v = get(); r.value = clamp(v, min, max); out.textContent = show(v); };
  r.addEventListener("input", () => { set(+r.value); out.textContent = show(+r.value); });
  r.addEventListener("change", () => changed());
  r.setAttribute("aria-label", title);
  row.append(r, out); paint(); row.paint = paint; return row;
}
function curVideoAR() {
  const v = I.curVideo(), vid = I.el.vid;
  if (vid.videoWidth && vid.videoHeight) return vid.videoWidth / vid.videoHeight;
  return v && v.w && v.h ? v.w / v.h : null;
}
const shapeNow = () => E.lockShape || "free";
function setShape(v) {
  const sc = I.curScene(); if (!sc) return;
  if (v === "free") { E.lock = null; E.lockShape = null; return; }
  const ar = v === "video" ? curVideoAR() : +v;
  if (!ar) { status("Сначала выбери видео ниже, тогда плеер возьмёт его форму.", "warn"); return; }
  E.lock = ar; E.lockShape = v;
  const p = sc.p, cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  // keep the width and the middle, change the height; shrink both if it no longer fits
  let w = p.w * sc.iw, h = w / ar;
  if (h > sc.ih * 0.98) { h = sc.ih * 0.98; w = h * ar; }
  p.w = r5(w / sc.iw); p.h = r5(h / sc.ih); p.x = r5(cx - p.w / 2); p.y = r5(cy - p.h / 2);
  I.applyScene(); changed();
}
function buildTools(force) {
  const sc = I.curScene(), key = sc ? sc.id : "-";
  if (!force && E.toolsFor === key) { syncTools(); return; }
  E.toolsFor = key; E.lock = null; E.lockShape = null;
  if (I.forcePhone) { I.forcePhone = false; I.el.stage.classList.remove("ed-phone"); I.applyScene(); }
  tools.textContent = ""; T = {};
  if (!sc) {
    tools.append(el("h3", null, "Картинки"));
    tools.append(el("p", "ed-hint", "Пока картинок нет, видео показывается в простой рамке. Добавь картинку, и плеер можно будет поставить прямо в неё: на экран телевизора, в окно, в рамку на стене."));
    const r = el("div", "ed-row"); r.append(btn("go small", "＋ Добавить картинку", () => pickScene.click())); tools.append(r);
    tools.append(el("p", "ed-hint", "Совет: если в картинке вырезать экран или окно (сделать прозрачным, PNG), плеер сам встанет туда и окажется «внутри» картинки."));
    return;
  }
  tools.append(el("h3", null, "Картинка и плеер"));
  const nameRow = el("div", "ed-row"); nameRow.append(el("div", "ed-lbl", "Название кнопки"));
  const name = el("input", "ed-in"); name.maxLength = 28; name.value = sc.name; name.setAttribute("aria-label", "Название кнопки");
  name.addEventListener("input", () => {
    sc.name = name.value.trim() || "Картинка";
    const chip = I.el.scenes.querySelector('[data-scene="' + CSS.escape(sc.id) + '"] span:last-child');
    if (chip) chip.textContent = sc.name;
    changed();
  });
  nameRow.append(name); tools.append(nameRow);
  T.layer = seg("Плеер", [["over", "Поверх картинки"], ["under", "Под картинкой"]], () => sc.p.layer, v => { sc.p.layer = v; I.applyScene(); changed(); paintWarn(); });
  T.fit = seg("Видео в рамке", [["contain", "Целиком"], ["cover", "Заполняет рамку"]], () => sc.p.fit, v => { sc.p.fit = v; I.applyScene(); changed(); });
  T.shape = seg("Форма рамки", SHAPES, shapeNow, v => setShape(v));
  T.rot = slider("Поворот", -45, 45, 0.5, () => sc.p.rot || 0, v => { sc.p.rot = v; I.applyScene(); }, v => (Math.round(v * 10) / 10).toString().replace(".", ",") + "°");
  T.rad = slider("Скругление углов", 0, 0.06, 0.001, () => sc.p.rad, v => { sc.p.rad = v; I.applyScene(); }, v => Math.round(v * 1000) / 10 + "%");
  T.zoom = seg("На телефоне", [["0", "Вся картинка"], ["1", "Ближе к экрану"], ["2", "Совсем близко"]], () => sc.p.zoom, v => { sc.p.zoom = +v; setPhone(true); changed(); });
  T.phone = btn("chip", "Показать, как на телефоне", () => setPhone(!I.forcePhone));
  T.zoom.append(T.phone, el("p", "ed-hint", "На узком экране картинка приближается к плееру, чтобы видео не было крошечным."));
  T.warn = el("p", "ed-hint warn");
  tools.append(T.layer, T.warn, T.fit, T.shape, T.rot, T.rad, T.zoom);
  const acts = el("div", "ed-row");
  acts.append(el("div", "ed-lbl", "Картинка"));
  if (sc.hole) acts.append(btn("soft", "Поставить в окно", () => {
    Object.assign(sc.p, sc.hole, {rot: 0, layer: "under", fit: "cover", rad: 0}); I.applyScene(); changed(); syncTools(); paintWarn();
  }));
  acts.append(btn("soft", "Заменить картинку", () => pickReplace.click()));
  const i = I.data.scenes.indexOf(sc);
  const toL = btn("soft", "← Левее", () => moveScene(-1)), toR = btn("soft", "Правее →", () => moveScene(1));
  toL.disabled = i <= 0; toR.disabled = i >= I.data.scenes.length - 1;
  acts.append(toL, toR, btn("soft ed-danger", "Удалить картинку", removeScene));
  tools.append(acts);
  tools.append(el("p", "ed-hint", "Плеер тянется пальцем или мышкой: за середину он двигается, за кружки по краям меняет размер, за кружок сверху поворачивается. С клавиатуры: стрелки двигают на 1 точку, с Shift на 10, с Alt меняют размер. Первая картинка в ряду открывается у гостей первой."));
  paintWarn();
}
function paintWarn() {
  const sc = I.curScene(); if (!sc || !T.warn) return;
  const t = sc.p.layer === "under" && sc.alpha === false ? "В этой картинке нет прозрачных мест, поэтому плеер под ней не будет виден. «Под картинкой» нужно для PNG с вырезанным экраном или окном." :
    sc.p.layer === "under" ? "Видео видно только там, где картинка прозрачная. Удобно, когда экран или окно в картинке вырезаны." : "";
  T.warn.textContent = t; T.warn.hidden = !t;
}
function syncTools() { for (const k of ["layer", "fit", "shape", "rot", "rad", "zoom"]) if (T[k] && T[k].paint) T[k].paint(); if (T.phone) T.phone.setAttribute("aria-pressed", String(I.forcePhone)); }
function setPhone(on) {
  I.forcePhone = on; I.el.stage.classList.toggle("ed-phone", on);
  if (T.phone) T.phone.setAttribute("aria-pressed", String(on));
  I.applyScene();
}
function moveScene(dir) {
  const a = I.data.scenes, sc = I.curScene(), i = a.indexOf(sc), j = i + dir;
  if (i < 0 || j < 0 || j >= a.length) return;
  a.splice(i, 1); a.splice(j, 0, sc);
  changed(); E.toolsFor = ""; I.render();
}
async function removeScene() {
  const sc = I.curScene(); if (!sc) return;
  if (!(await ask("Убрать картинку?", "«" + sc.name + "» исчезнет с сайта, когда ты сохранишь изменения.", "Убрать", "Оставить", true))) return;
  const a = I.data.scenes, i = a.indexOf(sc);
  a.splice(i, 1); drop(sc.img);
  const next = a[Math.min(i, a.length - 1)];
  I.S.scene = next ? next.id : null;
  changed(); E.toolsFor = ""; I.render();
}

// ---------- videos ----------
const fourcc = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
function boxes(dv, start, end, cb) {
  let o = start;
  while (o + 8 <= end) {
    let size = dv.getUint32(o), head = 8;
    const type = fourcc(dv, o + 4);
    if (size === 1) { if (o + 16 > end) break; size = Number(dv.getBigUint64(o + 8)); head = 16; }
    else if (size === 0) size = end - o;
    if (size < head || o + size > end) break;
    if (cb(type, o, size, head) === false) return;
    o += size;
  }
}
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "mvex"]);
function walk(dv, start, end, cb) { boxes(dv, start, end, (t, o, s, h) => { cb(t, o, s, h); if (CONTAINERS.has(t)) walk(dv, o + h, o + s, cb); }); }
// reads the top-level boxes of an MP4: which codecs it uses and whether its index (moov) comes before the data
async function mp4Info(file) {
  const top = []; let off = 0;
  while (off + 8 <= file.size && top.length < 200) {
    const dv = new DataView(await file.slice(off, off + 16).arrayBuffer());
    if (dv.byteLength < 8) break;
    let size = dv.getUint32(0), head = 8;
    const type = fourcc(dv, 4);
    if (size === 1) { if (dv.byteLength < 16) break; size = Number(dv.getBigUint64(8)); head = 16; }
    else if (size === 0) size = file.size - off;
    if (size < head || !/^[\x20-\x7e]{4}$/.test(type)) break;
    top.push({type, off, size}); off += size;
  }
  const info = {top, whole: off === file.size, moov: top.find(b => b.type === "moov"), vcodec: "", acodec: ""};
  if (!info.moov || info.moov.size > 64 * 1048576) return info;
  info.mbuf = await file.slice(info.moov.off, info.moov.off + info.moov.size).arrayBuffer();
  const dv = new DataView(info.mbuf);
  info.mhead = dv.getUint32(0) === 1 ? 16 : 8;
  boxes(dv, info.mhead, dv.byteLength, (t, o, s) => {
    if (t !== "trak") return;
    let kind = "", codec = "";
    walk(dv, o + 8, o + s, (tt, oo, ss, hh) => {
      if (tt === "hdlr" && !kind && oo + hh + 12 <= oo + ss) kind = fourcc(dv, oo + hh + 8); // the first one; MOV files have a second, for data
      if (tt === "stsd" && oo + hh + 16 <= oo + ss) codec = fourcc(dv, oo + hh + 12);
    });
    if (kind === "vide" && !info.vcodec) info.vcodec = codec;
    if (kind === "soun" && !info.acodec) info.acodec = codec;
  });
  return info;
}
// moves the index of an MP4 to the front, so a phone can start playing before the whole file arrives
function faststart(file, info) {
  const {top, moov, mbuf} = info;
  if (!moov || !mbuf || !info.whole || top.some(b => b.type === "moof")) return null;
  const firstData = top.find(b => b.type === "mdat");
  if (!firstData || moov.off < firstData.off || top.some(b => b.type === "mdat" && b.off > moov.off)) return null;
  const m = new Uint8Array(mbuf.slice(0)), dv = new DataView(m.buffer), delta = moov.size;
  let ok = true;
  walk(dv, info.mhead || 8, dv.byteLength, (t, o, s, h) => {
    if (t === "stco") {
      const n = dv.getUint32(o + h + 4);
      for (let i = 0; i < n; i++) { const at = o + h + 8 + i * 4; if (at + 4 > o + s) { ok = false; return; } const v = dv.getUint32(at) + delta; if (v > 0xffffffff) { ok = false; return; } dv.setUint32(at, v); }
    } else if (t === "co64") {
      const n = dv.getUint32(o + h + 4);
      for (let i = 0; i < n; i++) { const at = o + h + 8 + i * 8; if (at + 8 > o + s) { ok = false; return; } dv.setBigUint64(at, dv.getBigUint64(at) + BigInt(delta)); }
    }
  });
  if (!ok) return null;
  const parts = [];
  for (const b of top) { if (b === moov) continue; if (b === firstData) parts.push(m); parts.push(file.slice(b.off, b.off + b.size)); }
  return new Blob(parts, {type: "video/mp4"});
}
function probe(blob) {
  return new Promise(res => {
    const v = document.createElement("video"), u = URL.createObjectURL(blob);
    v.muted = true; v.playsInline = true; v.setAttribute("playsinline", ""); v.preload = "auto";
    let done = false;
    const fin = r => { if (done) return; done = true; clearTimeout(t); res(Object.assign({v, u}, r)); };
    v.addEventListener("loadedmetadata", () => fin({ok: v.videoWidth > 0, w: v.videoWidth, h: v.videoHeight, dur: v.duration}));
    v.addEventListener("error", () => fin({ok: false}));
    const t = setTimeout(() => fin({ok: v.videoWidth > 0, w: v.videoWidth, h: v.videoHeight, dur: v.duration, slow: true}), 20000);
    v.src = u;
  });
}
function seekTo(v, t) {
  return new Promise(res => {
    let done = false;
    const fin = () => { if (done) return; done = true; v.removeEventListener("seeked", fin); clearTimeout(to); res(); };
    v.addEventListener("seeked", fin);
    const to = setTimeout(fin, 5000);
    try { v.currentTime = clamp(t, 0, Math.max(0, (v.duration || 0) - 0.05)); } catch (e) { fin(); }
  });
}
// a poster for the player (up to 960 px) and a small picture for the list (480×300)
async function shots(v, at) {
  await seekTo(v, at);
  if (v.readyState < 2) { try { await v.play(); } catch (e) {} v.pause(); await seekTo(v, at); }
  const vw = v.videoWidth, vh = v.videoHeight, k = Math.min(1, 960 / Math.max(vw, vh));
  const c = document.createElement("canvas"); c.width = Math.round(vw * k); c.height = Math.round(vh * k);
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  const t = document.createElement("canvas"); t.width = 480; t.height = 300;
  const tx = t.getContext("2d"), s = Math.max(480 / vw, 300 / vh), dw = vw * s, dh = vh * s;
  tx.drawImage(v, (480 - dw) / 2, (300 - dh) * 0.4, dw, dh);
  return {poster: await toBlob(c, "image/jpeg", 0.82), thumb: await toBlob(t, "image/jpeg", 0.8)};
}
const CODEC_NOTE = {
  hvc1: "Видео в формате HEVC: на части телефонов Android и компьютеров оно может не открыться. Надёжнее перекодировать в H.264.",
  hev1: "Видео в формате HEVC: на части телефонов Android и компьютеров оно может не открыться. Надёжнее перекодировать в H.264.",
  av01: "Видео в формате AV1: на старых iPhone оно не откроется. Надёжнее перекодировать в H.264.",
  vp09: "Видео в формате VP9: на старых iPhone оно не откроется. Надёжнее перекодировать в H.264."
};
async function addVideos(files) {
  await ready;
  const list = files.filter(Boolean);
  if (!list.length) return;
  E.busy++;
  const notes = [];
  let added = 0;
  try {
  for (let n = 0; n < list.length; n++) {
    const f = list[n];
    status("Готовлю видео " + (n + 1) + " из " + list.length + "…");
    if (f.size > VIDEO_HARD) { notes.push("«" + f.name + "» весит " + MB(f.size) + ", а GitHub не принимает файлы больше 100 МБ. Сожми его (например, в 720p) и добавь снова."); continue; }
    let info = {};
    try { info = await mp4Info(f); } catch (e) {}
    let blob = f;
    const fixed = faststart(f, info);
    if (fixed && fixed.size === f.size) blob = fixed;
    const pr = await probe(blob);
    if (!pr.ok) {
      URL.revokeObjectURL(pr.u);
      notes.push("«" + f.name + "» не открылось в браузере. Скорее всего, его формат понимают не все телефоны. Перекодируй в MP4 (H.264), например бесплатной программой HandBrake, и добавь снова.");
      continue;
    }
    let pics = {};
    try { pics = await shots(pr.v, Math.min(2, (pr.dur || 0) * 0.25)); } catch (e) { console.error(e); }
    URL.revokeObjectURL(pr.u);
    const id = I.uid("v"), ext = /\.webm$/i.test(f.name) ? "webm" : "mp4";
    const v = {id, title: cleanName(f.name), src: "media/" + id + "." + ext, poster: "", thumb: "",
      w: pr.w, h: pr.h, dur: Math.round((pr.dur || 0) * 10) / 10, size: blob.size, cats: [], by: "", link: "", loop: false, codec: info.vcodec || ""};
    keep(v.src, blob);
    if (pics.poster) { v.poster = "media/" + id + "-p.jpg"; keep(v.poster, pics.poster); }
    if (pics.thumb) { v.thumb = "media/" + id + "-t.jpg"; keep(v.thumb, pics.thumb); }
    I.data.videos.unshift(v);
    added++;
    if (CODEC_NOTE[info.vcodec]) notes.push("«" + f.name + "»: " + CODEC_NOTE[info.vcodec]);
    if (f.size > VIDEO_SOFT) notes.push("«" + f.name + "» весит " + MB(f.size) + ": на медленном интернете оно будет грузиться долго. Если получится, сожми его до 720p.");
  }
  } catch (e) { console.error(e); notes.push("Что-то пошло не так при добавлении видео. Попробуй ещё раз."); }
  E.busy--;
  if (added) { I.S.cat = "all"; changed(); I.render(); }
  if (notes.length) { status(notes.join(" "), "warn"); }
  else if (added) { status(added === 1 ? "Видео добавлено. Нажми ✎ на карточке, чтобы дать название и выбрать раздел." : "Добавлено видео: " + added + ". Нажми ✎ на карточке, чтобы дать название и выбрать раздел.", "ok"); setTimeout(idle, 7000); }
  else idle();
}

// ---------- the sheet for one video ----------
let sheetOpen = null;
function openSheet(veil, focusEl) {
  const last = document.activeElement;
  I.el.page.inert = true; barEl.inert = true; document.documentElement.classList.add("lock");
  document.body.append(veil);
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    veil.remove(); document.removeEventListener("keydown", onKey); sheetOpen = null;
    if (!document.querySelector(".veil")) { I.el.page.inert = false; barEl.inert = false; document.documentElement.classList.remove("lock"); }
    if (veil.onclose) veil.onclose();
    if (last && last.focus) try { last.focus({preventScroll: true}); } catch (e) {}
  };
  const onKey = e => { if (e.key === "Escape" && [...document.querySelectorAll(".veil")].pop() === veil) { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey);
  veil.addEventListener("click", e => { if (e.target === veil) close(); });
  sheetOpen = close;
  (focusEl || veil.querySelector(".sheet")).focus();
  return close;
}
function makeSheet(title) {
  const veil = el("div", "veil"); veil.setAttribute("role", "dialog"); veil.setAttribute("aria-modal", "true");
  const sh = el("div", "sheet ed-sheet"); sh.tabIndex = -1; veil.append(sh);
  const head = el("div", "sheet-head"), h = el("h2", null, title);
  h.id = "edSheetTitle"; veil.setAttribute("aria-labelledby", h.id);
  const x = btn("x", "×"); x.setAttribute("aria-label", "Закрыть");
  head.append(h, x); sh.append(head);
  return {veil, sh, x};
}
// a yes/no question in the site's own sheet; Esc, the cross and a tap outside mean "no"
function ask(title, text, yes, no, danger) {
  return new Promise(res => {
    const {veil, sh, x} = makeSheet(title);
    sh.append(el("p", "ed-ask", text));
    const foot = el("div", "ed-foot"), n = btn("soft", no), y = btn("go small" + (danger ? " ed-go-danger" : ""), yes);
    foot.append(n, y); sh.append(foot);
    let done = false;
    const fin = v => { if (done) return; done = true; close(); res(v); };
    const close = openSheet(veil, n);
    veil.onclose = () => { if (!done) { done = true; res(false); } };
    n.addEventListener("click", () => fin(false)); y.addEventListener("click", () => fin(true)); x.addEventListener("click", () => fin(false));
  });
}
function field(label, value, onInput, attrs = {}) {
  const row = el("label", "ed-row"); row.append(el("span", "ed-lbl", label));
  const i = el("input", "ed-in"); i.value = value || ""; Object.assign(i, attrs);
  i.addEventListener("input", () => onInput(i.value));
  row.append(i); return row;
}
function openVideoSheet(id) {
  const v = I.data.videos.find(x => x.id === id); if (!v) return;
  const {veil, sh, x} = makeSheet("Видео");
  const prev = el("video"); prev.controls = true; prev.playsInline = true; prev.setAttribute("playsinline", ""); prev.preload = "metadata";
  if (v.poster) prev.poster = I.url(v.poster);
  prev.src = I.url(v.src);
  sh.append(prev);
  // the cover: any frame of the video
  const coverRow = el("div", "ed-row");
  coverRow.append(el("span", "ed-lbl", "Обложка"));
  const scrub = el("input", "ed-range"); scrub.type = "range"; scrub.min = 0; scrub.max = 1000; scrub.value = 0; scrub.setAttribute("aria-label", "Кадр для обложки");
  scrub.addEventListener("input", () => { const d = prev.duration; if (isFinite(d) && d > 0) { prev.pause(); prev.currentTime = scrub.value / 1000 * d; } });
  const coverBtn = btn("soft", "Сделать этот кадр обложкой", async () => {
    coverBtn.disabled = true; coverBtn.textContent = "Секунду…";
    try {
      if (prev.readyState < 2) { await new Promise(r => { prev.addEventListener("loadeddata", r, {once: true}); setTimeout(r, 4000); }); }
      const p = await shots(prev, prev.currentTime);
      const tag = Date.now().toString(36);
      drop(v.poster); drop(v.thumb);
      v.poster = "media/" + v.id + "-p" + tag + ".jpg"; keep(v.poster, p.poster);
      v.thumb = "media/" + v.id + "-t" + tag + ".jpg"; keep(v.thumb, p.thumb);
      prev.poster = I.url(v.poster);
      if (I.S.video === v.id) I.el.vid.poster = I.url(v.poster);
      changed(); I.render();
      coverBtn.textContent = "Обложка обновлена ✓";
    } catch (e) { console.error(e); coverBtn.textContent = "Не получилось, попробуй другой кадр"; }
    setTimeout(() => { coverBtn.disabled = false; coverBtn.textContent = "Сделать этот кадр обложкой"; }, 1600);
  });
  coverRow.append(scrub, coverBtn);
  coverRow.append(el("p", "ed-hint", "Подвинь ползунок до красивого кадра и нажми кнопку. Этот кадр будет на карточке и в плеере до нажатия ▶."));
  sh.append(coverRow);
  sh.append(field("Название", v.title, t => { v.title = t.trim(); changed(); I.render(); }, {maxLength: 80, placeholder: "Например: Кот и коробка"}));
  // where it goes
  const catRow = el("div", "ed-row"); catRow.append(el("span", "ed-lbl", "Раздел"));
  const catBtns = Object.entries(I.CATS).map(([k, t]) => {
    const b = btn("chip", t, () => { v.cats = v.cats.includes(k) ? v.cats.filter(c => c !== k) : [...v.cats, k]; paintCats(); changed(); I.render(); });
    b.dataset.k = k; catRow.append(b); return b;
  });
  const paintCats = () => catBtns.forEach(b => b.setAttribute("aria-pressed", String(v.cats.includes(b.dataset.k))));
  paintCats();
  catRow.append(el("p", "ed-hint", "Можно отметить несколько разделов. Без отметок видео попадёт в «Несортированное»."));
  sh.append(catRow);
  sh.append(field("Автор (если известен)", v.by, t => { v.by = t.trim(); changed(); I.render(); }, {maxLength: 80, placeholder: "Имя или ник автора"}));
  sh.append(field("Ссылка на автора (необязательно)", v.link, t => { v.link = /^https?:\/\//i.test(t.trim()) ? t.trim() : ""; changed(); I.render(); }, {type: "url", placeholder: "https://…"}));
  const loopRow = el("label", "ed-check"); const loop = el("input"); loop.type = "checkbox"; loop.checked = !!v.loop;
  loop.addEventListener("change", () => { v.loop = loop.checked; if (I.S.video === v.id) I.el.vid.loop = v.loop; changed(); });
  loopRow.append(loop, document.createTextNode("Повторять по кругу (для огня, дождя, аквариума)"));
  sh.append(loopRow);
  const orderRow = el("div", "ed-row"); orderRow.append(el("span", "ed-lbl", "Место в списке"));
  const move = to => {
    const a = I.data.videos, i = a.indexOf(v); if (i < 0) return;
    const j = to === "first" ? 0 : to === "last" ? a.length - 1 : clamp(i + to, 0, a.length - 1);
    if (i === j) return;
    a.splice(i, 1); a.splice(j, 0, v); changed(); I.render(); paintOrder();
  };
  const ob = [btn("soft", "В начало", () => move("first")), btn("soft", "↑ Раньше", () => move(-1)), btn("soft", "↓ Позже", () => move(1)), btn("soft", "В конец", () => move("last"))];
  const pos = el("span", "ed-hint");
  const paintOrder = () => { const i = I.data.videos.indexOf(v), n = I.data.videos.length; pos.textContent = (i + 1) + " из " + n + (i === 0 ? " · первое видео гости видят сразу" : ""); ob[0].disabled = ob[1].disabled = i <= 0; ob[2].disabled = ob[3].disabled = i >= n - 1; };
  orderRow.append(...ob, pos); paintOrder();
  sh.append(orderRow);
  const meta = [v.w && v.h ? v.w + "×" + v.h : "", v.dur ? I.fmt(v.dur) : "", v.size ? MB(v.size) : "", v.codec ? ({avc1: "H.264", avc3: "H.264", hvc1: "HEVC", hev1: "HEVC", av01: "AV1", vp09: "VP9"}[v.codec] || v.codec) : ""].filter(Boolean).join(" · ");
  if (meta) sh.append(el("p", "ed-hint", meta));
  if (CODEC_NOTE[v.codec]) sh.append(el("p", "ed-hint warn", CODEC_NOTE[v.codec]));
  const foot = el("div", "ed-foot");
  const del = btn("soft ed-danger", "Удалить видео", async () => {
    if (!(await ask("Убрать видео?", "«" + (v.title || "Без названия") + "» исчезнет с сайта, когда ты сохранишь изменения.", "Убрать", "Оставить", true))) return;
    const a = I.data.videos, i = a.indexOf(v);
    if (i >= 0) a.splice(i, 1);
    drop(v.src); drop(v.poster); drop(v.thumb);
    if (I.S.video === v.id) { I.S.video = null; I.el.vid.pause(); I.el.vid.removeAttribute("src"); I.el.vid.removeAttribute("poster"); }
    changed(); close(); I.render();
  });
  const done = btn("go small", "Готово");
  foot.append(del, done); sh.append(foot);
  const close = openSheet(veil, sh);
  veil.onclose = () => { prev.pause(); prev.removeAttribute("src"); try { prev.load(); } catch (e) {} };
  x.addEventListener("click", close); done.addEventListener("click", close);
}

// ---------- the key ----------
function openKeySheet(thenSave) {
  const {veil, sh, x} = makeSheet("Ключ для сохранения");
  sh.append(el("p", "ed-hint", "Чтобы редактор мог сохранять картинки, видео и место плеера прямо на сайт, нужен ключ от GitHub. Он хранится только в этом браузере на этом устройстве и даёт доступ только к репозиторию сайта."));
  // GitHub fills in the name, a one-year term and the right to write files from this link; only the repository is picked by hand
  const form = "https://github.com/settings/personal-access-tokens/new?name=" + encodeURIComponent("Островок") +
    "&description=" + encodeURIComponent("Сохранение из редактора островка на сайте " + REPO.repo) + "&expires_in=366&contents=write";
  const ol = el("ol", "ed-steps");
  ol.innerHTML =
    '<li>Открой <a target="_blank" rel="noopener">готовую форму ключа на GitHub</a> (если попросит, войди в аккаунт). Название, срок на год и нужное право там уже заполнены.</li>' +
    '<li>В разделе <b>Repository access</b> выбери <b>Only select repositories</b> и отметь в списке <code></code>.</li>' +
    '<li>Проверь, что ниже, в <b>Permissions</b>, у <b>Contents</b> стоит <b>Read and write</b>.</li>' +
    '<li>Нажми <b>Generate token</b>, скопируй ключ (он начинается с <code>github_pat_</code>) и вставь сюда.</li>';
  ol.querySelector("a").href = form;
  ol.querySelectorAll("code")[0].textContent = REPO.repo;
  sh.append(ol);
  sh.append(el("p", "ed-hint", "Через год GitHub отключит ключ. Редактор тогда скажет об этом, и нужно будет сделать новый по этим же шагам."));
  const inp = el("input", "ed-in"); inp.type = "password"; inp.autocomplete = "off"; inp.spellcheck = false; inp.placeholder = "github_pat_…"; inp.value = E.key;
  inp.setAttribute("aria-label", "Ключ GitHub");
  sh.append(inp);
  const note = el("p", "ed-hint"); sh.append(note);
  const foot = el("div", "ed-foot");
  const forget = btn("soft ed-danger", "Забыть ключ", () => { storeKey(""); inp.value = ""; note.textContent = "Ключ удалён с этого устройства."; note.className = "ed-hint"; });
  forget.hidden = !E.key;
  const ok = btn("go small", "Проверить и запомнить", async () => {
    const k = inp.value.trim().replace(/^Bearer\s+/i, "");
    if (!k) { note.textContent = "Сначала вставь ключ."; note.className = "ed-hint warn"; return; }
    ok.disabled = true; note.textContent = "Проверяю…"; note.className = "ed-hint";
    try {
      // a tiny test file that is never attached anywhere: shows the key can write to the repository
      await gh("/repos/" + REPO.owner + "/" + REPO.repo + "/git/blobs", {method: "POST", body: {content: "ostrovok", encoding: "utf-8"}, key: k});
      storeKey(k);
      note.textContent = "Ключ подходит ✓"; note.className = "ed-hint";
      setTimeout(() => { close(); if (thenSave) save(); }, 600);
    } catch (e) {
      note.textContent = errText(e, true); note.className = "ed-hint warn";
    }
    ok.disabled = false;
  });
  foot.append(forget, ok); sh.append(foot);
  const close = openSheet(veil, inp);
  x.addEventListener("click", close);
  inp.addEventListener("keydown", e => { if (e.key === "Enter") ok.click(); });
}
function openDemoSheet() {
  const {veil, sh, x} = makeSheet("Это превью");
  sh.append(el("p", "ed-hint", "Здесь всё можно двигать и пробовать, но сохранение не работает: эта копия страницы не на GitHub. На настоящем сайте кнопка «Сохранить» отправит картинки, видео и место плеера в репозиторий, и через минуту-две все гости увидят именно так."));
  const foot = el("div", "ed-foot"), ok = btn("go small", "Понятно");
  foot.append(ok); sh.append(foot);
  const close = openSheet(veil, ok);
  x.addEventListener("click", close); ok.addEventListener("click", close);
}

// ---------- GitHub ----------
function errText(e, forKey) {
  const s = e && e.status, m = String((e && e.message) || "");
  if (s === 0) return "Нет связи с GitHub. Проверь интернет и попробуй ещё раз.";
  if (s === 401) return "Ключ не подходит: возможно, он скопирован не целиком или у него закончился срок." + (forKey ? " Сделай новый по шагам выше." : " Нажми «Ключ» и вставь новый.");
  if (s === 403 && /rate limit/i.test(m)) return "GitHub просит немного подождать. Попробуй через несколько минут.";
  if (s === 403 || s === 404) return "У ключа нет права записи в репозиторий " + REPO.repo + ". Проверь пункты 3 и 4" + (forKey ? "" : " (кнопка «Ключ»)") + ".";
  if (s === 409) return "GitHub сейчас занят этим репозиторием. Нажми «Сохранить» ещё раз.";
  if (s === 413 || /too large|exceeds/i.test(m)) return "GitHub не принял слишком большой файл. Сожми видео и попробуй снова.";
  if (s === 422) return "GitHub не принял изменения. Нажми «Сохранить» ещё раз.";
  return "Не получилось сохранить (" + (s || "ошибка") + "). Попробуй ещё раз чуть позже.";
}
async function gh(path, o = {}) {
  const h = {Accept: "application/vnd.github+json"}, k = o.key || E.key;
  if (k) h.Authorization = "Bearer " + k;
  if (o.body) h["Content-Type"] = "application/json";
  let r;
  try { r = await fetch(API + path, {method: o.method || "GET", headers: h, body: o.body ? JSON.stringify(o.body) : undefined, cache: "no-store"}); }
  catch (e) { throw Object.assign(new Error("network"), {status: 0}); }
  if (!r.ok) { let t = ""; try { t = await r.text(); } catch (e) {} throw Object.assign(new Error(t || String(r.status)), {status: r.status}); }
  return r.status === 204 ? null : r.json();
}
// big files go with XMLHttpRequest, which can tell how much is sent
function upload(path, body, onProgress) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open("POST", API + path);
    x.setRequestHeader("Accept", "application/vnd.github+json");
    x.setRequestHeader("Authorization", "Bearer " + E.key);
    x.setRequestHeader("Content-Type", "application/json");
    x.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => { if (x.status >= 200 && x.status < 300) { try { res(JSON.parse(x.responseText)); } catch (e) { rej(Object.assign(new Error("bad json"), {status: x.status})); } } else rej(Object.assign(new Error(x.responseText || String(x.status)), {status: x.status})); };
    x.onerror = () => rej(Object.assign(new Error("network"), {status: 0}));
    x.send(body);
  });
}
const b64 = blob => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).slice(String(f.result).indexOf(",") + 1)); f.onerror = () => rej(f.error); f.readAsDataURL(blob); });
async function gitSha(bytes) {
  const head = new TextEncoder().encode("blob " + bytes.length + "\0"), all = new Uint8Array(head.length + bytes.length);
  all.set(head); all.set(bytes, head.length);
  const d = await crypto.subtle.digest("SHA-1", all);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function decodeB64Utf8(s) { const bin = atob(String(s).replace(/\s/g, "")), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder().decode(u); }
function snapshot() {
  // the same data the page reads; nothing about the editor itself goes in
  return JSON.stringify(I.data, null, 2) + "\n";
}
async function save() {
  if (E.saving) return;
  if (E.busy) { status("Секунду: ещё готовлю файлы. Нажми «Сохранить», когда они появятся.", "warn"); return; }
  if (!LIVE) { openDemoSheet(); return; }
  if (!E.key) { openKeySheet(true); return; }
  E.saving = true; saveBtn.disabled = true; exitBtn.disabled = true;
  const repo = "/repos/" + REPO.owner + "/" + REPO.repo, dir = REPO.dir.replace(/^\/+|\/+$/g, "");
  const full = p => (dir ? dir + "/" : "") + p;
  try {
    // 1. new files, one by one, with progress
    const pending = [...E.files.entries()].filter(([p]) => !E.sent.has(p));
    const total = pending.reduce((a, [, b]) => a + b.size, 0) || 1;
    let doneBytes = 0;
    for (let i = 0; i < pending.length; i++) {
      const [p, blob] = pending[i];
      const label = "Отправляю файлы: " + (i + 1) + " из " + pending.length;
      status(label + " · " + Math.floor(doneBytes / total * 100) + "%");
      const body = JSON.stringify({content: await b64(blob), encoding: "base64"});
      const r = await upload(repo + "/git/blobs", body, f => status(label + " · " + Math.floor((doneBytes + f * blob.size) / total * 100) + "%"));
      E.sent.set(p, r.sha); doneBytes += blob.size;
    }
    // 2. one commit with the files and data.json; if someone pushed meanwhile, build on top of it and try again
    status("Сохраняю…");
    const json = snapshot(), bytes = new TextEncoder().encode(json);
    for (let attempt = 0; ; attempt++) {
      const ref = await gh(repo + "/git/ref/heads/" + encodeURIComponent(REPO.branch));
      const head = ref.object.sha, commit = await gh(repo + "/git/commits/" + head);
      const tree = await gh(repo + "/git/trees/" + commit.tree.sha + "?recursive=1");
      const have = new Map((tree.tree || []).filter(t => t.type === "blob").map(t => [t.path, t.sha]));
      const dataPath = full("data.json"), remote = have.get(dataPath) || null;
      if (attempt === 0 && E.baseSha !== undefined && remote !== E.baseSha && !(remote === null && E.baseSha === null)) {
        if (!(await ask("Сохранить поверх?", "Пока ты редактировала, данные островка на GitHub поменялись, может быть, с другого устройства. Если сохранить, останется твоя версия.", "Сохранить поверх", "Не сохранять"))) { status("Сохранение отменено. Можно выйти из редактора и открыть его заново, чтобы увидеть свежую версию.", "warn"); return; }
      }
      const entries = [];
      for (const [p, sha] of E.sent) if (E.files.has(p)) entries.push({path: full(p), mode: "100644", type: "blob", sha});
      entries.push({path: dataPath, mode: "100644", type: "blob", content: json});
      for (const p of E.removed) if (have.has(full(p)) && !E.files.has(p)) entries.push({path: full(p), mode: "100644", type: "blob", sha: null});
      const nt = await gh(repo + "/git/trees", {method: "POST", body: {base_tree: commit.tree.sha, tree: entries}});
      const nc = await gh(repo + "/git/commits", {method: "POST", body: {message: "Островок: изменения из редактора", tree: nt.sha, parents: [head]}});
      try { await gh(repo + "/git/refs/heads/" + encodeURIComponent(REPO.branch), {method: "PATCH", body: {sha: nc.sha, force: false}}); break; }
      catch (e) { if (e.status === 422 && attempt < 3) continue; throw e; }
    }
    E.files.clear(); E.sent.clear(); E.removed.clear();
    E.baseSha = await gitSha(bytes);
    E.dirty = false;
    status("Сохранено ✓ Через минуту-две сайт обновится у всех. " + totals(), "ok");
  } catch (e) {
    console.error(e);
    status(errText(e), "err");
    if (e.status === 401) { storeKey(""); }
  } finally {
    E.saving = false; exitBtn.disabled = false; saveBtn.disabled = !E.dirty;
  }
}

// fresh data straight from GitHub: the site itself may show an older copy for a few minutes after a save
async function loadFresh() {
  if (!LIVE) { E.baseSha = undefined; idle(); return; }
  E.busy++; status("Беру свежие данные с GitHub…");
  try {
    const j = await gh("/repos/" + REPO.owner + "/" + REPO.repo + "/contents/" + REPO.dir.split("/").map(encodeURIComponent).join("/") + "/data.json?ref=" + encodeURIComponent(REPO.branch));
    E.baseSha = j.sha;
    if (j.content) { E.toolsFor = ""; I.setData(JSON.parse(decodeB64Utf8(j.content))); }
    E.busy--; idle();
  } catch (e) {
    E.busy--;
    if (e.status === 404) { E.baseSha = null; idle(); }
    else { E.baseSha = undefined; status("Не получилось взять свежие данные с GitHub, показываю то, что сейчас на сайте.", "warn"); }
  }
}

// ---------- hooks into the page ----------
I.hooks.scenes = row => row.append(btn("chip ed-add", "＋ Картинка", () => pickScene.click()));
I.hooks.grid = g => {
  const li = el("li"), b = el("button", "card ed-addcard");
  b.type = "button";
  const th = el("span", "thumb"); th.append(el("span", "ed-plus", "＋"));
  b.append(th, el("span", "ctitle", "Добавить видео"));
  b.addEventListener("click", () => pickVideos.click());
  li.append(b); g.prepend(li);
  g.querySelectorAll("li[data-id]").forEach(item => {
    const pen = btn("ed-pen", null, e => { e.stopPropagation(); openVideoSheet(item.dataset.id); });
    pen.innerHTML = PEN; pen.setAttribute("aria-label", "Изменить видео");
    item.append(pen);
  });
};
I.hooks.stage = () => placeFrame();
I.hooks.scene = () => buildTools();
I.hooks.render = () => { buildTools(); placeFrame(); };

I.render();
loadFresh().finally(() => { readyDone = true; readyResolve(); });
})();
