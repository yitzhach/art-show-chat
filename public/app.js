// Show Chat beta 1.0: the whole phone app in one file, no build step.
const VERSION = "1.0";
const app = document.getElementById("app");
// A native app wrapper can set these before app.js loads; on the web they're this site.
const API_BASE = (window.SHOW_CHAT_API || "").replace(/\/$/, "");
const SITE = (window.SHOW_CHAT_SITE || location.origin).replace(/\/$/, "");
const WS_BASE = (API_BASE || location.origin).replace(/^http/, "ws");
const imgUrl = (code, id) => `${API_BASE || SITE}/api/show/${code}/img/${id}`;
let AV_CODE = ""; // the show whose profile photos avatars can show

// ---------- storage (wrapped: private windows can throw) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// ---------- small helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/);
  return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
function hue(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function avatar(p, cls = "") {
  if (p && p.photo && AV_CODE) return `<span class="av ph ${cls}" aria-hidden="true"><img src="${esc(imgUrl(AV_CODE, p.photo))}" alt="" loading="lazy"></span>`;
  return `<span class="av ${cls}" style="--h:${hue(p?.id || p?.name)}" aria-hidden="true">${esc(initials(p?.name))}</span>`;
}
function boothTag(m) {
  if (!m) return "";
  if (m.role === "director") return `<span class="booth dir">DIRECTOR</span>`;
  return m.booth ? `<span class="booth">${esc(m.booth)}</span>` : "";
}
function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
function fmtDay(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
function fmtShort(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toDateString() === new Date().toDateString() ? fmtTime(ts) : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function linkify(text) {
  return esc(text).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}
let toastTimer;
function toast(msg, onTap) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  t.classList.toggle("tap", !!onTap);
  t.onclick = onTap ? () => { t.hidden = true; onTap(); } : null;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), onTap ? 5000 : 3200);
}
async function copyText(text, done = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(done); }
  catch { window.prompt("Copy this:", text); }
}
async function shareOrCopy(title, text, url) {
  if (navigator.share) { try { await navigator.share({ title, text, url }); return; } catch (e) { if (e.name === "AbortError") return; } }
  copyText(url, "Link copied");
}
function b64ToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function api(path, { method = "GET", body, token, timeout = 15000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = "Bearer " + token;
    const r = await fetch(API_BASE + "/api" + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctl.signal, cache: "no-store" });
    let data = {};
    try { data = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "No connection. Try again when you have signal." } };
  } finally { clearTimeout(timer); }
}

const ICON = {
  people: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.1 2.5 3.5 5.2"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`,
  refer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h13M12 6l6 6-6 6"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.3-6 8-6s7 2 8 6"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8v.01"/></svg>`,
  megaphone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4h3l7 4V6L7 10H4z"/><path d="M17.5 9.5a3.5 3.5 0 0 1 0 5"/></svg>`,
  qr: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M20 20h-3M14 20v.01"/></svg>`,
};

// ---------- sessions ----------
const sessions = () => store.get("asc.sessions", {});
function saveSession(code, s) { const all = sessions(); all[code] = s; store.set("asc.sessions", all); }
function dropSession(code) {
  const all = sessions(); delete all[code]; store.set("asc.sessions", all);
  for (const k of ["cache", "outbox", "read"]) store.del(`asc.${k}.${code}`);
}
const buyerSessions = () => store.get("asc.buyers", {});
function saveBuyer(key, s) { const all = buyerSessions(); all[key] = s; store.set("asc.buyers", all); }

function setManifest(start, name) {
  const link = document.getElementById("manifest-link");
  if (link) link.href = `/api/manifest?start=${encodeURIComponent(start)}${name ? "&name=" + encodeURIComponent(name) : ""}`;
}
// A sign-in key arrives in the link (?k=…). Keep it, then tidy it out of the address bar.
function takeKeyFromUrl() {
  const q = new URLSearchParams(location.search);
  const hashK = location.hash.match(/^#k=([A-Za-z0-9]{20,})/);
  const k = q.get("k") || (hashK && hashK[1]);
  if (!k) return null;
  q.delete("k");
  const rest = q.toString();
  history.replaceState(null, "", location.pathname + (rest ? "?" + rest : "") + (hashK ? "" : location.hash));
  return /^[A-Za-z0-9]{20,}$/.test(k) ? k : null;
}

// ---------- notifications ----------
async function ensurePush(code, token, { ask = false } = {}) {
  if (!pushSupported()) return { ok: false, reason: isIOS() && !isStandalone() ? "ios-home" : "unsupported" };
  let perm = Notification.permission;
  if (perm === "default" && ask) perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: perm === "denied" ? "denied" : "off" };
  try {
    const reg = await navigator.serviceWorker.ready;
    const k = await api(`/show/${code}/push/key`);
    if (!k.ok) return { ok: false, reason: "offline" };
    const key = b64ToBytes(k.data.key);
    let sub = await reg.pushManager.getSubscription();
    if (sub && sub.options && sub.options.applicationServerKey) {
      const cur = new Uint8Array(sub.options.applicationServerKey);
      if (cur.length !== key.length || cur.some((b, i) => b !== key[i])) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const r = await api(`/show/${code}/push/subscribe`, { method: "POST", token, body: { subscription: sub.toJSON() } });
    return { ok: r.ok, reason: r.ok ? "on" : "offline" };
  } catch (e) {
    console.warn(e);
    return { ok: false, reason: "error" };
  }
}
function alertsHelp(reason) {
  if (reason === "ios-home") return "On iPhone, alerts only work after you add Show Chat to your Home Screen. Tap the Share button, choose Add to Home Screen, then open Show Chat from the new icon and turn alerts on.";
  if (reason === "denied") return "Alerts are blocked for this site. Turn them on in your browser or phone settings for this site, then come back.";
  if (reason === "unsupported") return "This browser can't show alerts. Try Chrome on Android, or Safari on iPhone after adding to the Home Screen.";
  if (reason === "offline") return "Couldn't reach the server. Try again when you have signal.";
  return "Alerts didn't turn on. Try again.";
}

// ---------- photos ----------
async function compressImage(file, max = 1600, quality = 0.82) {
  let src, w, h;
  try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); w = src.width; h = src.height; }
  catch {
    src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    w = src.naturalWidth; h = src.naturalHeight;
  }
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, "image/jpeg", quality));
}
const blobToDataUrl = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
async function uploadPhoto(code, token, dataUrl) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 45000);
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const r = await fetch(`${API_BASE}/api/show/${code}/upload`, { method: "POST", headers: { "content-type": blob.type || "image/jpeg", authorization: "Bearer " + token }, body: blob, signal: ctl.signal });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch { return { ok: false, status: 0, data: {} }; } finally { clearTimeout(timer); }
}
// Wait longer after each failed try (2s, 4s, 8s... up to 30s), with a little randomness so a
// room full of phones coming back onto the wifi doesn't all retry in the same second.
function retryDelay(tries) {
  return Math.min(30000, 2000 * 2 ** Math.min(tries, 4)) + Math.floor(Math.random() * 1500);
}
// Ask for a photo, shrink it on the phone (faster on bad signal), return it as a data URL.
function pickPhoto() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return resolve(null);
      try { resolve(await blobToDataUrl(await compressImage(f))); } catch { toast("Couldn't read that photo."); resolve(null); }
    };
    input.click();
  });
}
// One pick gives a full-size copy and a small one, so booth and piece thumbnails load fast on fair wifi.
function pickPhotoPair() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return resolve(null);
      try { resolve({ full: await blobToDataUrl(await compressImage(f)), thumb: await blobToDataUrl(await compressImage(f, 520, 0.78)) }); }
      catch { toast("Couldn't read that photo."); resolve(null); }
    };
    input.click();
  });
}
// The piece a buyer asked about, shown on their message with its photo.
function pieceCard(code, m) {
  return m.meta && m.meta.piece && m.meta.pimg ? `<span class="pref"><img src="${esc(imgUrl(code, m.meta.pimg))}" alt="" loading="lazy"><span>About <b>${esc(m.meta.piece)}</b></span></span>` : "";
}
function pieceInline(m) {
  return m.meta && m.meta.piece && !m.meta.pimg ? `<b>About ${esc(m.meta.piece)}:</b> ` : "";
}
function photoHtml(src) {
  return `<button type="button" class="photo" data-photo="${esc(src)}" aria-label="Open photo"><img src="${esc(src)}" alt="Photo" loading="lazy"></button>`;
}
document.addEventListener("click", (e) => {
  const p = e.target.closest("[data-photo]");
  if (p) {
    const box = document.createElement("div");
    box.className = "lightbox";
    box.innerHTML = `<img src="${esc(p.dataset.photo)}" alt="Photo"><button class="lb-close" aria-label="Close">✕</button>`;
    box.onclick = () => box.remove();
    document.body.appendChild(box);
  }
});
// ---------- light, dark, or follow the phone ----------
const Theme = {
  get() { const v = store.get("asc.theme", "auto"); return v === "light" || v === "dark" ? v : "auto"; },
  set(v) { store.set("asc.theme", v); Theme.apply(); },
  apply() {
    const v = Theme.get(), root = document.documentElement;
    if (v === "auto") delete root.dataset.theme; else root.dataset.theme = v;
    const dark = v === "dark" || (v === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#151c1d" : "#0d6b63");
  },
};
Theme.apply();
try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => Theme.apply()); } catch {}
function themeHtml() {
  const cur = Theme.get();
  return `<div class="seg theme" role="radiogroup" aria-label="Light or dark">${[["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]].map(([v, l]) => `<button type="button" role="radio" data-theme-pick="${v}" aria-checked="${cur === v}" aria-selected="${cur === v}">${l}</button>`).join("")}</div>`;
}
document.addEventListener("click", (e) => {
  const t = e.target.closest && e.target.closest("[data-theme-pick]");
  if (!t) return;
  Theme.set(t.dataset.themePick);
  for (const b of $$("[data-theme-pick]")) { const on = String(b.dataset.themePick === Theme.get()); b.setAttribute("aria-checked", on); b.setAttribute("aria-selected", on); }
});

// ---------- sounds: a ping when a message comes in, a soft blip when you send ----------
// Phones only let a page play sound after a tap, so the first tap anywhere unlocks it.
const Sound = (() => {
  let ctx = null, on = store.get("asc.sound", true), lastPing = 0;
  function unlock() {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    try {
      if (!ctx) { ctx = new C(); const b = ctx.createBuffer(1, 1, 22050), src = ctx.createBufferSource(); src.buffer = b; src.connect(ctx.destination); src.start(0); }
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
    } catch { ctx = null; }
  }
  for (const ev of ["pointerdown", "touchend", "keydown"]) addEventListener(ev, unlock, { capture: true, passive: true });
  function tone(freq, at, dur, vol, type = "sine") {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(ctx.destination); o.start(at); o.stop(at + dur + 0.02);
  }
  const ready = () => on && ctx && ctx.state === "running" && document.visibilityState === "visible";
  return {
    get on() { return on; },
    set(v) { on = !!v; store.set("asc.sound", on); },
    ping(urgent) {
      if (!ready() || Date.now() - lastPing < 900) return;
      lastPing = Date.now();
      const t = ctx.currentTime;
      try { tone(880, t, 0.16, 0.16); tone(1318.5, t + 0.11, 0.22, 0.13); if (urgent) tone(1760, t + 0.26, 0.24, 0.12); } catch {}
    },
    sent() {
      if (!ready()) return;
      const t = ctx.currentTime;
      try { tone(587, t, 0.09, 0.05, "triangle"); tone(880, t + 0.05, 0.1, 0.04, "triangle"); } catch {}
    },
  };
})();

// Redraw a screen but keep the message box itself, so the phone keyboard stays up
// (and the cursor stays put) while new messages, reactions or typing dots come in.
function drawKeepingComposer(root, html, sel, keep) {
  const oldSec = root.firstElementChild, oc = keep && oldSec ? [...oldSec.children].find((c) => c.matches(sel)) : null;
  const tpl = document.createElement("div");
  tpl.innerHTML = html;
  const newSec = tpl.firstElementChild, nc = oc && newSec ? [...newSec.children].find((c) => c.matches(sel)) : null;
  if (!oc || !nc || oc.dataset.compose !== nc.dataset.compose || oc.id !== nc.id || tpl.children.length !== 1) { root.innerHTML = html; return false; }
  for (const c of [...oldSec.childNodes]) if (c !== oc) oldSec.removeChild(c);
  const kids = [...newSec.childNodes], at = kids.indexOf(nc);
  kids.slice(0, at).forEach((k) => oldSec.insertBefore(k, oc));
  kids.slice(at + 1).forEach((k) => oldSec.appendChild(k));
  for (const a of [...newSec.attributes]) oldSec.setAttribute(a.name, a.value);
  // Placeholder text can change (a renamed group); keep it in step.
  const oi = oc.querySelector("textarea"), ni = nc.querySelector("textarea");
  if (oi && ni && oi.placeholder !== ni.placeholder) oi.placeholder = ni.placeholder;
  return true;
}

// ---------- reactions: double-tap for a heart, press and hold (or right-click) for the rest ----------
const RX = [["heart", "❤️", "Heart"], ["up", "👍", "Thumbs up"], ["down", "👎", "Thumbs down"], ["haha", "😂", "Laugh"], ["bang", "‼️", "Exclamation"], ["q", "❓", "Question"]];
function rxPills(seq, map, me, nameOf) {
  const by = {};
  for (const [who, e] of Object.entries(map || {})) if (e) (by[e] = by[e] || []).push(who);
  const mine = map && map[me];
  const pills = RX.filter(([k]) => by[k]).map(([k, emo, label]) => {
    const n = by[k].length, names = nameOf ? by[k].map(nameOf).join(", ") : "";
    return `<button type="button" class="rxp ${mine === k ? "mine" : ""}" data-rx="${k}" data-rseq="${seq}" aria-pressed="${mine === k}" aria-label="${label}, ${n}${names ? ": " + esc(names) : ""}" title="${esc(names)}">${emo}<span>${n}</span></button>`;
  }).join("");
  return pills ? `<div class="rx">${pills}</div>` : "";
}
let rxPick = null;
function closeRxPick() { if (rxPick) { rxPick.remove(); rxPick = null; } }
function openRxPick(zone, seq, mine, onPick) {
  closeRxPick();
  const textEl = zone.querySelector(".bubble, .tx, .rn");
  const text = textEl ? textEl.textContent.trim() : "";
  const el = document.createElement("div");
  el.className = "rxpick"; el.setAttribute("role", "menu"); el.setAttribute("aria-label", "React");
  el.innerHTML = RX.map(([k, emo, label]) => `<button type="button" role="menuitem" data-pick="${k}" aria-pressed="${mine === k}" aria-label="${label}">${emo}</button>`).join("")
    + (text ? `<button type="button" role="menuitem" class="rxcopy" data-pick="copy">Copy</button>` : "");
  document.body.appendChild(el);
  rxPick = el;
  const r = zone.getBoundingClientRect(), w = el.offsetWidth || 300, h = el.offsetHeight || 54;
  let top = r.top - h - 8;
  if (top < 8) top = Math.min(innerHeight - h - 8, r.bottom + 8);
  el.style.top = Math.max(8, top) + "px";
  el.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]");
    if (!b) return;
    closeRxPick();
    if (b.dataset.pick === "copy") copyText(text, "Copied"); else onPick(b.dataset.pick);
  });
  try { el.querySelector("button").focus({ preventScroll: true }); } catch {}
}
document.addEventListener("pointerdown", (e) => { if (rxPick && !rxPick.contains(e.target)) closeRxPick(); }, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeRxPick(); });
addEventListener("hashchange", closeRxPick);
function reactGestures(root, { mine, toggle }) {
  let press = null, lastTap = null, lastHeart = 0, quietUntil = 0;
  const zoneOf = (t) => (t && t.closest && !t.closest(".rx, .from, a, input, textarea, .avbtn") ? t.closest(".rxz") : null);
  const seqOf = (z) => { const m = z.closest("[data-seq]"); return m ? Number(m.dataset.seq) || 0 : 0; };
  const heart = (seq) => { lastHeart = Date.now(); toggle(seq, "heart"); };
  const pick = (z) => { const seq = seqOf(z); if (seq) openRxPick(z, seq, mine(seq), (e) => toggle(seq, e)); };
  root.addEventListener("dblclick", (e) => {
    const z = zoneOf(e.target);
    if (!z || e.target.closest("[data-photo]")) return;
    const seq = seqOf(z);
    if (!seq || Date.now() - lastHeart < 800) return;
    try { getSelection().removeAllRanges(); } catch {}
    heart(seq);
  });
  root.addEventListener("touchstart", (e) => {
    const z = zoneOf(e.target);
    if (!z || e.touches.length !== 1) { if (press) clearTimeout(press.timer); press = null; return; }
    const t = e.touches[0], seq = seqOf(z);
    press = { x: t.clientX, y: t.clientY, seq, fired: false };
    press.timer = setTimeout(() => {
      if (!press) return;
      press.fired = true; quietUntil = Date.now() + 700;
      try { navigator.vibrate && navigator.vibrate(12); } catch {}
      pick(z);
    }, 480);
  }, { passive: true });
  root.addEventListener("touchmove", (e) => {
    if (!press) return;
    const t = e.touches[0];
    if (Math.abs(t.clientX - press.x) > 10 || Math.abs(t.clientY - press.y) > 10) { clearTimeout(press.timer); press = null; }
  }, { passive: true });
  root.addEventListener("touchcancel", () => { if (press) clearTimeout(press.timer); press = null; });
  root.addEventListener("touchend", (e) => {
    const p = press; press = null;
    if (!p) return;
    clearTimeout(p.timer);
    if (p.fired) { if (e.cancelable) e.preventDefault(); return; }
    const now = Date.now();
    if (lastTap && lastTap.seq === p.seq && now - lastTap.t < 330) {
      lastTap = null;
      if (e.target.closest && e.target.closest("[data-photo]")) return;
      if (e.cancelable) e.preventDefault();
      heart(p.seq);
    } else lastTap = { seq: p.seq, t: now };
  });
  root.addEventListener("contextmenu", (e) => {
    const z = zoneOf(e.target);
    if (!z) return;
    e.preventDefault();
    if (Date.now() < quietUntil) return;
    pick(z);
  });
  root.addEventListener("click", (e) => { if (Date.now() < quietUntil && zoneOf(e.target)) { e.preventDefault(); e.stopPropagation(); } }, true);
}

// The whole conversation as plain text, for carrying it to a text, email or Instagram DM.
function transcript(code, messages, nameOf, header, link) {
  const lines = [header, ""];
  for (const m of messages) {
    if (m.kind === "move" || m.kind === "system") continue;
    const who = nameOf(m.from);
    if (m.meta && m.meta.img) lines.push(`${who}: [photo] ${imgUrl(code, m.meta.img)}`);
    if (m.body) lines.push(`${who}: ${m.body}`);
  }
  if (link) lines.push("", link);
  return lines.join("\n");
}
const smsHref = (phone, body) => `sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(body)}`;
const mailHref = (email, subject, body) => `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
const PHOTO_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="15" rx="3"/><circle cx="12" cy="12.5" r="3.5"/><path d="M8.5 5l1.5-2h4l1.5 2"/></svg>`;

// ---------- QR ----------
function qrSvg(text) {
  const q = qrcode(0, "M"); q.addData(text); q.make();
  const n = q.getModuleCount(); let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c},${r}h1v1h-1z`;
  return `<svg viewBox="-3 -3 ${n + 6} ${n + 6}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect x="-3" y="-3" width="${n + 6}" height="${n + 6}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// ---------- router ----------
function route() {
  const path = location.pathname;
  let m;
  if ((m = path.match(/^\/s\/([A-Za-z0-9]{4,10})\/cards\/?$/))) return Cards(m[1].toUpperCase());
  if ((m = path.match(/^\/s\/([A-Za-z0-9]{4,10})\/?$/))) return Show(m[1].toUpperCase());
  if ((m = path.match(/^\/b\/([A-Za-z0-9]{4,10})\/(m[a-z0-9]{8})\/?$/))) return Buyer(m[1].toUpperCase(), m[2]);
  if ((m = path.match(/^\/v\/([A-Za-z0-9]{4,10})\/?$/))) return Visitor(m[1].toUpperCase());
  if (path === "/new") return CreateShow();
  return Home();
}

// ---------- home ----------
function Home() {
  const q = new URLSearchParams(location.search);
  const mine = Object.entries(sessions());
  const buys = Object.entries(buyerSessions());
  if (!q.has("home")) {
    if (mine.length === 1) return location.replace(`/s/${mine[0][0]}`);
    if (!mine.length && buys.length === 1) return location.replace(`/b/${buys[0][0]}`);
  }
  app.innerHTML = `
  <section class="screen"><div class="scroll"><div class="pad">
    <div><p class="label">Show Chat</p><h1 class="display">Chat with everyone at your show</h1>
    <p class="hint" style="margin-top:8px">Group chat, direct messages, buyer referrals and buyer messages from your QR card.</p></div>
    ${mine.length ? `<div class="field"><p class="label">Your shows</p>${mine.map(([code, s]) => `<a class="person" href="/s/${esc(code)}" style="text-decoration:none;color:inherit"><span class="av" style="--h:${hue(code)}">${esc(code.slice(0, 2))}</span><span class="who"><span class="nm">${esc(s.showName || code)}</span><span class="md">Signed in as ${esc(s.name || "you")}</span></span></a>`).join("")}</div>` : ""}
    <form class="card" id="join-form">
      <label class="label" for="code">Join a show</label>
      <input class="input code" id="code" maxlength="10" autocomplete="off" autocapitalize="characters" placeholder="SHOW CODE" required>
      <button class="btn">Continue</button>
      <p class="hint">Your show director gives you the code.</p>
    </form>
    <div class="or">running a show?</div>
    <a class="btn ghost" href="/new">Start a show chat</a>
    <p class="small" style="text-align:center">Show Chat beta ${VERSION}</p>
  </div></div></section>`;
  $("#join-form").onsubmit = (e) => {
    e.preventDefault();
    const code = $("#code").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length >= 4) location.href = `/s/${code}`;
  };
}

function CreateShow() {
  app.innerHTML = `
  <section class="screen">
    <div class="appbar"><a class="iconbtn" href="/?home" aria-label="Back">${ICON.back}</a><div class="grow"><h2>Start a show chat</h2><div class="sub">You'll be the show director</div></div></div>
    <div class="scroll"><form class="pad" id="f">
      <div class="field"><label class="label" for="name">Show name</label><input class="input" id="name" required maxlength="60" placeholder="Red Dot Miami 2026"></div>
      <div class="row2">
        <div class="field"><label class="label" for="venue">Venue or hall</label><input class="input" id="venue" maxlength="120" placeholder="Mana Wynwood"></div>
        <div class="field"><label class="label" for="dates">Dates</label><input class="input" id="dates" maxlength="80" placeholder="Dec 2–7"></div>
      </div>
      <div class="field"><label class="label" for="director">Your name</label><input class="input" id="director" required maxlength="60" autocomplete="name"></div>
      <div class="field"><label class="label" for="code">Show code (optional)</label><input class="input code" id="code" maxlength="10" autocapitalize="characters" placeholder="REDDOT">
        <p class="hint">Artists type this to join. Leave it empty and we'll make one.</p></div>
      <p class="error" id="e" hidden></p>
      <button class="btn" id="go">Create the show</button>
    </form></div>
  </section>`;
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    $("#go").disabled = true;
    const r = await api("/create", { method: "POST", body: { name: $("#name").value, venue: $("#venue").value, dates: $("#dates").value, director: $("#director").value, code: $("#code").value } });
    $("#go").disabled = false;
    if (!r.ok) { $("#e").textContent = r.data.error || "Couldn't create the show."; $("#e").hidden = false; return; }
    saveSession(r.data.code, { token: r.data.token, id: r.data.me.id, name: r.data.me.name, role: "director", showName: r.data.show.name });
    location.href = `/s/${r.data.code}#welcome`;
  };
}

// ---------- show: join or open the chat ----------
async function Show(code) {
  const k = takeKeyFromUrl();
  if (k) {
    const r = await api(`/show/${code}/sync?since=999999999`, { token: k });
    if (r.ok) {
      const prev = sessions()[code];
      if (prev && prev.token !== k) dropSession(code);
      saveSession(code, { token: k, id: r.data.me.id, name: r.data.me.name, role: r.data.me.role, showName: r.data.show.name });
    } else if (r.status === 401) toast("That sign-in link isn't valid any more. Ask the director for a new one.");
    else if (r.status === 0) saveSession(code, { ...(sessions()[code] || {}), token: k });
  }
  const s = sessions()[code];
  if (s && s.token) return ChatApp(code, s);
  return Join(code);
}

async function Join(code) {
  app.innerHTML = `<section class="screen"><div class="boot">Finding the show…</div></section>`;
  const info = await api(`/show/${code}/info`);
  if (!info.ok) {
    app.innerHTML = `<section class="screen"><div class="empty"><h3>${info.status === 404 ? "No show with that code" : "Can't reach Show Chat"}</h3><p>${esc(info.status === 404 ? `Check the code ${code} with your show director.` : "Check your signal and try again.")}</p><a class="btn ghost small" href="/?home">Back</a></div></section>`;
    return;
  }
  const sh = info.data.show;
  const claimBooth = (new URLSearchParams(location.search).get("booth") || "").slice(0, 12);
  app.innerHTML = `
  <section class="screen">
    <div class="appbar"><a class="iconbtn" href="/?home" aria-label="Back">${ICON.back}</a><div class="grow"><h2>${claimBooth ? "Claim your booth" : "Join the show"}</h2><div class="sub">Show code ${esc(code)}</div></div></div>
    <div class="scroll"><form class="pad" id="f">
      <div class="showcard"><span class="name">${esc(sh.name)}</span><span class="meta">${esc([sh.venue, sh.dates, `${sh.artists} artist${sh.artists === 1 ? "" : "s"} here`].filter(Boolean).join(" · "))}</span></div>
      <div class="field"><label class="label" for="name">Your name</label><input class="input" id="name" required maxlength="60" autocomplete="name" placeholder="As buyers will see it"></div>
      <div class="row2">
        <div class="field"><label class="label" for="booth">Booth</label><input class="input" id="booth" maxlength="12" placeholder="A14" autocapitalize="characters" value="${esc(claimBooth)}"></div>
        <div class="field"><label class="label" for="ig">Instagram</label><input class="input" id="ig" maxlength="60" placeholder="@yourname" autocapitalize="none" autocomplete="off"></div>
      </div>
      <div class="card tint" id="claim" hidden></div>
      <div class="field"><label class="label" for="medium">What you make (optional)</label><input class="input" id="medium" maxlength="80" placeholder="Ceramics, large abstract florals…"></div>
      <p class="error" id="e" hidden></p>
      <button class="btn" id="go">Join ${esc(sh.name)}</button>
      <p class="hint">No password. This phone stays signed in. You can get a link for another device later.</p>
    </form></div>
  </section>`;
  // Booth claiming: visitors may already have saved this booth before the artist joined.
  async function claimCheck() {
    const b = $("#booth").value.trim(), box = $("#claim");
    if (!b) { box.hidden = true; return; }
    const r = await api(`/show/${code}/visit/claim?b=${encodeURIComponent(b)}`);
    if (!r.ok || r.data.claimed || !r.data.savers) { box.hidden = true; return; }
    box.innerHTML = `<p class="hint"><b>${r.data.savers} visitor${r.data.savers === 1 ? "" : "s"} saved Booth ${esc(r.data.booth)} in the show app.</b> Join to see what they liked, add your pieces, and get their messages.</p>`;
    box.hidden = false;
  }
  $("#booth").addEventListener("change", claimCheck);
  if (claimBooth) claimCheck();
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    $("#go").disabled = true;
    const r = await api(`/show/${code}/join`, { method: "POST", body: { name: $("#name").value, booth: $("#booth").value, medium: $("#medium").value, instagram: $("#ig").value } });
    $("#go").disabled = false;
    if (!r.ok) { $("#e").textContent = r.data.error || "Couldn't join."; $("#e").hidden = false; return; }
    saveSession(code, { token: r.data.token, id: r.data.me.id, name: r.data.me.name, role: r.data.me.role, showName: sh.name });
    location.replace(`/s/${code}#welcome`);
    route();
  };
}

// ---------- the chat app ----------
function ChatApp(code, sess) {
  const CK = "asc.cache." + code, OK = "asc.outbox." + code, RK = "asc.read." + code;
  const cached = store.get(CK, {});
  const S = {
    me: cached.me || { id: sess.id, name: sess.name, role: sess.role },
    show: cached.show || { code, name: sess.showName || code },
    members: cached.members || [],
    buyers: cached.buyers || [],
    messages: cached.messages || [],
    lastSeq: cached.lastSeq || 0,
    ann: cached.ann || { artists: 0, delivered: {} },
    outbox: store.get(OK, []),
    read: store.get(RK, {}),
    online: navigator.onLine !== false,
    draft: {},
    followup: null,
    refer: { to: null, status: "Walking over now", q: "" },
    annUrgent: true,
    gallery: cached.gallery || { booth: [], pieces: [] }, galDirty: false, galState: "",
    groups: cached.groups || [], reactions: cached.reactions || {}, rseq: cached.rseq || 0, synced: false,
    ng: { picked: [], q: "" }, gadd: [], typing: {},
    alerts: pushSupported() && Notification.permission === "granted" ? "on" : "off",
    ins: null, insAt: 0, data: null, allBooths: false,
  };
  const token = sess.token;
  AV_CODE = code;
  let ws = null, backoff = 1000, openedAt = 0, sendTries = 0, lastPong = Date.now(), syncing = false, flushing = false, retryTimer = null;
  const origin = SITE;
  const isDirector = () => S.me.role === "director";
  const member = (id) => S.members.find((m) => m.id === id);
  const buyer = (id) => S.buyers.find((b) => b.id === id);
  const dmCh = (other) => "dm:" + [S.me.id, other].sort().join(":");
  const dmOther = (ch) => ch.slice(3).split(":").find((x) => x !== S.me.id);
  const myLink = () => `${origin}/s/${code}?k=${token}`;
  const buyerPage = (id) => `${origin}/b/${code}/${id}`;
  const buyerLink = (b) => `${origin}/b/${code}/${S.me.id}${b.key ? "?k=" + b.key : ""}`;

  function save() {
    const kept = S.messages.slice(-1500), seqs = new Set(kept.map((m) => m.seq)), rx = {};
    for (const k in S.reactions) if (seqs.has(Number(k))) rx[k] = S.reactions[k];
    store.set(CK, { me: S.me, show: S.show, members: S.members, buyers: S.buyers, messages: kept, lastSeq: S.lastSeq, ann: S.ann, gallery: S.gallery, groups: S.groups, reactions: rx, rseq: S.rseq });
  }
  function applyReactions(list) {
    for (const x of list || []) {
      const map = S.reactions[x.seq] || (S.reactions[x.seq] = {});
      if (x.e) map[x.who] = x.e; else delete map[x.who];
      if (!Object.keys(map).length) delete S.reactions[x.seq];
    }
  }
  const saveOutbox = () => store.set(OK, S.outbox);
  const saveRead = () => store.set(RK, S.read);

  function merge(list) {
    if (!list || !list.length) return false;
    const have = new Set(S.messages.map((m) => m.seq));
    let added = false, needSync = false;
    for (const m of list) {
      if (have.has(m.seq)) continue;
      S.messages.push(m); have.add(m.seq); added = true;
      if (S.typing[m.ch]) delete S.typing[m.ch][m.from];
      if (m.kind === "system") needSync = true;
      if (m.ch.startsWith("buy:") && !buyer(m.ch.slice(4))) needSync = true;
      if (!member(m.from) && !m.from.startsWith("b") && m.from !== "system") needSync = true;
      if (m.ch.startsWith("g:") && !S.groups.some((g) => "g:" + g.id === m.ch)) needSync = true;
    }
    if (added) {
      S.messages.sort((a, b) => a.seq - b.seq);
      const ids = new Set(list.map((m) => m.id));
      S.outbox = S.outbox.filter((o) => !ids.has(o.id));
      saveOutbox();
      save();
    }
    if (needSync) setTimeout(sync, 50);
    return added;
  }

  function setOnline(v) {
    if (S.online === v) return;
    S.online = v; render();
  }

  async function sync() {
    if (syncing) return;
    syncing = true;
    const r = await api(`/show/${code}/sync?since=${S.lastSeq}&r=${S.rseq}`, { token });
    syncing = false;
    if (r.status === 401) return signedOut();
    if (!r.ok) { if (r.status === 0) setOnline(false); return; }
    const d = r.data;
    if (d.truncated) S.messages = [];
    S.me = d.me; S.show = d.show; S.members = d.members; S.buyers = d.buyers; S.ann = d.ann;
    if (d.gallery && !S.galDirty) S.gallery = d.gallery;
    if (d.groups) S.groups = d.groups;
    applyReactions(d.reactions);
    if (d.rseq != null) S.rseq = Math.max(S.rseq, d.rseq);
    S.synced = true;
    merge(d.messages);
    S.lastSeq = Math.max(S.lastSeq, d.lastSeq);
    saveSession(code, { ...sess, id: d.me.id, name: d.me.name, role: d.me.role, showName: d.show.name });
    save();
    S.online = true;
    render({ soft: true });
  }

  async function flush() {
    if (flushing || !S.outbox.length) return;
    flushing = true;
    clearTimeout(retryTimer);
    while (S.outbox.length) {
      const item = S.outbox[0];
      if (item.photo) {
        const up = await uploadPhoto(code, token, item.photo);
        if (!up.ok) {
          if (up.status === 0 || up.status >= 500 || up.status === 429) { if (up.status === 0) S.online = false; break; }
          S.outbox.shift(); saveOutbox(); toast(up.data.error || "That photo couldn't be sent."); continue;
        }
        item.meta = { ...(item.meta || {}), img: up.data.id }; delete item.photo; saveOutbox();
      }
      const { photo, ...payload } = item;
      const r = await api(`/show/${code}/send`, { method: "POST", token, body: payload });
      if (r.ok) { sendTries = 0; S.online = true; S.outbox.shift(); saveOutbox(); merge([r.data.message]); continue; }
      if (r.status === 401) { flushing = false; return signedOut(); }
      if (r.status === 0 || r.status >= 500 || r.status === 429) { if (r.status === 0) S.online = false; break; }
      S.outbox.shift(); saveOutbox();
      toast(r.data.error || "That message couldn't be sent.");
    }
    flushing = false;
    if (S.outbox.length) retryTimer = setTimeout(flush, retryDelay(sendTries++));
    render({ soft: true });
  }

  function queue(item) {
    Sound.sent();
    S.outbox.push({ id: uid(), ts: Date.now(), ...item });
    saveOutbox();
    render({ soft: true, stick: true });
    flush();
  }

  function connect() {
    if (ws && ws.readyState <= 1) return;
    try { ws = new WebSocket(`${WS_BASE}/api/show/${code}/ws?t=${encodeURIComponent(token)}`); }
    catch { ws = null; return; }
    ws.onopen = () => { openedAt = Date.now(); lastPong = Date.now(); sendVis(); S.online = true; sync(); flush(); };
    ws.onmessage = (e) => {
      lastPong = Date.now();
      if (e.data === "pong") return;
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d.t === "msg") { if (merge([d.m])) { onIncoming(d.m); render({ soft: true }); } }
      else if (d.t === "sync") sync();
      else if (d.t === "react") { applyReactions([d]); save(); render({ soft: true }); }
      else if (d.t === "typing") gotTyping(d);
      else if (d.t === "insights") { if (view() === "insights" || view() === "buyers") loadIns(); }
    };
    ws.onclose = (e) => {
      ws = null;
      if (e.code === 4001) return signedOut();
      // Only treat the link as healthy if it stayed up a while, so a flaky network doesn't reconnect in a tight loop.
      if (openedAt && Date.now() - openedAt > 15000) backoff = 1000;
      openedAt = 0;
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 20000);
    };
    ws.onerror = () => {};
  }
  // ----- typing dots, like Messages: shown to the others in that chat while you type -----
  const typingSent = {};
  function sendTyping(ch, stop = false) {
    if (!ws || ws.readyState !== 1 || !ch || ch === "ann") return;
    const now = Date.now();
    if (stop) { if (!typingSent[ch]) return; delete typingSent[ch]; }
    else { if (now - (typingSent[ch] || 0) < 2500) return; typingSent[ch] = now; }
    try { ws.send(JSON.stringify({ t: "typing", ch, stop })); } catch {}
  }
  function gotTyping(d) {
    if (d.who === S.me.id) return;
    const map = S.typing[d.ch] || (S.typing[d.ch] = {});
    if (d.stop) delete map[d.who]; else map[d.who] = Date.now() + 6000;
    render({ soft: true });
    if (!d.stop) setTimeout(() => render({ soft: true }), 6100);
  }
  function sendVis() {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: "vis", v: document.visibilityState === "visible" }));
  }
  setInterval(() => {
    if (ws && ws.readyState === 1) {
      if (Date.now() - lastPong > 70000) { try { ws.close(); } catch {} return; }
      ws.send("ping");
    }
  }, 25000);
  setInterval(() => { if (!ws || ws.readyState !== 1) { sync(); connect(); } }, 15000);
  setInterval(() => { if (document.visibilityState === "visible") sync(); }, 60000);
  document.addEventListener("visibilitychange", () => {
    sendVis();
    if (document.visibilityState === "visible") { sync(); flush(); connect(); render({ soft: true }); }
  });
  addEventListener("online", () => { S.online = true; sendTries = 0; sync(); flush(); connect(); render({ soft: true }); });
  addEventListener("offline", () => setOnline(false));
  addEventListener("hashchange", () => render({ stick: true }));
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.t === "push") sync(); });

  function onIncoming(m) {
    if (m.from === S.me.id) return;
    if (m.kind === "system" && !(m.ch.startsWith("g:") && m.meta && m.meta.push && m.meta.by !== S.me.id)) return;
    if (document.visibilityState !== "visible") return; // the phone's own alert covers it
    const urgent = m.kind === "ann" && m.meta && m.meta.urgent;
    Sound.ping(urgent || m.kind === "ref");
    const here = (viewChans(view()) || []).includes(m.ch);
    if (here) return; // it's on screen, or the new-message pill shows it
    const who = nameOf(m.from), pv = preview(m, false);
    const g = m.ch.startsWith("g:") && S.groups.find((x) => "g:" + x.id === m.ch);
    let text;
    if (m.kind === "system") text = m.body;
    else if (m.kind === "ref" && m.meta && m.meta.to === S.me.id) text = `Buyer heading your way from ${who}`;
    else if (m.kind === "ann") text = `${urgent ? "Urgent" : "Announcement"}: ${pv}`;
    else if (m.ch.startsWith("buy:")) text = `Buyer message from ${who}: ${pv}`;
    else if (m.ch.startsWith("g:")) text = `${who} in ${g ? g.name : "a group"}: ${pv}`;
    else if (m.ch === "group") text = `${who} in the show chat: ${pv}`;
    else text = `${who}: ${pv}`;
    toast(text.length > 110 ? text.slice(0, 107) + "…" : text, () => go(chView(m.ch)));
    try { navigator.vibrate && navigator.vibrate(m.kind === "ref" || urgent ? [80, 60, 80] : 50); } catch {}
  }

  function signedOut() {
    dropSession(code);
    app.innerHTML = `<section class="screen"><div class="empty"><h3>You're signed out</h3><p>This phone's sign-in for ${esc(S.show.name)} isn't valid any more. Ask the show director for a new link, or join again.</p><a class="btn small" href="/s/${esc(code)}">Join again</a></div></section>`;
    try { ws && ws.close(); } catch {}
  }

  // ----- unread, counted per tab -----
  const chKey = (ch) => (ch === "ann" ? "group" : ch);
  const counts = (m, ch) => m.from !== S.me.id && (m.kind !== "system" || (ch.startsWith("g:") && m.meta && m.meta.push && m.meta.by !== S.me.id));
  function lastSeqIn(ch) {
    let s = 0;
    for (const m of S.messages) if (chKey(m.ch) === ch && m.seq > s) s = m.seq;
    return s;
  }
  function unread(ch) {
    const r = S.read[ch] || 0;
    let n = 0;
    for (const m of S.messages) if (chKey(m.ch) === ch && m.seq > r && counts(m, ch)) n++;
    return n;
  }
  function unreadPrefix(prefix) {
    const chans = new Set(S.messages.filter((m) => m.ch.startsWith(prefix)).map((m) => m.ch));
    let n = 0; for (const c of chans) n += unread(c); return n;
  }
  const unreadGroups = () => S.groups.reduce((n, g) => n + unread("g:" + g.id), 0);
  function markRead(ch) {
    if (document.visibilityState !== "visible") return;
    const s = lastSeqIn(ch);
    if (s > (S.read[ch] || 0)) { S.read[ch] = s; saveRead(); }
  }
  function updateBadges() {
    const total = unread("group") + unreadPrefix("dm:") + unreadGroups() + unreadPrefix("buy:");
    document.title = (total ? `(${total}) ` : "") + (S.show.name || "Show Chat");
    try { if (navigator.setAppBadge) total ? navigator.setAppBadge(total) : navigator.clearAppBadge(); } catch {}
  }

  // ----- views -----
  function view() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!h) return "group";
    if (h === "direct" || h === "chats") return "dms";
    return h;
  }
  // In-app back: where you came from, else the list the screen belongs to.
  const navStack = [];
  const go = (v) => { const cur = view(); if (cur !== v) { navStack.push(cur); if (navStack.length > 30) navStack.shift(); } location.hash = v; };
  const parentOf = (v) => v === "insights" ? "buyers" : v.startsWith("buy:") ? "buyers" : v.startsWith("dm:") ? "dms" : v.startsWith("ginfo:") ? "g:" + v.slice(6) : v.startsWith("g:") || v === "newgroup" ? "groups" : "group";
  function goBack() {
    const v = view();
    let p = navStack.pop();
    while (p && p === v) p = navStack.pop();
    location.hash = p || parentOf(v);
  }
  const tabs = () => [["group", "Show"], ["dms", "DMs"], ["groups", "Groups"], ...(isDirector() ? [["visitors", "Visitors"]] : [["buyers", "Buyers"]])];
  const viewChans = (v) => v === "group" ? ["group", "ann"] : v.startsWith("dm:") ? [dmCh(v.slice(3))] : v.startsWith("g:") || v.startsWith("buy:") ? [v] : null;
  const chView = (ch) => ch === "group" || ch === "ann" ? "group" : ch.startsWith("dm:") ? "dm:" + dmOther(ch) : ch;
  const groupOf = (gid) => S.groups.find((g) => g.id === gid);
  function nameOf(id) {
    if (id === S.me.id) return "You";
    const m = member(id); if (m) return m.name;
    const b = buyer(id); if (b) return b.name || "A buyer";
    return id && id.startsWith("b") ? "A buyer" : "Someone";
  }
  function preview(m, withName = true) {
    let t = m.kind === "ref" ? "Buyer referral" + (m.body ? ": " + m.body : "") : m.body || (m.meta && m.meta.img ? "Photo" : "");
    if (m.meta && m.meta.piece) t = `About ${m.meta.piece}: ${t}`;
    if (withName && m.kind !== "system") t = (m.from === S.me.id ? "You" : nameOf(m.from).split(/\s+/)[0]) + ": " + t;
    return t;
  }
  const lastIn = (ch) => { for (let i = S.messages.length - 1; i >= 0; i--) if (S.messages[i].ch === ch) return S.messages[i]; return null; };
  const rx = (m) => rxPills(m.seq, S.reactions[m.seq], S.me.id, nameOf);
  const avBtn = (p, cls = "") => p && p.id && member(p.id) ? `<button type="button" class="avbtn" data-profile="${esc(p.id)}" aria-label="${esc(p.name)}, profile">${avatar(p, cls)}</button>` : avatar(p, cls);
  const roomy = (ch) => ch === "group" || ch.startsWith("g:");

  function msgHtml(m, prev) {
    const mine = m.from === S.me.id;
    if (m.kind === "system") return `<p class="sys">${esc(m.body)}</p>`;
    if (m.kind === "move") return `<p class="sys moved">${esc(m.body)}</p>`;
    if (m.kind === "ann") {
      const urgent = m.meta && m.meta.urgent;
      const dir = member(m.from);
      const reach = isDirector() ? ` · reached ${S.ann.delivered[m.seq] ?? 0} of ${S.ann.artists} phones` : "";
      return `<div class="ann-item rxz ${urgent ? "urgent" : ""}" data-seq="${m.seq}"><div class="ah"><span class="kind">${urgent ? "Urgent" : "Announcement"}</span><span class="time">${fmtTime(m.ts)}</span></div><div class="tx">${linkify(m.body)}</div><div class="seen">From ${esc(dir ? dir.name : "the director")}${reach}</div>${rx(m)}</div>`;
    }
    const sender = m.from.startsWith("b") ? buyer(m.from) : member(m.from);
    const name = m.from.startsWith("b") ? (sender && sender.name) || "Visitor" : sender ? sender.name : "Someone";
    if (m.kind === "ref") {
      const to = member(m.meta && m.meta.to);
      const forMe = to && to.id === S.me.id;
      return `<div class="msg ${mine ? "me" : ""}" data-seq="${m.seq}"><div class="body rxz" style="max-width:92%"><p class="from"><b>${esc(mine ? "You" : name)}</b>${boothTag(sender)}<span class="time">${fmtTime(m.ts)}</span></p>
        <div class="refcard"><span class="rt">${forMe ? "Buyer coming to you" : "Buyer referral"}</span>
        <span class="rto">→ ${esc(to ? to.name : "an artist")} ${boothTag(to)}</span>
        ${m.body ? `<span class="rn">${linkify(m.body)}</span>` : ""}${m.meta.status ? `<span class="rs">${esc(m.meta.status)}</span>` : ""}</div>${rx(m)}</div></div>`;
    }
    const cont = prev && prev.from === m.from && prev.kind === m.kind && m.ts - prev.ts < 5 * 60000 && roomy(m.ch);
    const showFrom = !mine && roomy(m.ch);
    return `<div class="msg ${mine ? "me" : ""} ${cont ? "cont" : ""}" data-seq="${m.seq}">
      ${showFrom ? (cont ? `<span class="av sm" style="visibility:hidden"></span>` : avBtn(sender || { id: m.from, name }, "sm")) : ""}
      <div class="body rxz">${showFrom ? `<p class="from"><b>${esc(name)}</b>${boothTag(sender)}<span class="time">${fmtTime(m.ts)}</span></p>` : ""}
      ${pieceCard(code, m)}${m.meta && m.meta.img ? photoHtml(imgUrl(code, m.meta.img)) : ""}${m.body ? `<div class="bubble">${pieceInline(m)}${linkify(m.body)}</div>` : ""}${rx(m)}
      ${!showFrom ? `<span class="state">${fmtTime(m.ts)}</span>` : ""}</div></div>`;
  }
  function pendingHtml(o) {
    return `<div class="msg me pending"><div class="body">${o.photo ? photoHtml(o.photo) : ""}${o.body || o.kind === "ref" ? `<div class="bubble">${o.kind === "ref" ? "Buyer referral" : linkify(o.body)}</div>` : ""}<span class="state">${S.online ? "Sending…" : "Waiting for signal"}</span></div></div>`;
  }
  function typingHtml(chs) {
    const now = Date.now(), who = [];
    for (const ch of chs) for (const [id, t] of Object.entries(S.typing[ch] || {})) if (t > now && id !== S.me.id && !who.includes(id)) who.push(id);
    if (!who.length) return "";
    const first = who.map((id) => nameOf(id).split(/\s+/)[0]);
    const label = first.length === 1 ? `${first[0]} is typing` : first.length === 2 ? `${first[0]} and ${first[1]} are typing` : `${first.length} people are typing`;
    const p = member(who[0]) || { id: who[0], name: nameOf(who[0]) };
    return `<div class="msg typing" role="status">${avatar(p, "sm")}<div class="body"><div class="bubble dots" aria-hidden="true"><i></i><i></i><i></i></div><span class="state">${esc(label)}</span></div></div>`;
  }
  function feed(chs, emptyText) {
    const list = S.messages.filter((m) => chs.includes(m.ch));
    const pend = S.outbox.filter((o) => chs.includes(o.channel));
    const dots = typingHtml(chs);
    if (!list.length && !pend.length) return `<div class="empty"><p>${emptyText}</p></div>${dots ? `<div class="msgs">${dots}</div>` : ""}`;
    let out = "", day = "", prev = null;
    for (const m of list) {
      const d = fmtDay(m.ts);
      if (d !== day) { out += `<p class="daymark">${d}</p>`; day = d; prev = null; }
      out += msgHtml(m, prev); prev = m;
    }
    for (const o of pend) out += pendingHtml(o);
    return `<div class="msgs">${out}${dots}</div>`;
  }
  let pill = 0, seenSeq = 0, stuck = true;
  const pillHtml = () => pill ? `<button type="button" class="newpill" data-act="to-bottom">${pill > 1 ? pill + " new messages" : "New message"} ↓</button>` : "";
  const chatArea = (chs, emptyText) => `<div class="scrollwrap"><div class="scroll" id="scroller">${feed(chs, emptyText)}</div>${pillHtml()}</div>`;

  function banners() {
    let b = "";
    if (!S.online) b += `<div class="banner warn"><span class="grow">No signal right now. ${S.outbox.length ? `${S.outbox.length} message${S.outbox.length > 1 ? "s" : ""} will send when you're back.` : "New messages will show when you're back."}</span></div>`;
    else if (S.outbox.length) b += `<div class="banner"><span class="grow">Sending ${S.outbox.length} message${S.outbox.length > 1 ? "s" : ""}…</span></div>`;
    if (S.alerts !== "on" && !S.read.alertsDismissed) {
      const ios = isIOS() && !isStandalone();
      b += `<div class="banner"><span class="grow">${ios ? "Add Show Chat to your Home Screen to get alerts for buyers and referrals." : "Turn on alerts so you don't miss buyers and referrals."}</span><button data-act="alerts-banner">${ios ? "How" : "Turn on"}</button><button data-act="alerts-dismiss" aria-label="Dismiss">✕</button></div>`;
    }
    return b;
  }
  function pinnedHtml() {
    const since = Date.now() - 24 * 3600e3;
    const p = [...S.messages].reverse().find((m) => m.ch === "ann" && m.meta && m.meta.urgent && m.ts > since);
    if (!p || (S.read.pin || 0) >= p.seq) return "";
    return `<button class="pinned" data-act="unpin" data-seq="${p.seq}"><span class="pl"><span>Pinned · from the director</span><span>Tap to dismiss</span></span><span class="ptx">${linkify(p.body)}</span></button>`;
  }
  function tabsHtml(cur) {
    // Each tab shows how many unread messages it holds, and clears once they're read.
    const badge = { group: unread("group"), dms: unreadPrefix("dm:"), groups: unreadGroups(), buyers: unreadPrefix("buy:") };
    const label = { group: "Show", dms: "DMs", groups: "Groups", buyers: "Buyers", visitors: "Visitors" };
    return `<div class="seg" role="tablist">${tabs().map(([v]) => `<button type="button" role="tab" data-tab="${v}" aria-selected="${cur === v}" aria-label="${label[v]}${badge[v] ? `, ${badge[v]} unread` : ""}">${label[v]}${badge[v] ? ` <span class="badge" aria-hidden="true">${badge[v]}</span>` : ""}</button>`).join("")}</div>`;
  }
  function topBar() {
    const artists = S.members.filter((m) => m.role === "artist").length;
    return `<div class="appbar"><div class="grow"><h2>${esc(S.show.name)}</h2><div class="sub">${esc([`${artists} artist${artists === 1 ? "" : "s"}`, S.show.venue].filter(Boolean).join(" · "))}</div></div>
      <button class="iconbtn" data-go="people" aria-label="Who's here">${ICON.people}</button>
      <button class="iconbtn" data-go="me" aria-label="Your profile and settings">${S.me.photo ? avatar(S.me, "xs") : ICON.gear}</button></div>`;
  }
  function subBar(title, sub, extra = "") {
    return `<div class="appbar"><button class="iconbtn" data-act="back" aria-label="Back">${ICON.back}</button><div class="grow"><h2>${title}</h2>${sub ? `<div class="sub">${sub}</div>` : ""}</div>${extra}</div>`;
  }
  function composer(ch, placeholder, { refer = false, announce = false } = {}) {
    return `<form class="composer" data-compose="${esc(ch)}">
      ${refer ? `<button class="refbtn" type="button" data-go="refer">${ICON.refer}Refer</button>` : ""}
      ${announce ? `<button class="refbtn ann" type="button" data-go="ann">${ICON.megaphone}Announce</button>` : ""}
      <button class="photobtn" type="button" data-act="photo" aria-label="Send a photo">${PHOTO_ICON}</button>
      <textarea class="input" rows="1" id="compose-input" data-draft="c:${esc(ch)}" placeholder="${esc(placeholder)}" aria-label="Message" enterkeyhint="send"></textarea>
      <button class="send" type="submit" aria-label="Send">${ICON.send}</button></form>`;
  }

  // Show tab: the whole show's chat, with the director's announcements in it.
  function vGroup() {
    markRead("group");
    const open = S.show.artistsPost !== false;
    const foot = isDirector() ? composer("group", "Message everyone at the show", { announce: true })
      : open ? composer("group", "Message the show", { refer: true })
      : `<div class="composer readonly"><button class="refbtn" type="button" data-go="refer">${ICON.refer}Refer</button><span class="grow small">Only the show director posts here. Use DMs or Groups to talk with other artists.</span></div>`;
    return `<section class="screen">${topBar()}${tabsHtml("group")}${banners()}${pinnedHtml()}
      ${chatArea(["group", "ann"], open ? "Say hello to the other exhibitors." : "Announcements from the show director show up here.")}
      ${foot}</section>`;
  }
  function convoRow(go, av, title, tag, last, pv, n) {
    return `<button class="convo ${n ? "unread" : ""}" data-go="${esc(go)}">${av}<span class="who"><span class="top"><span class="nm">${title}</span>${tag}${last ? `<span class="time">${fmtShort(last.ts)}</span>` : ""}</span><span class="pv">${esc(pv)}</span></span>${n ? `<span class="badge">${n}</span>` : ""}</button>`;
  }
  // DMs tab: one-to-one conversations, newest first, then everyone you haven't messaged yet.
  function vDMs() {
    const rows = S.members.filter((m) => m.id !== S.me.id).map((m) => { const ch = dmCh(m.id); return { m, ch, last: lastIn(ch), n: unread(ch) }; });
    const talking = rows.filter((r) => r.last).sort((a, b) => b.last.seq - a.last.seq);
    const rest = rows.filter((r) => !r.last).sort((a, b) => a.m.name.localeCompare(b.m.name));
    const row = ({ m, last, n }) => convoRow("dm:" + m.id, avatar(m), esc(m.name), boothTag(m), last, last ? preview(last) : m.role === "director" ? "Show director" : m.medium || "Say hello", n);
    const refer = isDirector() ? "" : `<button class="galrow" data-go="refer"><span class="grow"><b>Send a buyer to another artist</b><span class="small">They get an alert and it shows in your DMs with them</span></span><span aria-hidden="true">›</span></button>`;
    return `<section class="screen">${topBar()}${tabsHtml("dms")}${banners()}
      <div class="scroll">${refer}${talking.map(row).join("")}${rest.length && talking.length ? `<p class="listlabel">Everyone else</p>` : ""}${rest.map(row).join("")}
        ${rows.length ? "" : `<div class="empty"><p>No one else has joined yet. Share the show code ${esc(code)}.</p></div>`}</div></section>`;
  }
  function groupAv(g) {
    const others = g.members.filter((id) => id !== S.me.id).map(member).filter(Boolean).slice(0, 2);
    return `<span class="avstack" aria-hidden="true">${others.map((m) => avatar(m)).join("")}</span>`;
  }
  const groupNames = (g) => g.members.map((id) => (id === S.me.id ? "You" : (member(id) || {}).name || "")).filter(Boolean).map((n) => n.split(/\s+/)[0]).join(", ");
  // Groups tab: chats with only the people their creator added.
  function vGroups() {
    const rows = S.groups.map((g) => { const ch = "g:" + g.id; return { g, last: lastIn(ch), n: unread(ch) }; })
      .sort((a, b) => (b.last ? b.last.seq : 0) - (a.last ? a.last.seq : 0) || b.g.created - a.g.created);
    return `<section class="screen">${topBar()}${tabsHtml("groups")}${banners()}
      <div class="scroll"><button class="galrow" data-go="newgroup"><span class="grow"><b>New group</b><span class="small">Pick who's in it. Only they see it.</span></span><span aria-hidden="true">+</span></button>
        ${rows.length ? rows.map(({ g, last, n }) => convoRow("g:" + g.id, groupAv(g), esc(g.name), `<span class="pill">${g.members.length}</span>`, last, last ? preview(last) : groupNames(g), n)).join("")
          : `<div class="empty"><p>No groups yet. Start one with just the people you pick, like your aisle or the artists sharing a van.</p></div>`}</div></section>`;
  }
  function vGroupChat(gid) {
    const g = groupOf(gid);
    if (!g) return vGone(S.synced ? "You're not in that group any more." : "Opening the group…");
    const ch = "g:" + gid;
    markRead(ch);
    return `<section class="screen">${subBar(esc(g.name), esc(`${g.members.length} people: ${groupNames(g)}`), `<button class="iconbtn" data-go="ginfo:${esc(gid)}" aria-label="Group details">${ICON.info}</button>`)}${banners()}
      ${chatArea([ch], "Only the people in this group see these messages.")}${composer(ch, "Message " + g.name)}</section>`;
  }
  function pickRow(m, on, attr) {
    return `<button type="button" class="choice pick" role="checkbox" aria-checked="${on}" ${attr}="${esc(m.id)}">${avatar(m, "sm")}<span class="who"><span class="nm">${esc(m.name)}</span><br><span class="md">${esc(m.role === "director" ? "Show director" : m.medium || "")}</span></span>${boothTag(m)}<span class="tick" aria-hidden="true">${on ? "✓" : ""}</span></button>`;
  }
  function vGroupInfo(gid) {
    const g = groupOf(gid);
    if (!g) return vGone(S.synced ? "You're not in that group any more." : "Opening the group…");
    const mine = g.creator === S.me.id, creator = member(g.creator);
    const inG = new Set(g.members);
    const people = g.members.map(member).filter(Boolean);
    const others = S.members.filter((m) => !inG.has(m.id));
    const n = S.gadd.filter((id) => !inG.has(id)).length;
    return `<section class="screen">${subBar("Group details", esc(g.name))}
      <div class="scroll"><div class="pad">
        ${mine ? `<form class="card" id="grename-form" data-gid="${esc(gid)}"><h3>Group name</h3><div class="inline"><input class="input" id="g-name" data-draft="gname:${esc(gid)}" value="${esc(g.name)}" maxlength="40" required aria-label="Group name"><button class="btn small ghost">Rename</button></div></form>` : ""}
        <div class="card"><h3>${people.length} people</h3><p class="small">Only these people see the group's messages. ${mine ? "You started it, so you choose who's in it." : `${esc(creator ? creator.name : "The person who started it")} chooses who's in it.`}</p>
          <div>${people.map((m) => `<div class="person">${avBtn(m)}<button type="button" class="who plain" data-profile="${esc(m.id)}"><span class="nm">${esc(m.name)} ${boothTag(m)}${m.id === S.me.id ? `<span class="you">you</span>` : ""}${m.id === g.creator ? `<span class="you">started it</span>` : ""}</span><span class="md">${esc(m.role === "director" ? "Show director" : m.medium || "")}</span></button>${mine && m.id !== S.me.id ? `<button class="btn small ghost" data-act="g-remove" data-id="${esc(m.id)}" data-gid="${esc(gid)}">Remove</button>` : ""}</div>`).join("")}</div>
        </div>
        ${mine && others.length ? `<div class="card"><h3>Add people</h3><div class="choices">${others.map((m) => pickRow(m, S.gadd.includes(m.id), "data-gadd")).join("")}</div><button class="btn" data-act="g-add" data-gid="${esc(gid)}" ${n ? "" : "disabled"}>${n ? `Add ${n} to the group` : "Pick people to add"}</button></div>` : ""}
        <button class="btn danger" data-act="g-leave" data-gid="${esc(gid)}">Leave this group</button>
      </div></div></section>`;
  }
  function vNewGroup() {
    const q = (S.ng.q || "").toLowerCase();
    const all = S.members.filter((m) => m.id !== S.me.id);
    const list = all.filter((m) => !q || S.ng.picked.includes(m.id) || (m.name + " " + (m.medium || "") + " " + (m.booth || "")).toLowerCase().includes(q));
    const n = S.ng.picked.length;
    return `<section class="screen">${subBar("New group", "Only the people you add see it")}
      <div class="scroll"><form class="pad" id="newgroup-form">
        <div class="field"><label class="label" for="ng-name">Group name (optional)</label><input class="input" id="ng-name" data-draft="ngname" maxlength="40" placeholder="Aisle C, van to Wynwood…"></div>
        <div class="field"><label class="label" for="ng-q">Who's in it?</label><input class="input" id="ng-q" data-draft="ngq" placeholder="Search by name, booth or medium" autocomplete="off">
          <div class="choices">${list.map((m) => pickRow(m, S.ng.picked.includes(m.id), "data-gpick")).join("") || `<p class="hint">${all.length ? "No one matches." : "No one else has joined yet."}</p>`}</div></div>
        <button class="btn" ${n ? "" : "disabled"}>${n ? `Start the group with ${n} ${n === 1 ? "person" : "people"}` : "Pick at least one person"}</button>
        <p class="hint">You can add or remove people later. Everyone you add gets an alert.</p>
      </form></div></section>`;
  }
  function vDM(other) {
    const m = member(other);
    if (!m) return vGone("That person isn't in the show any more.");
    const ch = dmCh(other);
    markRead(ch);
    return `<section class="screen">${subBar(esc(m.name), [m.role === "director" ? "Show director" : m.booth ? "Booth " + esc(m.booth) : "", m.private ? "" : esc(m.medium)].filter(Boolean).join(" · "), avBtn(m, "sm"))}${banners()}
      ${chatArea([ch], `Only you and ${esc(m.name)} see this conversation.`)}${composer(ch, "Message " + m.name)}</section>`;
  }
  function vProfile(id) {
    const m = member(id);
    if (!m) return vGone("That person isn't in the show any more.");
    const me = id === S.me.id, hidden = m.private && !me && !isDirector();
    const pic = m.photo ? `<button type="button" class="profphoto" data-photo="${esc(imgUrl(code, m.photo))}" aria-label="Open ${esc(m.name)}'s photo">${avatar(m, "xl")}</button>` : avatar(m, "xl");
    return `<section class="screen">${subBar(me ? "Your profile" : "Profile", "")}
      <div class="scroll"><div class="pad">
        <div class="prof">${pic}<h3>${esc(m.name)}</h3><div class="md">${boothTag(m)}${!hidden && m.medium ? `<span>${esc(m.medium)}</span>` : ""}</div></div>
        ${hidden ? `<p class="hint center">This profile is private.</p>` : `
          ${m.bio ? `<p class="bio">${linkify(m.bio)}</p>` : ""}
          ${m.instagram ? `<div class="btnrow center"><a class="btn small ghost" href="https://instagram.com/${encodeURIComponent(m.instagram)}" target="_blank" rel="noopener">@${esc(m.instagram)} on Instagram</a></div>` : ""}
          ${m.private ? `<p class="small center">${me ? "Your profile is private. Other artists see only your name and photo." : "Private profile. Other artists see only the name and photo."}</p>` : ""}`}
        ${me ? `<button class="btn ghost" data-go="me">Edit your profile</button>` : `<button class="btn" data-go="dm:${esc(m.id)}">Message ${esc(m.name.split(/\s+/)[0])}</button>`}
      </div></div></section>`;
  }
  function vBuyers() {
    if (S.me.role === "artist" && (!S.ins || Date.now() - (S.insAt || 0) > 60000)) setTimeout(loadIns, 0);
    const rows = S.buyers.map((b) => {
      const ch = "buy:" + b.id;
      return { b, last: lastIn(ch), n: unread(ch) };
    }).sort((a, b) => (b.last ? b.last.seq : 0) - (a.last ? a.last.seq : 0));
    const g = S.gallery, ng = g.booth.length + g.pieces.length;
    const galRow = `<button class="galrow" data-go="booth"><span class="grow"><b>Booth and pieces</b><span class="small">${ng ? esc(galSummary().replace("On your QR page now: ", "On your QR page: ")) : "Add photos so buyers can tap a piece to ask about it"}</span></span><span aria-hidden="true">›</span></button>`;
    return `<section class="screen">${topBar()}${tabsHtml("buyers")}${banners()}
      <div class="scroll">${galRow}${insightsRow()}${rows.length ? rows.map(({ b, last, n }) => `<button class="convo ${n ? "unread" : ""}" data-go="buy:${b.id}">${avatar({ id: b.id, name: b.name || "Visitor" })}<span class="who"><span class="top"><span class="nm">${esc(b.name || "Visitor")}</span>${b.phone ? `<span class="pill">Text</span>` : b.email ? `<span class="pill">Email</span>` : ""}${last ? `<span class="time">${fmtShort(last.ts)}</span>` : ""}</span><span class="pv">${last ? esc((last.from === S.me.id ? "You: " : "") + (last.body || (last.meta && last.meta.img ? "Photo" : ""))) : ""}</span></span>${n ? `<span class="badge">${n}</span>` : ""}</button>`).join("")
        : `<div class="empty"><p>When a buyer scans your QR card and sends a message, it shows up here.</p><a class="btn small" href="/s/${esc(code)}/cards?only=me">${ICON.qr} Your QR card</a></div>`}</div></section>`;
  }
  function vBuyer(bid) {
    const b = buyer(bid);
    if (!b) return vGone("That conversation isn't here.");
    const ch = "buy:" + bid;
    markRead(ch);
    const tel = b.phone.replace(/[^\d+]/g, "");
    const contact = (b.phone ? `<a href="sms:${esc(tel)}">Text ${esc(b.phone)}</a><a href="tel:${esc(tel)}">Call</a>` : "") + (b.email ? `<a href="mailto:${esc(b.email)}">Email ${esc(b.email)}</a>` : "");
    const movedLabel = { text: "text", email: "email", instagram: "Instagram" }[b.moved];
    const autoMail = !!(S.show.mail && b.email);
    const canSend = (b.moved === "text" && b.phone) || (b.moved === "email" && b.email && !autoMail);
    const moved = b.moved ? `<div class="followup"><span><b>${esc(b.name || "This buyer")} wants to carry on by ${movedLabel}.</b> ${canSend ? "Send them the whole conversation from your phone in one tap:" : b.moved === "email" && autoMail ? "Show Chat emailed them the conversation, and your replies here go to their email too." : b.moved === "instagram" ? `Look for their message in your Instagram DMs${S.me.instagram ? "" : " (add your Instagram handle under You so buyers can find you)"}.` : "They didn't leave the details for that, so reply here."}</span>${canSend ? `<div class="btnrow"><button class="btn small" data-act="send-thread" data-id="${esc(bid)}" data-via="${b.moved}">${b.moved === "text" ? "Text" : "Email"} the whole conversation</button></div>` : ""}</div>` : "";
    let follow = "";
    if (S.followup && S.followup.bid === bid && (b.phone || (b.email && !autoMail))) {
      const msg = `${S.followup.text}\n\n— ${S.me.name}${S.me.booth ? ", Booth " + S.me.booth : ""}, ${S.show.name}\nKeep chatting here: ${buyerLink(b)}`;
      follow = `<div class="followup"><span>${autoMail ? `Emailed to ${esc(b.name || "them")}. ` : ""}Also send it by ${b.phone ? "text" : "email"} so they see it right away:</span><div class="btnrow">
        ${b.phone ? `<a class="btn small" href="sms:${esc(tel)}?&body=${encodeURIComponent(msg)}" data-act="followed">Text it</a>` : ""}
        ${b.email && !autoMail ? `<a class="btn small ${b.phone ? "ghost" : ""}" href="mailto:${esc(b.email)}?subject=${encodeURIComponent("Your message at " + S.show.name)}&body=${encodeURIComponent(msg)}" data-act="followed">Email it</a>` : ""}
        <button class="btn small ghost" data-act="followed">Skip</button></div></div>`;
    }
    return `<section class="screen">${subBar(esc(b.name || "Visitor"), "Buyer · from your QR card")}
      <div class="contactbar">${contact || `<span class="none">No phone or email. They see your reply when they come back to the page.</span>`}<a href="#" data-act="copy-buyer" data-id="${esc(bid)}">Copy their chat link</a>${b.phone && !b.moved ? `<a href="#" data-act="send-thread" data-id="${esc(bid)}" data-via="text">Text them the whole chat</a>` : ""}</div>${banners()}${moved}
      ${chatArea([ch], "")}${follow}${composer(ch, "Reply to " + (b.name || "this buyer"))}</section>`;
  }
  function vGone(text) {
    return `<section class="screen">${subBar("Not found", "")}<div class="empty"><p>${esc(text)}</p></div></section>`;
  }
  // The director's announcement screen, opened from the Show tab.
  function vAnn() {
    const list = S.messages.filter((m) => m.ch === "ann").reverse();
    const pend = S.outbox.filter((o) => o.channel === "ann");
    const n = S.ann.artists;
    return `<section class="screen">${subBar("Announcement", "Every artist gets an alert. It shows in the Show tab.")}${banners()}
      <div class="scroll"><div class="pad">
        ${pend.map((o) => `<div class="ann-item ${o.meta.urgent ? "urgent" : ""}"><div class="ah"><span class="kind">${o.meta.urgent ? "Urgent" : "Announcement"}</span><span>${S.online ? "Sending…" : "Waiting for signal"}</span></div><div class="tx">${esc(o.body)}</div></div>`).join("")}
        ${list.length ? list.map((m) => `<div class="ann-item ${m.meta && m.meta.urgent ? "urgent" : ""}"><div class="ah"><span class="kind">${m.meta && m.meta.urgent ? "Urgent, pinned" : "Announcement"}</span><span class="time">${fmtDay(m.ts)} ${fmtTime(m.ts)}</span></div><div class="tx">${linkify(m.body)}</div><div class="seen">Reached ${S.ann.delivered[m.seq] ?? 0} of ${n} artists' phones</div>${rx(m)}</div>`).join("") : pend.length ? "" : `<p class="hint">Announcements go one way, from you to every exhibitor, with an alert. Urgent ones stay pinned at the top of the Show tab for a day.</p>`}
      </div></div>
      <form class="sticky-foot" id="ann-form"><label class="label" for="ann-msg">New announcement</label>
        <textarea class="textarea" id="ann-msg" data-draft="ann" style="min-height:70px" placeholder="Load-out starts at 5pm Sunday…" required></textarea>
        <div class="chips"><button type="button" class="chip" data-urgent="0" aria-pressed="${!S.annUrgent}">Info</button><button type="button" class="chip urgent" data-urgent="1" aria-pressed="${S.annUrgent}">Urgent, pin it</button></div>
        <button class="btn">Send to all ${n} exhibitor${n === 1 ? "" : "s"}</button></form></section>`;
  }
  function vRefer() {
    const q = S.refer.q.toLowerCase();
    const opts = S.members.filter((m) => m.id !== S.me.id && m.role === "artist" && (!q || (m.name + " " + m.medium + " " + m.booth).toLowerCase().includes(q)));
    return `<section class="screen">${subBar("Refer a buyer", "They get a heads-up right away")}
      <div class="scroll"><form class="pad" id="refer-form">
        <div class="field"><label class="label" for="ref-q">Who should they go see?</label>
          <input class="input" id="ref-q" data-draft="refq" placeholder="Search by name, booth or medium" autocomplete="off">
          <div class="choices" role="radiogroup" aria-label="Artist">${opts.map((m) => `<button type="button" class="choice" role="radio" aria-checked="${S.refer.to === m.id}" data-to="${m.id}">${avatar(m, "sm")}<span class="who"><span class="nm">${esc(m.name)}</span><br><span class="md">${esc(m.medium || "")}</span></span>${boothTag(m)}</button>`).join("") || `<p class="hint">No other artists match.</p>`}</div></div>
        <div class="field"><label class="label" for="ref-note">What are they looking for?</label><textarea class="textarea" id="ref-note" data-draft="refnote" placeholder="Wants a large abstract floral, around 40×40 in…"></textarea></div>
        <div class="field"><p class="label">Where's the buyer now?</p><div class="chips">${["Walking over now", "Coming by later", "Took your card"].map((s) => `<button type="button" class="chip" data-status="${s}" aria-pressed="${S.refer.status === s}">${s}</button>`).join("")}</div></div>
        <button class="btn ref" ${S.refer.to ? "" : "disabled"}>Send heads-up</button>
        <p class="hint">It goes to them as an alert and shows in your DMs with them.</p>
      </form></div></section>`;
  }
  function vPeople() {
    const dir = isDirector();
    return `<section class="screen">${subBar("Who's here", `${S.members.length} at the show`)}
      <div class="scroll"><div class="pad" style="gap:0">
        ${S.members.map((m) => `<div class="person"><button class="person" style="border:0;padding:0" data-go="p:${m.id}">${avatar(m)}<span class="who"><span class="nm">${esc(m.name)} ${boothTag(m)}${m.id === S.me.id ? `<span class="you">you</span>` : ""}${m.private && m.id !== S.me.id ? `<span class="you">private</span>` : ""}</span><span class="md">${esc([m.medium, m.instagram ? "@" + m.instagram : ""].filter(Boolean).join(" · ") || (m.role === "director" ? "Show director" : ""))}</span></span></button>
          ${dir && m.id !== S.me.id ? `<button class="btn small ghost" data-act="link" data-id="${m.id}">Sign-in link</button>` : ""}</div>`).join("")}
        ${dir ? `<form class="card" id="add-form" style="margin-top:18px"><h3>Add someone yourself</h3><p class="hint">Creates their account and gives you a sign-in link to text them. Or just share the show code ${esc(code)}.</p>
          <div class="row2"><input class="input" id="add-name" placeholder="Name" required maxlength="60"><input class="input" id="add-booth" placeholder="Booth" maxlength="12"></div>
          <label class="hint" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="add-dir"> Co-organizer (can post announcements)</label>
          <button class="btn">Add and get link</button></form>` : ""}
      </div></div></section>`;
  }
  function vMe() {
    const me = S.me, dir = isDirector();
    const ios = isIOS() && !isStandalone();
    return `<section class="screen">${subBar("You", esc(S.show.name))}
      <div class="scroll"><div class="pad">
        ${location.hash === "#welcome" || view() === "welcome" ? "" : ""}
        <form class="card" id="me-form"><h3>Your profile</h3>
          <div class="photorow">${avatar(me, "lg")}<div class="btnrow"><button type="button" class="btn small ghost" data-act="me-photo">${me.photo ? "Change photo" : "Add a photo"}</button>${me.photo ? `<button type="button" class="linkbtn" data-act="me-photo-del">Remove</button>` : ""}</div></div>
          <div class="field"><label class="label" for="me-name">Name</label><input class="input" id="me-name" data-draft="me:name" value="${esc(me.name)}" maxlength="60" required></div>
          <div class="row2"><div class="field"><label class="label" for="me-booth">Booth</label><input class="input" id="me-booth" data-draft="me:booth" value="${esc(me.booth || "")}" maxlength="12"></div>
          <div class="field"><label class="label" for="me-ig">Instagram</label><input class="input" id="me-ig" data-draft="me:ig" value="${esc(me.instagram ? "@" + me.instagram : "")}" maxlength="60" autocapitalize="none" placeholder="@yourname"></div></div>
          <div class="field"><label class="label" for="me-medium">What you make</label><input class="input" id="me-medium" data-draft="me:medium" value="${esc(me.medium || "")}" maxlength="80"></div>
          <div class="field"><label class="label" for="me-bio">About you</label><textarea class="textarea" id="me-bio" data-draft="me:bio" maxlength="300" placeholder="A line or two about your work">${esc(me.bio || "")}</textarea></div>
          <label class="check"><input type="checkbox" id="me-private" ${me.private ? "checked" : ""}> Keep my profile private</label>
          <p class="small" style="margin-top:-4px">Other artists then see only your name and photo when they tap it. The show director still sees your full profile, and your QR page for buyers stays the same.</p>
          ${me.role === "artist" ? `<p class="label" style="margin-top:4px">How buyers can reach you outside the app (optional)</p>
          <div class="row2"><div class="field"><label class="label" for="me-phone">Phone for texts</label><input class="input" id="me-phone" data-draft="me:phone" type="tel" value="${esc(me.phone || "")}" maxlength="30" autocomplete="tel"></div>
          <div class="field"><label class="label" for="me-email">Email</label><input class="input" id="me-email" data-draft="me:email" type="email" value="${esc(me.email || "")}" maxlength="120" autocomplete="email"></div></div>
          <p class="small">If you add these, buyers on your QR page get one-tap buttons to move the chat to text or email, with the whole conversation.${S.show.mail ? " Your email also gets buyer messages whenever alerts aren't on for this phone." : ""}</p>` : ""}
          <button class="btn ghost">Save</button></form>
        <div class="card"><h3>Alerts</h3>
          ${S.alerts === "on" ? `<p class="hint">Alerts are on for this phone. You'll get buyer messages, referrals, direct messages and announcements.</p><div class="btnrow"><button class="btn small ghost" data-act="test-alert">Send me a test alert</button></div>`
            : ios ? `<p class="hint"><b>On iPhone, add Show Chat to your Home Screen first.</b></p><ol class="hint" style="margin:0;padding-left:18px"><li>Tap the Share button at the bottom of Safari.</li><li>Choose <b>Add to Home Screen</b>, then Add.</li><li>Open Show Chat from the new icon and tap Turn on alerts.</li></ol><p class="small">You stay signed in on the Home Screen app.</p>`
            : `<p class="hint">Get a buzz when a buyer messages you or another artist sends you a buyer.</p><button class="btn" data-act="alerts-on">Turn on alerts</button><p class="small" id="alert-help"></p>`}
        </div>
        <div class="card"><h3>Sounds and look</h3>
          <label class="check"><input type="checkbox" id="me-sound" ${Sound.on ? "checked" : ""}> Play a sound when a message comes in</label>
          <p class="label" style="margin-top:6px">Light or dark</p>${themeHtml()}<p class="small">Auto follows your phone's setting.</p></div>
        ${me.role === "artist" || !dir ? `<div class="card"><h3>Booth and pieces</h3><p class="hint">${esc(galSummary())}</p><div class="btnrow"><button class="btn small" data-go="booth">${S.gallery.booth.length || S.gallery.pieces.length ? "Edit booth photos" : "Add booth photos"}</button></div></div>` : ""}
        ${me.role === "artist" || !dir ? `<div class="card"><h3>Your QR card</h3><p class="hint">Buyers scan it to message you. No app or account for them.</p><div class="btnrow"><a class="btn small" href="/s/${esc(code)}/cards?only=me">${ICON.qr} Show or print it</a><button class="btn small ghost" data-act="copy" data-text="${esc(buyerPage(me.id))}">Copy your buyer link</button></div></div>` : ""}
        ${dir ? `<div class="card tint"><h3>Invite artists</h3><p class="hint">Artists open the link, or type the code on the home page.</p>
          <div class="copyline"><code>${esc(code)}</code><button class="btn small" data-act="share-invite">Share invite</button></div>
          <div class="btnrow"><a class="btn small ghost" href="/s/${esc(code)}/cards">Print QR cards for all artists</a></div></div>
          <form class="card" id="show-form"><h3>Show details</h3>
            <input class="input" id="sh-name" value="${esc(S.show.name)}" maxlength="60" required aria-label="Show name">
            <div class="row2"><input class="input" id="sh-venue" value="${esc(S.show.venue || "")}" maxlength="120" placeholder="Venue" aria-label="Venue"><input class="input" id="sh-dates" value="${esc(S.show.dates || "")}" maxlength="80" placeholder="Dates" aria-label="Dates"></div>
            <label class="check"><input type="checkbox" id="sh-artists" ${S.show.artistsPost !== false ? "checked" : ""}> Artists can post in the Show tab</label>
            <p class="small" style="margin-top:-4px">Turn this off to make the Show tab announcements only. Artists still have DMs and Groups.</p>
            <div class="field"><label class="label" for="sh-comm">Commission the show takes on sales, % (0 if none)</label><input class="input" id="sh-comm" inputmode="decimal" value="${esc(S.show.commission || 0)}" maxlength="5"></div>
            <p class="small">With a commission, sales that artists record in Show Chat are shared with you. Without one, only sales artists choose to share.</p>
            <button class="btn ghost">Save show details</button></form>` : ""}
        <div class="card"><h3>Use another phone or computer</h3><p class="hint">This is your private sign-in link. Don't share it: anyone with it can post as you.</p><div class="btnrow"><button class="btn small ghost" data-act="copy" data-text="${esc(myLink())}">Copy my sign-in link</button></div></div>
        <button class="btn danger" data-act="leave">Sign out on this phone</button>
        <p class="small" style="text-align:center">Show Chat beta ${VERSION} · show code ${esc(code)}</p>
      </div></div></section>`;
  }
  function galSummary() {
    const g = S.gallery, nb = g.booth.length, np = g.pieces.length;
    if (!nb && !np) return "Add booth shots and a photo of each piece once you're set up. Buyers see them when they scan your card and can tap a piece to ask about it.";
    return `On your QR page now: ${nb} booth photo${nb === 1 ? "" : "s"} and ${np} piece${np === 1 ? "" : "s"}.`;
  }
  function galStateText() {
    return { uploading: "Adding the photo…", pending: "Saving…", saving: "Saving…", saved: "Saved. Buyers see this now.", error: "Not saved yet. It saves by itself when you have signal." }[S.galState] || "";
  }
  function vBooth() {
    const g = S.gallery;
    const tile = (x, act, i) => `<div class="galtile"><button type="button" class="galimg" data-photo="${esc(imgUrl(code, x.img))}" aria-label="Open photo"><img src="${esc(imgUrl(code, x.thumb || x.img))}" alt="" loading="lazy"></button><button type="button" class="galx" data-act="${act}" data-i="${i}" aria-label="Remove this photo">✕</button></div>`;
    return `<section class="screen">${subBar("Booth and pieces", "What buyers see when they scan your card")}
      <div class="scroll"><div class="pad">
        <p class="hint">Take these once your booth is set up. They show at the top of your QR page, and a buyer can tap a piece to ask you about it.</p>
        <div class="card"><h3>Booth shots</h3><p class="small">Up to 8. Put a wide one of the whole booth first.</p>
          <div class="galgrid">${g.booth.map((x, i) => tile(x, "gal-del-shot", i)).join("")}${g.booth.length < 8 ? `<button type="button" class="galadd" data-act="gal-add-shot">+ Add a booth photo</button>` : ""}</div></div>
        <div class="card"><h3>Pieces</h3><p class="small">One photo per piece. A title and price help, and you can mark a piece sold.</p>
          ${g.pieces.map((pc, i) => `<div class="pieceedit">
            <button type="button" class="pthumb" data-photo="${esc(imgUrl(code, pc.img))}" aria-label="Open photo"><img src="${esc(imgUrl(code, pc.thumb || pc.img))}" alt="" loading="lazy"></button>
            <div class="pfields">
              <input class="input" data-pf="title" data-i="${i}" value="${esc(pc.title)}" maxlength="60" placeholder="Title" aria-label="Title">
              <div class="row2"><input class="input" data-pf="price" data-i="${i}" value="${esc(pc.price)}" maxlength="30" placeholder="Price" aria-label="Price"><input class="input" data-pf="note" data-i="${i}" value="${esc(pc.note)}" maxlength="120" placeholder="Size or note" aria-label="Size or note"></div>
              <div class="prow"><label class="check"><input type="checkbox" data-pf="sold" data-i="${i}" ${pc.sold ? "checked" : ""}> Sold</label><button type="button" class="linkbtn" data-act="gal-del-piece" data-i="${i}">Remove</button></div>
            </div></div>`).join("")}
          ${g.pieces.length < 40 ? `<button type="button" class="btn ghost" data-act="gal-add-piece">${PHOTO_ICON} Add a piece</button>` : ""}
        </div>
        <p class="small" id="gal-state" aria-live="polite">${galStateText()}</p>
        <div class="btnrow"><a class="btn small ghost" href="/b/${esc(code)}/${esc(S.me.id)}" target="_blank" rel="noopener">Preview your buyer page</a></div>
      </div></div></section>`;
  }
  const setGalState = (st) => { S.galState = st; const el = $("#gal-state"); if (el) el.textContent = galStateText(); };
  let galTimer = null, galRev = 0, galTries = 0;
  function galQueue() { S.galDirty = true; galRev++; setGalState("pending"); clearTimeout(galTimer); galTimer = setTimeout(galSave, 700); }
  async function galSave() {
    clearTimeout(galTimer);
    S.galDirty = true;
    const rev = galRev;
    setGalState("saving");
    const r = await api(`/show/${code}/gallery`, { method: "POST", token, body: S.gallery });
    if (r.ok) {
      galTries = 0;
      // Keep anything typed while the save was on its way; the next save sends it.
      if (rev === galRev) { S.gallery = r.data.gallery; S.galDirty = false; setGalState("saved"); }
      save();
      return;
    }
    if (r.status === 401) return signedOut();
    if (r.status === 0 || r.status >= 500 || r.status === 429) { setGalState("error"); galTimer = setTimeout(galSave, retryDelay(galTries++)); return; }
    setGalState(""); toast(r.data.error || "Couldn't save your booth photos.");
  }
  async function galAdd(kind) {
    const ph = await pickPhotoPair();
    if (!ph) return;
    setGalState("uploading");
    const [a, b] = await Promise.all([uploadPhoto(code, token, ph.full), uploadPhoto(code, token, ph.thumb)]);
    if (!a.ok || !b.ok) {
      setGalState("");
      toast(a.status === 0 || b.status === 0 ? "No signal right now. Add the photo again when you're connected." : (a.data.error || b.data.error || "That photo couldn't be added."));
      return;
    }
    const item = { img: a.data.id, thumb: b.data.id };
    if (kind === "shot") S.gallery.booth.push(item);
    else S.gallery.pieces.push({ id: "p" + uid().replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 10), ...item, title: "", price: "", note: "", sold: false });
    galRev++;
    render();
    if (kind === "piece") { const el = $$('[data-pf="title"]').pop(); if (el) el.focus(); }
    await galSave();
  }
  app.addEventListener("input", (e) => {
    const f = e.target.dataset && e.target.dataset.pf;
    if (!f || f === "sold") return;
    const pc = S.gallery.pieces[Number(e.target.dataset.i)];
    if (pc) { pc[f] = e.target.value; galQueue(); }
  });
  app.addEventListener("change", async (e) => {
    const pref = e.target.dataset && e.target.dataset.pref;
    if (pref) {
      const r = await api(`/show/${code}/me`, { method: "POST", token, body: { [pref]: e.target.checked } });
      if (!r.ok) { e.target.checked = !e.target.checked; return toast(r.data.error || "Couldn't save. Check your signal."); }
      S.me = r.data.me; save(); toast("Saved"); return;
    }
    if (!(e.target.dataset && e.target.dataset.pf === "sold")) return;
    const pc = S.gallery.pieces[Number(e.target.dataset.i)];
    if (pc) { pc.sold = e.target.checked; galQueue(); }
  });

  // ----- visitor numbers: the artist's own, and the show's totals -----
  const money = (cents) => "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
  let insBusy = false, dataBusy = false;
  async function loadIns() {
    if (insBusy) return; insBusy = true; S.insAt = Date.now();
    const r = await api(`/show/${code}/insights`, { token });
    insBusy = false;
    if (r.ok) { S.ins = r.data; S.insAt = Date.now(); if (view() === "insights" || view() === "buyers") { lastHtml = ""; render(); } }
    else if (r.status === 401) signedOut();
  }
  async function loadData() {
    if (dataBusy) return; dataBusy = true; S.dataAt = Date.now();
    const r = await api(`/show/${code}/data`, { token });
    dataBusy = false;
    if (r.ok) { S.data = r.data; if (view() === "visitors") { lastHtml = ""; render(); } }
    else if (r.status === 401) signedOut();
  }
  function hourBars(hours) {
    if (!hours || !hours.length) return `<p class="small">Shows up once visitors start stopping by.</p>`;
    const last = hours.slice(-14), max = Math.max(...last.map((x) => x.n));
    return `<div class="bars">${last.map((x) => `<div class="barrow"><span class="bl">${esc(new Date(x.h).toLocaleString([], { weekday: "short", hour: "numeric" }))}</span><span class="bt"><span style="width:${Math.max(4, Math.round((x.n / max) * 100))}%"></span></span><span class="bn">${x.n}</span></div>`).join("")}</div>`;
  }
  const tile = (n, label) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`;
  function insightsRow() {
    const i = S.ins;
    const txt = i ? (i.savers ? `${i.savers} visitor${i.savers === 1 ? "" : "s"} saved your work${i.leads.length ? ` · ${i.leads.length} want to hear from you` : ""}` : "Who saves your pieces, and visitors who want to hear from you") : "Who saves your pieces, and visitors who want to hear from you";
    return `<button class="galrow" data-go="insights"><span class="grow"><b>Visitor favorites</b><span class="small">${esc(txt)}</span></span><span aria-hidden="true">›</span></button>`;
  }
  function vInsights() {
    const i = S.ins;
    if (!i) { loadIns(); return `<section class="screen">${subBar("Visitor favorites", esc(S.show.name))}<div class="boot">Loading…</div></section>`; }
    if (Date.now() - (S.insAt || 0) > 30000) setTimeout(loadIns, 0);
    const me = S.me;
    const piecesHtml = i.pieces.length ? i.pieces.map((p) => `<div class="insrow"><img src="${esc(imgUrl(code, p.thumb))}" alt="" loading="lazy"><span class="grow"><b>${esc(p.title)}</b><span class="small">${esc([p.price, p.sold ? "Sold" : ""].filter(Boolean).join(" · "))}</span></span><span class="insn">${HEART(true)} ${p.saves}</span><span class="insn">${p.asks} ask${p.asks === 1 ? "" : "s"}</span></div>`).join("") : `<p class="small">Add piece photos so visitors can save them. <a href="#booth" data-go="booth">Add photos</a></p>`;
    const leadsHtml = i.leads.length ? i.leads.map((l) => `<div class="lead"><span class="grow"><b>${esc(l.name || "A visitor")}</b><span class="small">Saved ${esc(l.saved.slice(0, 4).join(", "))}${l.saved.length > 4 ? ` and ${l.saved.length - 4} more` : ""}</span></span>
        <span class="btnrow">${l.phone ? `<a class="btn small ghost" href="${esc(smsHref(l.phone, `Hi${l.name ? " " + l.name.split(/\s+/)[0] : ""}, it's ${S.me.name} from ${S.show.name}. Thanks for saving my work!`))}">Text</a>` : ""}${l.email ? `<a class="btn small ghost" href="${esc(mailHref(l.email, `From ${S.me.name} at ${S.show.name}`, `Hi${l.name ? " " + l.name.split(/\s+/)[0] : ""},\n\nThanks for saving my work at ${S.show.name}.\n\n${S.me.name}`))}">Email</a>` : ""}</span></div>`).join("") : `<p class="small">Visitors who save your work and say yes to hearing from artists show up here.</p>`;
    const sold = i.sales.reduce((t, x) => t + x.amount, 0);
    return `<section class="screen">${subBar("Visitor favorites", esc(S.show.name))}
      <div class="scroll"><div class="pad">
        <div class="stats">${tile(i.savers, "saved your work")}${tile(i.visits, "stopped by")}${tile(i.leads.length, "want to hear from you")}</div>
        ${i.rank ? `<p class="hint">You're <b>#${i.rank.place} of ${i.rank.of}</b> booths at this show for visitors saving their work. Other artists' numbers stay private.</p>` : ""}
        ${i.early ? `<div class="card tint"><p class="hint"><b>${i.early} visitor${i.early === 1 ? "" : "s"} saved your booth before you joined.</b> They're counted here now.</p></div>` : ""}
        <div class="card"><h3>Your pieces</h3><p class="small">Saves are hearts from visitors. Asks are buyer messages about the piece.</p>${piecesHtml}</div>
        <div class="card"><h3>Want to hear from you</h3>${leadsHtml}</div>
        <div class="card"><h3>Busiest hours at your booth</h3>${hourBars(i.hours)}</div>
        <form class="card" id="sale-form"><h3>Record a sale</h3>
          <p class="small">${i.commission ? `${esc(S.show.name)} takes a ${i.commission}% commission, so sales you record here are shared with the show.` : i.salesShared ? "You chose to share recorded sales with the show." : "Only you see your sales unless you choose to share them below."} No payment happens here.</p>
          <select class="input" id="sale-piece" aria-label="Piece"><option value="">Something not listed</option>${i.pieces.map((p) => `<option value="${esc(p.id)}">${esc(p.title)}${p.price ? " · " + esc(p.price) : ""}</option>`).join("")}</select>
          <div class="row2"><input class="input" id="sale-amount" inputmode="decimal" placeholder="Amount, $" aria-label="Amount" required><select class="input" id="sale-source" aria-label="When"><option value="show">At the show</option><option value="after">After the show</option></select></div>
          <input class="input" id="sale-title" maxlength="60" placeholder="Title (if not listed)" aria-label="Title">
          <button class="btn ghost">Record sale</button>
          ${i.sales.length ? `<p class="label">Recorded: ${i.sales.length} · ${money(sold)}</p>${i.sales.map((x) => `<div class="insrow"><span class="grow"><b>${esc(x.title || "Sale")}</b><span class="small">${money(x.amount)} · ${x.source === "after" ? "after the show" : "at the show"} · ${fmtShort(x.created)}${x.commissionRate ? ` · ${x.commissionRate}% commission ${money(x.commission)}` : ""}</span></span><button type="button" class="linkbtn" data-act="sale-del" data-id="${esc(x.id)}">Remove</button></div>`).join("")}` : ""}
        </form>
        <div class="card"><h3>What the show sees</h3>
          <p class="small">The show sees visitor totals by booth: visits, scans and saves. It never sees your chats, your buyers or your prices${i.commission ? ", and only sees sales because it takes a commission" : ", or your sales unless you share them"}.</p>
          <label class="check"><input type="checkbox" data-pref="privateStats" ${me.privateStats ? "checked" : ""}> Keep my name out of the show's visitor report</label>
          <label class="check"><input type="checkbox" data-pref="shareStats" ${me.shareStats ? "checked" : ""}> Share my results with the show (saves, visits, top pieces)</label>
          ${i.commission ? "" : `<label class="check"><input type="checkbox" data-pref="shareSales" ${me.shareSales ? "checked" : ""}> Share my recorded sales with the show</label>`}
        </div>
      </div></div></section>`;
  }
  function vVisitors() {
    const d = S.data;
    if (!d) { loadData(); return `<section class="screen">${topBar()}${tabsHtml("visitors")}<div class="boot">Loading…</div></section>`; }
    if (Date.now() - (S.dataAt || 0) > 30000) setTimeout(loadData, 0);
    const t = d.totals;
    const visitorUrl = `${origin}/v/${code}`;
    const unclaimed = d.booths.filter((b) => !b.claimed && b.savers > 0);
    const boothRows = d.booths.filter((b) => b.visitors || b.savers || b.claimed).slice(0, S.allBooths ? 500 : 25);
    return `<section class="screen">${topBar()}${tabsHtml("visitors")}
      <div class="scroll"><div class="pad">
        <div class="stats">${tile(t.visitors, "visitors in the app")}${tile(t.savers, "saved something")}${tile(t.saves, "saves")}${tile(t.visits, "booth visits")}${tile(t.qrScans, "booth QR scans")}${tile(t.typed, "booth numbers typed")}</div>
        <div class="card tint"><h3>Visitor QR</h3><p class="hint">Put this on tickets, the entrance sign and the map. Visitors open the show, type a booth number or scan a booth, and save what they like.</p>
          <div class="copyline"><code>${esc(visitorUrl.replace(/^https?:\/\//, ""))}</code><button class="btn small" data-act="copy" data-text="${esc(visitorUrl)}">Copy</button></div>
          <div class="btnrow"><a class="btn small ghost" href="/s/${esc(code)}/cards?visitor=1">Print the visitor QR</a><a class="btn small ghost" href="/v/${esc(code)}" target="_blank" rel="noopener">Open the visitor app</a></div></div>
        <div class="card"><h3>Show map (optional)</h3><p class="small">${d.show.map ? "Visitors see this map in the app." : "Add a photo of the floor plan with booth numbers. Without one, visitors type booth numbers."}</p>
          ${d.show.map ? `<button type="button" class="mapimg" data-photo="${esc(imgUrl(code, d.show.map.img))}"><img src="${esc(imgUrl(code, d.show.map.thumb || d.show.map.img))}" alt="Show map"></button>` : ""}
          <div class="btnrow"><button class="btn small ghost" data-act="map-add">${d.show.map ? "Replace the map" : "Add a map photo"}</button>${d.show.map ? `<button class="btn small ghost" data-act="map-del">Remove</button>` : ""}</div></div>
        <div class="card"><h3>Busiest hours</h3><p class="small">Visitors stopping at booths, by hour.</p>${hourBars(d.hours)}</div>
        <div class="card"><h3>Booths</h3><p class="small">Visitors who stopped by and who saved something, per booth. Totals only: no sales, prices or chats.</p>
          <div class="btable"><div class="bth"><span>Booth</span><span>Stopped</span><span>Saved</span></div>${boothRows.map((b) => `<div class="btr"><span><span class="booth">${esc(b.booth)}</span> ${esc(b.artist ? b.artist.name : b.claimed ? "Name kept private" : "Not on Show Chat")}</span><span>${b.visitors}</span><span>${b.savers}</span></div>`).join("") || `<p class="small">No booth activity yet.</p>`}</div>
          ${!S.allBooths && d.booths.length > 25 ? `<button class="btn small ghost" data-act="all-booths">Show all booths</button>` : ""}</div>
        <div class="card"><h3>Unclaimed booths</h3>${unclaimed.length ? `<p class="small">Visitors saved these booths, but the artist isn't on Show Chat. Hand them a claim card: it shows how many people saved their work.</p>
          ${unclaimed.map((b) => `<div class="insrow"><span class="booth">${esc(b.booth)}</span><span class="grow">${b.savers} visitor${b.savers === 1 ? "" : "s"} saved it</span></div>`).join("")}
          <div class="btnrow"><a class="btn small ghost" href="/s/${esc(code)}/cards?claim=${esc(unclaimed.map((b) => b.booth).join(","))}">Print claim cards</a></div>` : `<p class="small">When visitors save a booth whose artist hasn't joined, it shows up here.</p>`}</div>
        <div class="card"><h3>Visitor contacts</h3><p class="small">${t.shareShow} visitor${t.shareShow === 1 ? "" : "s"} said yes to sharing their contact with the show. Only those are listed.</p>
          ${d.contacts.slice(0, 15).map((c) => `<div class="insrow"><span class="grow"><b>${esc(c.name || "Visitor")}</b><span class="small">${esc([c.email, c.phone].filter(Boolean).join(" · "))} · ${c.saves} saved</span></span></div>`).join("")}
          ${d.contacts.length ? `<div class="btnrow"><a class="btn small ghost" href="${esc(`${API_BASE}/api/show/${code}/data/contacts-csv?t=${encodeURIComponent(token)}`)}" download>Download all (CSV)</a></div>` : ""}</div>
        <div class="card"><h3>Favorites recap</h3><p class="small">${t.recapWanted} visitor${t.recapWanted === 1 ? "" : "s"} asked for their favorites by email after the fair${t.recapSent ? `, ${t.recapSent} sent` : ""}.</p>
          ${d.mailOn ? `<button class="btn small" data-act="recap-send">Send recap emails now</button>` : `<p class="small">Recap emails are off until email is set up for Show Chat. Nothing is sent until then.</p>`}</div>
        ${d.shared.length ? `<div class="card"><h3>Artists sharing their results</h3>${d.shared.map((a) => `<div class="insrow"><span class="booth">${esc(a.booth)}</span><span class="grow"><b>${esc(a.name)}</b><span class="small">${a.savers} saved · ${a.visits} stopped by · ${a.buyerChats} buyer chats${a.pieces.length ? ` · top: ${esc(a.pieces[0].title)}` : ""}</span></span></div>`).join("")}</div>` : ""}
        <div class="card"><h3>Sales and commission</h3>
          ${d.show.commission ? `<p class="small">Commission is set to ${d.show.commission}%. Artists see that sales they record are shared with the show.</p>` : `<p class="small">Only sales artists choose to share show here. If the show takes a commission, set it under You › Show details.</p>`}
          ${d.sales.length ? `<div class="stats">${tile(d.salesTotals.count, "sales")}${tile(money(d.salesTotals.amount), "total")}${d.show.commission ? tile(money(d.salesTotals.commission), "commission") : ""}</div>
          ${d.sales.slice(0, 30).map((x) => `<div class="insrow"><span class="booth">${esc(x.booth)}</span><span class="grow"><b>${esc(x.artist)}</b><span class="small">${esc(x.title || "Sale")} · ${money(x.amount)}${x.commission ? ` · ${money(x.commission)} commission` : ""} · ${fmtShort(x.created)}</span></span></div>`).join("")}` : `<p class="small">No shared sales yet.</p>`}</div>
        <p class="small">You see visitor totals by booth. Artists' chats, buyers and prices stay private to them, and visitors choose what contact they share.</p>
      </div></div></section>`;
  }

  function vWelcome() {
    const dir = isDirector();
    return `<section class="screen">${subBar(dir ? "Your show is ready" : "You're in", esc(S.show.name))}
      <div class="scroll"><div class="pad">
        <div class="showcard"><span class="name">${esc(S.show.name)}</span><span class="meta">Show code ${esc(code)}</span></div>
        ${dir ? `<p>Send artists the invite. They join with their name and booth, no password.</p><button class="btn" data-act="share-invite">Share invite link</button>
          <p class="hint">Keep your own sign-in link somewhere safe, in case you switch phones.</p><button class="btn ghost" data-act="copy" data-text="${esc(myLink())}">Copy my director link</button>`
          : `<p>Your QR card lets buyers message you straight from your booth.</p><a class="btn" href="/s/${esc(code)}/cards?only=me">${ICON.qr} See your QR card</a>
            <button class="btn ghost" data-go="booth">Add booth and piece photos</button>`}
        ${pushSupported() ? `<button class="btn ghost" data-act="alerts-on">Turn on alerts</button>` : isIOS() ? `<button class="btn ghost" data-go="me">Get alerts on iPhone</button>` : ""}
        <button class="btn ghost" data-go="group">Go to the show chat</button>
      </div></div></section>`;
  }

  // ----- render (keeps typing, focus and scroll position across updates) -----
  let lastHtml = "";
  function render(opts = {}) {
    const v = view();
    if (opts.soft && ["refer", "me", "people", "welcome", "booth", "insights", "visitors"].includes(v)) { updateBadges(); return; }
    const prevScroller = $("#scroller");
    const wasAtBottom = !prevScroller || nearBottom(prevScroller);
    const prevTop = prevScroller ? prevScroller.scrollTop : 0;
    const active = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.draft : null;
    const sameView = app.dataset.view === v;
    // Scrolled up reading older messages? New ones from others show a pill instead of jumping you down.
    const chans = viewChans(v);
    let top = 0, fresh = 0;
    if (chans) for (const m of S.messages) if (chans.includes(m.ch) && m.from !== S.me.id && m.kind !== "system") { if (m.seq > top) top = m.seq; if (m.seq > seenSeq) fresh++; }
    if (!sameView || wasAtBottom || opts.stick) pill = 0;
    else if (top > seenSeq) pill += fresh;
    seenSeq = top;
    let html;
    if (v === "group") html = vGroup();
    else if (v === "dms") html = vDMs();
    else if (v === "groups") html = vGroups();
    else if (v === "newgroup") html = vNewGroup();
    else if (v === "buyers") html = vBuyers();
    else if (v === "ann" && isDirector()) html = vAnn();
    else if (v === "refer") html = vRefer();
    else if (v === "people") html = vPeople();
    else if (v === "me") html = vMe();
    else if (v === "welcome") html = vWelcome();
    else if (v === "booth") html = vBooth();
    else if (v === "insights") html = vInsights();
    else if (v === "visitors" && isDirector()) html = vVisitors();
    else if (v.startsWith("dm:")) html = vDM(v.slice(3));
    else if (v.startsWith("buy:")) html = vBuyer(v.slice(4));
    else if (v.startsWith("ginfo:")) html = vGroupInfo(v.slice(6));
    else if (v.startsWith("g:")) html = vGroupChat(v.slice(2));
    else if (v.startsWith("p:")) html = vProfile(v.slice(2));
    else html = vGroup();
    if (sameView && html === lastHtml) { updateBadges(); return; }
    lastHtml = html;
    drawKeepingComposer(app, html, "form.composer", sameView);
    app.dataset.view = v;
    for (const el of $$("[data-draft]")) {
      const k = el.dataset.draft;
      if (el._bound) continue;
      el._bound = true;
      if (S.draft[k] != null) el.value = S.draft[k];
      el.addEventListener("input", () => { S.draft[k] = el.value; if (el.tagName === "TEXTAREA" && el.id === "compose-input") { autosize(el); sendTyping(k.slice(2), !el.value.trim()); } if (k === "refq") { S.refer.q = el.value; rerenderKeepFocus(); } if (k === "ngq") { S.ng.q = el.value; rerenderKeepFocus(); } });
      if (k === active && document.activeElement !== el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch {} }
    }
    const ci = $("#compose-input"); if (ci) autosize(ci);
    const sc = $("#scroller");
    if (sc) {
      sc.scrollTop = !sameView || wasAtBottom || opts.stick ? sc.scrollHeight : prevTop;
      stuck = nearBottom(sc);
      sc.addEventListener("scroll", () => {
        closeRxPick();
        stuck = nearBottom(sc);
        if (stuck && pill) { pill = 0; const p = $(".newpill"); if (p) p.remove(); lastHtml = ""; }
      }, { passive: true });
      // Photos load after the text: keep the newest message in view while they do.
      for (const img of $$("img", sc)) if (!img.complete) img.addEventListener("load", () => { if (stuck) sc.scrollTop = sc.scrollHeight; }, { once: true });
    }
    updateBadges();
    if (isIOS() && !isStandalone()) {
      // iPhone keeps a separate sign-in for Home Screen apps, so the address carries the key while adding it.
      const want = v === "me" && S.alerts !== "on";
      const has = new URLSearchParams(location.search).has("k");
      if (want && !has) history.replaceState(null, "", `/s/${code}?k=${token}#me`);
      else if (!want && has) history.replaceState(null, "", `/s/${code}${location.hash}`);
    }
  }
  function rerenderKeepFocus() { render(); }
  const nearBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  function autosize(el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 140) + "px"; }

  // ----- events -----
  app.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-go],[data-tab],[data-act],[data-to],[data-status],[data-urgent],[data-profile],[data-gpick],[data-gadd],[data-rx]");
    if (!t) return;
    if (t.tagName === "A" && t.getAttribute("href") === "#") e.preventDefault();
    if (t.dataset.go) { e.preventDefault(); return go(t.dataset.go); }
    if (t.dataset.tab) { navStack.length = 0; history.replaceState(null, "", "#" + t.dataset.tab); return render({ stick: true }); }
    if (t.dataset.profile) return go("p:" + t.dataset.profile);
    if (t.dataset.rx) return react(Number(t.dataset.rseq), t.dataset.rx);
    if (t.dataset.gpick) { const id = t.dataset.gpick, l = S.ng.picked; S.ng.picked = l.includes(id) ? l.filter((x) => x !== id) : [...l, id]; return render(); }
    if (t.dataset.gadd) { const id = t.dataset.gadd, l = S.gadd; S.gadd = l.includes(id) ? l.filter((x) => x !== id) : [...l, id]; return render(); }
    if (t.dataset.to) { S.refer.to = t.dataset.to; return render(); }
    if (t.dataset.status) { S.refer.status = t.dataset.status; return render(); }
    if (t.dataset.urgent) { S.annUrgent = t.dataset.urgent === "1"; return render(); }
    const act = t.dataset.act;
    if (act === "back") { e.preventDefault(); return goBack(); }
    if (act === "to-bottom") { pill = 0; t.remove(); lastHtml = ""; const sc = $("#scroller"); if (sc) sc.scrollTo({ top: sc.scrollHeight, behavior: "smooth" }); return; }
    if (act === "me-photo") {
      const ph = await pickPhotoPair(); if (!ph) return;
      toast("Adding your photo…");
      const up = await uploadPhoto(code, token, ph.thumb);
      if (!up.ok) return toast(up.status === 0 ? "No signal right now. Try again when you're connected." : up.data.error || "That photo couldn't be added.");
      return saveMe({ photo: up.data.id }, "Photo saved");
    }
    if (act === "me-photo-del") return saveMe({ photo: "" }, "Photo removed");
    if (act === "g-add" || act === "g-remove") {
      const gid = t.dataset.gid, g = groupOf(gid); if (!g) return;
      const body = act === "g-add" ? { id: gid, add: S.gadd } : { id: gid, remove: [t.dataset.id] };
      if (act === "g-remove" && !confirm(`Remove ${nameOf(t.dataset.id)} from ${g.name}?`)) return;
      const r = await api(`/show/${code}/group/members`, { method: "POST", token, body });
      if (!r.ok) return toast(r.status === 0 ? "No signal right now. Try again when you're connected." : r.data.error || "Couldn't change the group.");
      if (act === "g-add") S.gadd = [];
      putGroup(r.data.group); render(); sync(); return;
    }
    if (act === "g-leave") {
      const gid = t.dataset.gid, g = groupOf(gid); if (!g) return;
      if (!confirm(`Leave ${g.name}? You'll stop getting its messages${g.creator === S.me.id && g.members.length > 1 ? ", and someone else in it will look after it" : ""}.`)) return;
      const r = await api(`/show/${code}/group/leave`, { method: "POST", token, body: { id: gid } });
      if (!r.ok) return toast(r.status === 0 ? "No signal right now. Try again when you're connected." : r.data.error || "Couldn't leave the group.");
      S.groups = S.groups.filter((x) => x.id !== gid); save();
      navStack.length = 0; toast(`You left ${g.name}`); location.hash = "groups"; sync(); return;
    }
    if (act === "unpin") { S.read.pin = Number(t.dataset.seq); saveRead(); return render(); }
    if (act === "alerts-dismiss") { S.read.alertsDismissed = true; saveRead(); return render(); }
    if (act === "alerts-banner") { if (isIOS() && !isStandalone()) return go("me"); return turnOnAlerts(); }
    if (act === "alerts-on") return turnOnAlerts();
    if (act === "test-alert") {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification("Show Chat", { body: "Alerts are working on this phone.", icon: "/icon-192.png", badge: "/badge-96.png" });
      return;
    }
    if (act === "copy") return copyText(t.dataset.text);
    if (act === "all-booths") { S.allBooths = true; lastHtml = ""; return render(); }
    if (act === "map-add" || act === "map-del") {
      let body = { img: null };
      if (act === "map-add") {
        const ph = await new Promise((resolve) => { const input = document.createElement("input"); input.type = "file"; input.accept = "image/*"; input.onchange = async () => { const f = input.files && input.files[0]; if (!f) return resolve(null); try { resolve({ full: await blobToDataUrl(await compressImage(f, 2400, 0.85)), thumb: await blobToDataUrl(await compressImage(f, 900, 0.8)) }); } catch { resolve(null); } }; input.click(); });
        if (!ph) return;
        toast("Adding the map…");
        const [a, b] = await Promise.all([uploadPhoto(code, token, ph.full), uploadPhoto(code, token, ph.thumb)]);
        if (!a.ok || !b.ok) return toast(a.data.error || b.data.error || "Couldn't add the map. Check your signal.");
        body = { img: a.data.id, thumb: b.data.id };
      } else if (!confirm("Remove the show map from the visitor app?")) return;
      const r = await api(`/show/${code}/map`, { method: "POST", token, body });
      if (!r.ok) return toast(r.data.error || "Couldn't save the map.");
      toast(act === "map-add" ? "Map added. Visitors see it now." : "Map removed");
      return loadData();
    }
    if (act === "recap-send") {
      if (!confirm(`Email every visitor who asked for their favorites recap now? Each person gets it once.`)) return;
      const r = await api(`/show/${code}/recap/send`, { method: "POST", token, timeout: 60000 });
      toast(r.ok ? `Sent ${r.data.sent} recap email${r.data.sent === 1 ? "" : "s"}${r.data.left ? `, ${r.data.left} left: press again` : ""}` : r.data.error || "Couldn't send.");
      return loadData();
    }
    if (act === "sale-del") {
      if (!confirm("Remove this recorded sale?")) return;
      const r = await api(`/show/${code}/sale`, { method: "POST", token, body: { remove: t.dataset.id } });
      if (!r.ok) return toast(r.data.error || "Couldn't remove it.");
      return loadIns();
    }
    if (act === "gal-add-shot") return galAdd("shot");
    if (act === "gal-add-piece") return galAdd("piece");
    if (act === "gal-del-shot") { S.gallery.booth.splice(Number(t.dataset.i), 1); galRev++; render(); return galSave(); }
    if (act === "gal-del-piece") {
      const pc = S.gallery.pieces[Number(t.dataset.i)];
      if (!pc || !confirm(`Remove ${pc.title || "this piece"} from your QR page?`)) return;
      S.gallery.pieces.splice(Number(t.dataset.i), 1); galRev++; render(); return galSave();
    }
    if (act === "photo") {
      const form = t.closest("form"); const ch = form && form.dataset.compose;
      const photo = await pickPhoto(); if (!photo || !ch) return;
      const input = $("#compose-input"); const body = input ? input.value.trim() : "";
      if (input) { input.value = ""; S.draft["c:" + ch] = ""; }
      queue({ channel: ch, body, photo });
      return;
    }
    if (act === "send-thread") {
      const b = buyer(t.dataset.id); if (!b) return;
      const msgs = S.messages.filter((m) => m.ch === "buy:" + b.id);
      const nameOf = (id) => (id === S.me.id ? S.me.name : b.name || "You");
      const txt = transcript(code, msgs, nameOf, `Our conversation from ${S.show.name} (${S.me.name}${S.me.booth ? ", Booth " + S.me.booth : ""}):`, `Keep chatting here: ${buyerLink(b)}`);
      location.href = t.dataset.via === "email" ? mailHref(b.email, `Our conversation from ${S.show.name}`, txt) : smsHref(b.phone, txt);
      return;
    }
    if (act === "copy-buyer") { e.preventDefault(); const b = buyer(t.dataset.id); return b && copyText(buyerLink(b), "Their chat link is copied"); }
    if (act === "followed") { S.followup = null; setTimeout(render, 300); return; }
    if (act === "share-invite") return shareOrCopy(S.show.name, `Join the ${S.show.name} show chat. Code ${code}:`, `${origin}/s/${code}`);
    if (act === "leave") {
      if (!confirm("Sign out of this show on this phone? You'll need your sign-in link to get back in as yourself.")) return;
      dropSession(code); location.href = "/?home"; return;
    }
    if (act === "link") {
      const m = member(t.dataset.id);
      const r = await api(`/show/${code}/member/link`, { method: "POST", token, body: { id: t.dataset.id } });
      if (!r.ok) return toast(r.data.error || "Couldn't make a link.");
      const link = `${origin}/s/${code}?k=${r.data.token}`;
      shareOrCopy(S.show.name, `${m ? m.name + ", h" : "H"}ere's your sign-in link for the ${S.show.name} show chat:`, link);
      toast("New link made. Their old sign-in stops working.");
    }
  });
  app.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.dataset.compose) {
      const ch = f.dataset.compose;
      const input = $("#compose-input");
      const body = input.value.trim();
      if (!body) return;
      input.value = ""; S.draft["c:" + ch] = ""; sendTyping(ch, true);
      if (ch.startsWith("buy:")) S.followup = { bid: ch.slice(4), text: body };
      queue({ channel: ch, body });
      input.focus();
      return;
    }
    if (f.id === "refer-form") {
      if (!S.refer.to) return;
      const to = member(S.refer.to);
      const toId = S.refer.to;
      queue({ channel: dmCh(toId), kind: "ref", body: (S.draft.refnote || "").trim(), meta: { to: toId, status: S.refer.status } });
      S.draft.refnote = ""; S.draft.refq = ""; S.refer = { to: null, status: "Walking over now", q: "" };
      toast(`Heads-up sent to ${to ? to.name : "them"}`);
      history.replaceState(null, "", "#dm:" + toId); render({ stick: true });
      return;
    }
    if (f.id === "ann-form") {
      const body = $("#ann-msg").value.trim();
      if (!body) return;
      S.draft.ann = "";
      queue({ channel: "ann", body, meta: { urgent: S.annUrgent } });
      return;
    }
    if (f.id === "me-form") {
      const body = { name: $("#me-name").value, booth: $("#me-booth").value, medium: $("#me-medium").value, instagram: $("#me-ig").value, bio: $("#me-bio").value, private: $("#me-private").checked };
      if ($("#me-phone")) { body.phone = $("#me-phone").value; body.email = $("#me-email").value; }
      return saveMe(body, "Saved");
    }
    if (f.id === "newgroup-form") {
      if (!S.ng.picked.length) return;
      const id = "g" + uid().replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 12);
      const btn = f.querySelector("button.btn"); if (btn) btn.disabled = true;
      const r = await api(`/show/${code}/group/create`, { method: "POST", token, body: { id, name: (S.draft.ngname || "").trim(), members: S.ng.picked } });
      if (btn) btn.disabled = false;
      if (!r.ok) return toast(r.status === 0 ? "No signal right now. Try again when you're connected." : r.data.error || "Couldn't start the group.");
      putGroup(r.data.group);
      S.ng = { picked: [], q: "" }; S.draft.ngname = ""; S.draft.ngq = "";
      navStack.length = 0; navStack.push("groups");
      history.replaceState(null, "", "#g:" + r.data.group.id); render({ stick: true }); sync(); return;
    }
    if (f.id === "grename-form") {
      const gid = f.dataset.gid, name = $("#g-name").value.trim(); if (!name) return;
      const r = await api(`/show/${code}/group/rename`, { method: "POST", token, body: { id: gid, name } });
      if (!r.ok) return toast(r.status === 0 ? "No signal right now. Try again when you're connected." : r.data.error || "Couldn't rename the group.");
      delete S.draft["gname:" + gid]; putGroup(r.data.group); toast("Renamed"); render(); sync(); return;
    }
    if (f.id === "sale-form") {
      const r = await api(`/show/${code}/sale`, { method: "POST", token, body: { piece: $("#sale-piece").value, amount: $("#sale-amount").value, source: $("#sale-source").value, title: $("#sale-title").value } });
      if (!r.ok) return toast(r.data.error || "Couldn't record the sale.");
      toast(r.data.sale.piece ? "Sale recorded and marked sold" : "Sale recorded");
      sync(); return loadIns();
    }
    if (f.id === "show-form") {
      const r = await api(`/show/${code}/show`, { method: "POST", token, body: { name: $("#sh-name").value, venue: $("#sh-venue").value, dates: $("#sh-dates").value, artistsPost: $("#sh-artists").checked, commission: $("#sh-comm") ? $("#sh-comm").value : undefined } });
      if (!r.ok) return toast(r.data.error || "Couldn't save. Check your signal.");
      S.show = r.data.show; toast("Show details saved"); sync(); return;
    }
    if (f.id === "add-form") {
      const r = await api(`/show/${code}/member/add`, { method: "POST", token, body: { name: $("#add-name").value, booth: $("#add-booth").value, role: $("#add-dir").checked ? "director" : "artist" } });
      if (!r.ok) return toast(r.data.error || "Couldn't add them.");
      const link = `${origin}/s/${code}?k=${r.data.token}`;
      await sync(); render();
      shareOrCopy(S.show.name, `${r.data.member.name}, here's your sign-in link for the ${S.show.name} show chat:`, link);
    }
  });
  app.addEventListener("change", (e) => { if (e.target.id === "me-sound") { Sound.set(e.target.checked); if (e.target.checked) setTimeout(() => Sound.ping(), 50); } });
  app.addEventListener("keydown", (e) => {
    if (e.target.id === "compose-input" && e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer: fine)").matches) {
      e.preventDefault(); e.target.form.requestSubmit();
    }
  });

  function putGroup(g) {
    if (!g) return;
    const i = S.groups.findIndex((x) => x.id === g.id);
    if (i >= 0) S.groups[i] = g; else S.groups.push(g);
    save();
  }
  async function saveMe(body, done) {
    const r = await api(`/show/${code}/me`, { method: "POST", token, body });
    if (!r.ok) return toast(r.status === 0 ? "Couldn't save. Check your signal." : r.data.error || "Couldn't save.");
    S.me = r.data.me;
    const i = S.members.findIndex((x) => x.id === S.me.id);
    if (i >= 0) S.members[i] = { ...S.members[i], ...S.me };
    for (const k of Object.keys(S.draft)) if (k.startsWith("me:")) delete S.draft[k];
    save(); toast(done); render(); sync();
  }
  // One reaction per person per message: tap the same one again to take it off.
  async function react(seq, e) {
    if (!seq) return;
    const before = (S.reactions[seq] || {})[S.me.id] || "";
    const next = before === e ? "" : e;
    applyReactions([{ seq, who: S.me.id, e: next }]);
    render({ soft: true });
    const r = await api(`/show/${code}/react`, { method: "POST", token, body: { seq, e: next } });
    if (r.status === 401) return signedOut();
    if (!r.ok) {
      applyReactions([{ seq, who: S.me.id, e: before }]); render({ soft: true });
      return toast(r.status === 0 ? "No signal right now. Try that again when you're connected." : r.data.error || "Couldn't add that reaction.");
    }
    save();
  }
  reactGestures(app, { mine: (seq) => (S.reactions[seq] || {})[S.me.id] || "", toggle: react });

  async function turnOnAlerts() {
    const r = await ensurePush(code, token, { ask: true });
    S.alerts = r.ok ? "on" : "off";
    if (r.ok) toast("Alerts are on");
    else { toast(alertsHelp(r.reason)); const h = $("#alert-help"); if (h) h.textContent = alertsHelp(r.reason); if (r.reason === "ios-home") go("me"); }
    render();
  }

  // ----- start -----
  setManifest(`/s/${code}?k=${token}`, S.show.name);
  render({ stick: true });
  sync().then(() => { connect(); flush(); });
  if (S.alerts === "on") ensurePush(code, token).then((r) => { if (!r.ok && r.reason !== "offline") { S.alerts = "off"; render({ soft: true }); } });
}

// ---------- buyer page (from the QR card) ----------
async function Buyer(code, artistId) {
  const key = `${code}/${artistId}`;
  const k = takeKeyFromUrl();
  if (k) saveBuyer(key, { token: k });
  // Coming from the visitor app (?from=v), or straight from the booth's QR card. ?piece= opens with that piece picked.
  const qs = new URLSearchParams(location.search);
  const fromApp = qs.get("from") === "v", wantPiece = qs.get("piece") || null;
  if (fromApp || wantPiece) history.replaceState(null, "", location.pathname + location.hash);
  const V = visitorState(code);
  if (!V.S.via) V.S.via = fromApp ? "show" : "artist";
  const CK = "asc.bcache." + key;
  const cached = store.get(CK, {});
  AV_CODE = code;
  let typingUntil = 0, typingSentAt = 0;
  const B = { artist: cached.artist || null, show: cached.show || null, buyer: cached.buyer || null, gallery: cached.gallery || null, piece: null, reactions: cached.reactions || {}, messages: cached.messages || [], outbox: store.get("asc.boutbox." + key, []), online: true, alerts: pushSupported() && Notification.permission === "granted" ? "on" : "off" };
  let ws = null, backoff = 1000, openedAt = 0, flushing = false, lastHtml = "", sendTries = 0, retryTimer = null, lastPong = Date.now();

  let info = await api(`/show/${code}/artist?id=${artistId}`, { timeout: 10000 });
  if (!info.ok && info.status !== 404 && !B.artist) {
    // Weak signal at the booth: say so and keep trying by itself.
    app.innerHTML = `<section class="screen"><div class="empty"><h3>Waiting for signal</h3><p>This page will open by itself as soon as your phone connects.</p><button class="btn small" onclick="location.reload()">Try again</button></div></section>`;
    for (let i = 0; i < 40 && !info.ok && info.status !== 404; i++) {
      await new Promise((r) => { const t = setTimeout(r, retryDelay(i)); addEventListener("online", () => { clearTimeout(t); r(); }, { once: true }); });
      info = await api(`/show/${code}/artist?id=${artistId}`, { timeout: 10000 });
    }
  }
  if (info.ok) { B.artist = info.data.artist; B.show = info.data.show; if (info.data.gallery) B.gallery = info.data.gallery; }
  else if (!B.artist) {
    app.innerHTML = `<section class="screen"><div class="empty"><h3>${info.status === 404 ? "This card isn't active" : "Can't load this page"}</h3><p>${info.status === 404 ? "The artist may have left the show chat." : "Check your signal and try again."}</p><button class="btn small" onclick="location.reload()">Try again</button></div></section>`;
    return;
  }
  const A = () => B.artist;
  const first = () => (A().name || "the artist").split(/\s+/)[0];
  if (wantPiece && B.gallery && B.gallery.pieces.some((x) => x.id === wantPiece)) B.piece = wantPiece;
  V.visit({ artist: artistId, via: fromApp ? "list" : "qr" });
  V.on(() => { lastHtml = ""; render(); });
  const boothN = () => normBooth(A().booth);
  function bFavBtn() {
    const n = V.S.favs.length;
    return `<a class="favbtn" href="/v/${esc(code)}#saved" aria-label="Your favorites, ${n} saved">${HEART(n > 0)}<span>${n}</span></a>`;
  }
  function boothHeart() {
    const on = V.isFav("b:" + boothN());
    return boothN() ? `<button type="button" class="heart ${on ? "on" : ""}" data-bfav-booth aria-pressed="${on}" aria-label="${on ? "Saved. Tap to remove" : "Save this booth"}">${HEART(on)}</button>` : "";
  }
  const sess = () => buyerSessions()[key];
  const saveCache = () => store.set(CK, { artist: B.artist, show: B.show, buyer: B.buyer, gallery: B.gallery, reactions: B.reactions, messages: B.messages.slice(-500) });
  const meId = () => (B.buyer && B.buyer.id) || "";
  function setReaction(x) {
    const map = B.reactions[x.seq] || (B.reactions[x.seq] = {});
    if (x.e) map[x.who] = x.e; else delete map[x.who];
    if (!Object.keys(map).length) delete B.reactions[x.seq];
  }
  const saveOutbox = () => store.set("asc.boutbox." + key, B.outbox);
  document.title = `Message ${A().name}`;

  function merge(list) {
    const have = new Set(B.messages.map((m) => m.seq));
    let added = false;
    for (const m of list || []) if (!have.has(m.seq)) { B.messages.push(m); added = true; }
    if (added) {
      B.messages.sort((a, b) => a.seq - b.seq);
      const ids = new Set(list.map((m) => m.id));
      B.outbox = B.outbox.filter((o) => !ids.has(o.id)); saveOutbox(); saveCache();
    }
    return added;
  }
  async function sync() {
    const s = sess(); if (!s) return;
    const r = await api(`/show/${code}/buyer/sync?since=0`, { token: s.token });
    if (r.status === 401) { const all = buyerSessions(); delete all[key]; store.set("asc.buyers", all); render(); return; }
    if (!r.ok) { B.online = r.status !== 0; return render(); }
    B.online = true; B.buyer = r.data.buyer; if (r.data.artist) B.artist = r.data.artist; if (r.data.gallery) B.gallery = r.data.gallery;
    if (r.data.reactions) { B.reactions = {}; for (const x of r.data.reactions) setReaction(x); }
    merge(r.data.messages); saveCache(); render();
  }
  async function flush() {
    const s = sess(); if (flushing || !B.outbox.length) return;
    flushing = true;
    while (B.outbox.length) {
      const item = B.outbox[0];
      if (item.photo && !s) break;
      if (item.photo && s) {
        const up = await uploadPhoto(code, s.token, item.photo);
        if (!up.ok) { if (up.status === 0 || up.status >= 500 || up.status === 429) { B.online = up.status !== 0; break; } B.outbox.shift(); saveOutbox(); toast(up.data.error || "That photo couldn't be sent."); continue; }
        item.meta = { img: up.data.id }; delete item.photo; saveOutbox();
      }
      let r;
      if (!s) r = await api(`/show/${code}/buyer/start`, { method: "POST", body: { ...item, artist: artistId } });
      else r = await api(`/show/${code}/buyer/send`, { method: "POST", token: s.token, body: item });
      if (r.ok) {
        sendTries = 0; B.online = true;
        if (!s && r.data.token) { saveBuyer(key, { token: r.data.token }); B.buyer = r.data.buyer; setManifest(`/b/${code}/${artistId}?k=${r.data.token}`, `${A().name}`); connect(); }
        B.outbox.shift(); saveOutbox(); merge([r.data.message]);
        if (!s) { flushing = false; return flush(); }
        continue;
      }
      if (r.status === 0 || r.status >= 500 || r.status === 429) { B.online = r.status !== 0; break; }
      B.outbox.shift(); saveOutbox(); toast(r.data.error || "That message couldn't be sent.");
    }
    flushing = false;
    clearTimeout(retryTimer);
    if (B.outbox.length) retryTimer = setTimeout(flush, retryDelay(sendTries++));
    render();
  }
  function connect() {
    const s = sess(); if (!s || (ws && ws.readyState <= 1)) return;
    ws = new WebSocket(`${WS_BASE}/api/show/${code}/ws?t=${encodeURIComponent(s.token)}`);
    ws.onopen = () => { openedAt = Date.now(); lastPong = Date.now(); sync(); flush(); ws.send(JSON.stringify({ t: "vis", v: document.visibilityState === "visible" })); };
    ws.onmessage = (e) => {
      lastPong = Date.now(); if (e.data === "pong") return;
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d.t === "typing") { if (d.who === artistId) { typingUntil = d.stop ? 0 : Date.now() + 6000; render(); if (!d.stop) setTimeout(render, 6100); } return; }
      if (d.t === "msg" && d.m.from === artistId) typingUntil = 0;
      if (d.t === "msg" && merge([d.m])) {
        const sc = $("#scroller"), away = sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight >= 80;
        render();
        if (d.m.from === artistId) {
          Sound.ping();
          if (away) toast(`New reply from ${first()}`, () => { const s2 = $("#scroller"); if (s2) s2.scrollTo({ top: s2.scrollHeight, behavior: "smooth" }); });
        }
      } else if (d.t === "gallery") { B.gallery = d.g; saveCache(); render(); }
      else if (d.t === "react") { setReaction(d); saveCache(); render(); }
    };
    ws.onclose = () => { ws = null; if (openedAt && Date.now() - openedAt > 15000) backoff = 1000; openedAt = 0; setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 20000); };
  }
  setInterval(() => {
    // A socket that stopped answering on flaky wifi gets closed, so it reconnects instead of sitting silent.
    if (ws && ws.readyState === 1) { if (Date.now() - lastPong > 70000) { try { ws.close(); } catch {} return; } ws.send("ping"); }
    else if (sess()) { sync(); connect(); }
  }, 20000);
  document.addEventListener("visibilitychange", () => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: "vis", v: document.visibilityState === "visible" })); if (document.visibilityState === "visible") { sync(); flush(); connect(); } });
  addEventListener("online", () => { B.online = true; sendTries = 0; flush(); sync(); connect(); });
  addEventListener("offline", () => { B.online = false; render(); });

  function head() {
    const a = A();
    return `<div class="artist-head">${avatar(a, "lg")}<div class="grow"><h3>${esc(a.name)}</h3><div class="md">${a.booth ? `<span class="booth">Booth ${esc(a.booth)}</span>` : ""}${esc([a.medium, B.show && B.show.name].filter(Boolean).join(" · "))}</div></div>${boothHeart()}${bFavBtn()}</div>`;
  }
  function igButton() {
    const a = A();
    return a.instagram ? `<a class="btn igbtn" href="https://ig.me/m/${encodeURIComponent(a.instagram)}" target="_blank" rel="noopener">Message @${esc(a.instagram)} on Instagram</a>` : "";
  }
  const pieceById = (id) => (id && B.gallery && B.gallery.pieces.find((x) => x.id === id)) || null;
  function galleryHtml(grid) {
    const g = B.gallery;
    if (!g || (!g.booth.length && !g.pieces.length)) return "";
    const shots = g.booth.length ? `<div class="bstrip">${g.booth.map((x, i) => `<button type="button" class="bshot" data-photo="${esc(imgUrl(code, x.img))}" aria-label="Open booth photo ${i + 1}"><img src="${esc(imgUrl(code, x.thumb || x.img))}" alt="${esc(A().name)}'s booth" loading="lazy"></button>`).join("")}</div>` : "";
    const pcs = g.pieces.map((pc) => {
      const on = B.piece === pc.id, title = pc.title || "Untitled";
      const hk = `p:${artistId}:${pc.id}`, hon = V.isFav(hk);
      return `<div class="pcard ${on ? "on" : ""} ${pc.sold ? "sold" : ""}"><div class="pimgwrap"><button type="button" class="pimg" data-photo="${esc(imgUrl(code, pc.img))}" aria-label="Open photo of ${esc(title)}"><img src="${esc(imgUrl(code, pc.thumb || pc.img))}" alt="${esc(title)}" loading="lazy">${pc.sold ? `<span class="soldtag">Sold</span>` : ""}</button><button type="button" class="heart ${hon ? "on" : ""}" data-bfav="${esc(pc.id)}" aria-pressed="${hon}" aria-label="${hon ? "Saved. Tap to remove" : "Save " + esc(title)}">${HEART(hon)}</button></div>
        <span class="pt">${esc(title)}</span>${pc.price || pc.note ? `<span class="pp">${esc([pc.price, pc.note].filter(Boolean).join(" · "))}</span>` : ""}
        <button type="button" class="btn small ${on ? "" : "ghost"}" data-piece="${esc(pc.id)}" aria-pressed="${on}">${on ? "Asking about this" : "Ask about this"}</button></div>`;
    }).join("");
    return `<div class="gallery">${shots ? `<p class="label">At the booth</p>${shots}` : ""}${pcs ? `<p class="label">${grid ? "Tap a piece to ask about it" : "Pieces"}</p><div class="${grid ? "pgrid" : "pstrip"}">${pcs}</div>` : ""}</div>`;
  }
  function pieceChip() {
    const pc = pieceById(B.piece);
    if (!pc) return "";
    return `<div class="pchip"><img src="${esc(imgUrl(code, pc.thumb || pc.img))}" alt=""><span class="grow">About <b>${esc(pc.title || "this piece")}</b></span><button type="button" data-piece-clear aria-label="Don't attach this piece">✕</button></div>`;
  }
  function pendingPiece(o) {
    const pc = pieceById(o.pieceId);
    return pc ? `<span class="pref"><img src="${esc(imgUrl(code, pc.thumb || pc.img))}" alt=""><span>About <b>${esc(pc.title || "this piece")}</b></span></span>` : "";
  }
  function takePiece(item) {
    const pc = pieceById(B.piece);
    if (pc) { item.pieceId = pc.id; item.piece = pc.title || "this piece"; }
    B.piece = null;
    return item;
  }
  function thread() {
    const items = B.messages.map((m) => {
      if (m.kind === "move") return `<p class="sys moved">${esc(m.body.replace(/^.*? moved/, "You moved"))}</p>`;
      const mine = m.from !== artistId;
      const pills = rxPills(m.seq, B.reactions[m.seq], meId(), (id) => (id === meId() ? "You" : id === artistId ? A().name : ""));
      return `<div class="msg ${mine ? "me" : ""}" data-seq="${m.seq}">${mine ? "" : avatar(A(), "sm")}<div class="body rxz">${pieceCard(code, m)}${m.meta && m.meta.img ? photoHtml(imgUrl(code, m.meta.img)) : ""}${m.body ? `<div class="bubble">${pieceInline(m)}${linkify(m.body)}</div>` : ""}${pills}<span class="state">${mine ? "You" : esc(first())} · ${fmtDay(m.ts)} ${fmtTime(m.ts)}</span></div></div>`;
    }).join("") + (typingUntil > Date.now() ? `<div class="msg typing" role="status">${avatar(A(), "sm")}<div class="body"><div class="bubble dots" aria-hidden="true"><i></i><i></i><i></i></div><span class="state">${esc(first())} is typing</span></div></div>` : "") + B.outbox.map((o) => `<div class="msg me pending"><div class="body">${pendingPiece(o)}${o.photo ? photoHtml(o.photo) : ""}${o.body ? `<div class="bubble">${linkify(o.body)}</div>` : ""}<span class="state">${B.online ? "Sending…" : "Waiting for signal, it'll send by itself"}</span></div></div>`).join("");
    return `<div class="msgs" style="padding:0">${items}</div>`;
  }

  function carryOn() {
    const a = A(), b = B.buyer || {};
    const opts = [];
    if (a.phone || b.phone) opts.push(["text", a.phone ? `Text ${esc(first())}` : `Have ${esc(first())} text me`]);
    const autoMail = B.show && B.show.mail && b.email;
    if (a.email || b.email) opts.push(["email", autoMail ? "Carry on by email" : a.email ? `Email ${esc(first())}` : `Have ${esc(first())} email me`]);
    if (a.instagram) opts.push(["instagram", "Instagram DM"]);
    if (!opts.length) return "";
    return `<div class="card carry"><p class="label">Rather carry on somewhere else?</p>
      <div class="btnrow">${opts.map(([k, l]) => `<button type="button" class="btn small ${k === "instagram" ? "igbtn" : "ghost"}" data-move="${k}">${l}</button>`).join("")}</div>
      <label class="check"><input type="checkbox" id="move-all" checked> Bring the whole conversation, photos included</label></div>`;
  }
  async function moveTo(to) {
    const a = A(), b = B.buyer || {}, s = sess();
    const all = !!($("#move-all") && $("#move-all").checked);
    const me = b.name || "a buyer";
    const link = `${SITE}/b/${code}/${artistId}?k=${s.token}`;
    const nameOf = (id) => (id === artistId ? a.name : b.name || "Me");
    const txt = all
      ? transcript(code, B.messages, nameOf, `Hi ${first()}, it's ${me} from your QR card at ${B.show ? B.show.name : "the show"}. Here's our conversation so far:`, `Our chat: ${link}`)
      : `Hi ${first()}, it's ${me} from your QR card at ${B.show ? B.show.name : "the show"}.`;
    api(`/show/${code}/buyer/move`, { method: "POST", token: s.token, body: { id: uid(), to, all } }).then((r) => { if (r.ok) { merge([r.data.message]); B.buyer = r.data.buyer; saveCache(); render(); } });
    if (to === "instagram") {
      try { navigator.clipboard.writeText(txt); } catch {}
      window.open(`https://ig.me/m/${encodeURIComponent(a.instagram)}`, "_blank", "noopener");
      toast(all ? "Conversation copied. Paste it into the Instagram chat." : "Opening Instagram");
      return;
    }
    if (to === "email" && B.show && B.show.mail && b.email) { toast(`Sent to ${b.email}. ${first()}'s replies will come there too.`); return; }
    if (to === "text" && a.phone) { location.href = smsHref(a.phone, txt); return; }
    if (to === "email" && a.email) { location.href = mailHref(a.email, `From ${me}: ${B.show ? B.show.name : "your QR card"}`, txt); return; }
    toast(`Done. ${first()} will ${to === "text" ? "text" : "email"} you${all ? " the whole conversation" : ""}.`);
  }

  function render() {
    const s = sess();
    const active = document.activeElement ? document.activeElement.id : null;
    const keep = {}; for (const el of $$("input,textarea", app)) keep[el.id] = el.value;
    const prev = $("#scroller");
    const atBottom = !prev || prev.scrollHeight - prev.scrollTop - prev.clientHeight < 80;
    let html;
    if (!s && !B.outbox.length) {
      html = `<section class="screen"><div class="scroll"><form class="pad" id="start">
        ${head()}
        ${galleryHtml(true)}
        <div class="field"><label class="label" for="b-msg">Message ${esc(first())}</label>${pieceChip()}<textarea class="textarea" id="b-msg" required maxlength="2000" placeholder="${pieceById(B.piece) ? "Is it still available? Do you ship?" : "Is the blue piece still available? Do you ship?"}"></textarea></div>
        <div class="oq"><p class="label" style="color:var(--accent)">How should ${esc(first())} reply?</p>
          <div class="field"><label class="label" for="b-phone">Your phone, for a text back</label><input class="input" id="b-phone" type="tel" autocomplete="tel" maxlength="30" placeholder="(305) 555-0100" value="${esc((V.S.me || {}).phone || "")}"></div>
          <div class="field"><label class="label" for="b-email">Or your email</label><input class="input" id="b-email" type="email" autocomplete="email" maxlength="120" placeholder="you@email.com" value="${esc((V.S.me || {}).email || "")}"></div>
          <div class="field"><label class="label" for="b-name">Your name</label><input class="input" id="b-name" autocomplete="name" maxlength="60" value="${esc((V.S.me || {}).name || "")}"></div>
          <p class="small">Both are optional. ${B.show && B.show.mail ? "If you add an email, replies come there too, and they" : "Replies"} also show on this page, so you can keep chatting here any time.</p></div>
        <button class="btn" id="b-go">Send to ${esc(first())}</button>
        ${igButton() ? `<div class="or">or</div>${igButton()}` : ""}
        <p class="small" style="text-align:center">No account or app needed. Only ${esc(first())} sees your message.</p>
      </form></div></section>`;
    } else {
      const b = B.buyer || {};
      const needContact = !b.phone && !b.email;
      html = `<section class="screen">
        <div class="appbar"><div class="grow"><h2>${esc(A().name)}</h2><div class="sub">${esc([A().booth ? "Booth " + A().booth : "", B.show && B.show.name].filter(Boolean).join(" · "))}</div></div>${bFavBtn()}${A().instagram ? `<a class="iconbtn" href="https://ig.me/m/${encodeURIComponent(A().instagram)}" target="_blank" rel="noopener" aria-label="Message on Instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg></a>` : ""}</div>
        ${!B.online ? `<div class="banner warn" style="margin-top:8px"><span class="grow">No signal. Your message will send when you're back.</span></div>` : ""}
        <div class="scroll" id="scroller"><div class="pad">
          ${galleryHtml(false)}
          ${thread()}
          ${needContact && s ? `<form class="oq" id="contact"><p class="label" style="color:var(--accent)">Get ${esc(first())}'s reply by text</p><input class="input" id="c-phone" type="tel" autocomplete="tel" placeholder="Your phone" maxlength="30"><input class="input" id="c-email" type="email" autocomplete="email" placeholder="Or your email" maxlength="120"><button class="btn small">Save</button></form>` : ""}
          ${s && B.alerts !== "on" && pushSupported() ? `<button class="btn ghost small" id="b-alerts">Get a notification here when ${esc(first())} replies</button>` : ""}
          ${s ? carryOn() : ""}
          ${s ? `<button class="btn ghost small" id="b-save">Save this conversation (copy your private link)</button>` : ""}
        </div></div>
        ${B.piece ? `<div class="chipwrap">${pieceChip()}</div>` : ""}
        <form class="composer" id="b-compose"><button class="photobtn" type="button" id="b-photo" aria-label="Send a photo">${PHOTO_ICON}</button><textarea class="input" rows="1" id="b-input" placeholder="Message ${esc(first())}" aria-label="Message"></textarea><button class="send" aria-label="Send">${ICON.send}</button></form>
      </section>`;
    }
    if (html === lastHtml) return;
    lastHtml = html;
    drawKeepingComposer(app, html, "#b-compose", true);
    const sc = $("#scroller"); if (sc && atBottom) sc.scrollTop = sc.scrollHeight;
    for (const [id, v] of Object.entries(keep)) { const el = document.getElementById(id); if (el && v && !el.value) el.value = v; }
    if (active) { const el = document.getElementById(active); if (el && document.activeElement !== el) el.focus(); }
  }

  app.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (e.target.id === "start") {
      const body = $("#b-msg").value.trim(); if (!body) return;
      B.outbox.push(takePiece({ id: uid(), body, name: $("#b-name").value, phone: $("#b-phone").value, email: $("#b-email").value }));
      B.buyer = { name: $("#b-name").value, phone: $("#b-phone").value, email: $("#b-email").value };
      Sound.sent(); saveOutbox(); lastHtml = ""; render(); flush();
    } else if (e.target.id === "b-compose") {
      const el = $("#b-input"); const body = el.value.trim(); if (!body) return;
      el.value = ""; Sound.sent(); buyerTyping(true); B.outbox.push(takePiece({ id: uid(), body })); saveOutbox(); render(); flush();
    } else if (e.target.id === "contact") {
      const r = await api(`/show/${code}/buyer/me`, { method: "POST", token: sess().token, body: { phone: $("#c-phone").value, email: $("#c-email").value } });
      if (r.ok) { B.buyer = r.data.buyer; saveCache(); toast(`Saved. ${first()} can text or email you now.`); render(); } else toast(r.data.error || "Couldn't save. Check your signal.");
    }
  });
  async function react(seq, e) {
    const s = sess(); if (!s || !seq || !meId()) return;
    const before = (B.reactions[seq] || {})[meId()] || "";
    const next = before === e ? "" : e;
    setReaction({ seq, who: meId(), e: next }); render();
    const r = await api(`/show/${code}/react`, { method: "POST", token: s.token, body: { seq, e: next } });
    if (!r.ok) { setReaction({ seq, who: meId(), e: before }); render(); toast(r.status === 0 ? "No signal right now. Try that again when you're connected." : r.data.error || "Couldn't add that reaction."); }
    else saveCache();
  }
  reactGestures(app, { mine: (seq) => (B.reactions[seq] || {})[meId()] || "", toggle: react });
  function buyerTyping(stop) {
    if (!ws || ws.readyState !== 1 || !meId()) return;
    const now = Date.now();
    if (stop) { if (!typingSentAt) return; typingSentAt = 0; }
    else { if (now - typingSentAt < 2500) return; typingSentAt = now; }
    try { ws.send(JSON.stringify({ t: "typing", ch: "buy:" + meId(), stop })); } catch {}
  }
  app.addEventListener("input", (e) => { if (e.target.id === "b-input") buyerTyping(!e.target.value.trim()); });
  app.addEventListener("click", async (e) => {
    const rp = e.target.closest("[data-rx]");
    if (rp) return react(Number(rp.dataset.rseq), rp.dataset.rx);
    const hf = e.target.closest("[data-bfav]");
    if (hf) {
      const pc = pieceById(hf.dataset.bfav); if (!pc) return;
      const hk = `p:${artistId}:${pc.id}`, on = !V.isFav(hk);
      V.setFav({ type: "piece", artist: artistId, piece: pc.id, on }, { type: "piece", booth: boothN(), artist: { id: artistId, name: A().name, booth: A().booth }, piece: { id: pc.id, title: pc.title, price: pc.price, sold: pc.sold, img: pc.img, thumb: pc.thumb || pc.img } });
      if (on) toast("Saved to your favorites");
      return;
    }
    if (e.target.closest("[data-bfav-booth]")) {
      const n = boothN(), on = !V.isFav("b:" + n);
      V.setFav({ type: "booth", booth: n, artist: artistId, on }, { type: "booth", booth: n, artist: { id: artistId, name: A().name, booth: A().booth } });
      if (on) toast("Booth saved to your favorites");
      return;
    }
    const mv = e.target.closest("[data-move]");
    if (mv) return moveTo(mv.dataset.move);
    const pk = e.target.closest("[data-piece]");
    if (pk) {
      B.piece = B.piece === pk.dataset.piece ? null : pk.dataset.piece;
      render();
      const box = $("#b-msg") || $("#b-input");
      if (box && B.piece) { box.focus(); box.scrollIntoView({ block: "center", behavior: "smooth" }); }
      return;
    }
    if (e.target.closest("[data-piece-clear]")) { B.piece = null; render(); return; }
    if (e.target.closest("#b-photo")) {
      const photo = await pickPhoto(); if (!photo) return;
      B.outbox.push(takePiece({ id: uid(), body: "", photo })); saveOutbox(); render(); flush(); return;
    }
    if (e.target.id === "b-alerts") {
      const r = await ensurePush(code, sess().token, { ask: true });
      B.alerts = r.ok ? "on" : "off"; toast(r.ok ? "You'll get a notification when they reply" : alertsHelp(r.reason)); render();
    }
    if (e.target.id === "b-save") copyText(`${SITE}/b/${code}/${artistId}?k=${sess().token}`, "Private link copied. Save it to come back to this chat.");
  });

  render();
  if (V.S.token) V.sync();
  if (sess()) { setManifest(`/b/${code}/${artistId}?k=${sess().token}`, A().name); sync(); connect(); flush(); if (B.alerts === "on") ensurePush(code, sess().token); }
  else if (B.outbox.length) flush();
}

// ---------- visitors: walk the show, heart what they like, no account ----------
const HEART = (on) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.3-9.4C1.4 7.6 3.6 4 7.2 4c2 0 3.6 1.1 4.8 2.8C13.2 5.1 14.8 4 16.8 4c3.6 0 5.8 3.6 4.5 7.1-1.8 4.8-9.3 9.4-9.3 9.4z"/></svg>`;
// Same rule as the server: "booth b-012", "B12" and "b 12" are all booth B12.
function normBooth(v) {
  return String(v == null ? "" : v).toUpperCase().replace(/^\s*BOOTH\s*/, "").replace(/[^A-Z0-9]/g, "").replace(/(^|[A-Z])0+(?=\d)/g, "$1").slice(0, 12);
}
const favKey = (f) => (f.type === "piece" ? `p:${f.artist}:${f.piece}` : f.type === "booth" ? `b:${normBooth(f.booth)}` : `s:${f.sid}`);
const visitorStates = {};
// One visitor per show on this phone: favorites show at once and sync in the background, even on bad fair wifi.
function visitorState(code) {
  if (visitorStates[code]) return visitorStates[code];
  const K = "asc.v." + code;
  const S = Object.assign({ token: null, me: null, favs: [], ops: [], via: "" }, store.get(K, {}));
  let flushing = false, tries = 0, timer = null, starting = null;
  const listeners = new Set();
  const save = () => store.set(K, { token: S.token, me: S.me, favs: S.favs, ops: S.ops, via: S.via });
  const emit = () => { for (const fn of listeners) try { fn(); } catch {} };
  const memberHere = () => !!sessions()[code];
  async function ensure(via = "show") {
    if (S.token) return S.token;
    if (!starting) starting = api(`/show/${code}/visitor/start`, { method: "POST", body: { via: S.via || via } }).then((r) => {
      starting = null;
      if (r.ok) { S.token = r.data.token; S.me = r.data.visitor; save(); }
      return S.token;
    });
    return starting;
  }
  function applyOps(list) {
    const map = new Map(list.map((f) => [f.k, f]));
    for (const o of S.ops) { if (o.body.on === false) map.delete(o.k); else map.set(o.k, { ...(map.get(o.k) || {}), ...o.local, k: o.k, pending: true }); }
    return [...map.values()];
  }
  async function sync() {
    if (!S.token) return;
    const r = await api(`/show/${code}/visitor/me`, { token: S.token });
    if (r.status === 401) { S.token = null; S.me = null; save(); return; }
    if (!r.ok) return;
    S.me = r.data.visitor; S.favs = applyOps(r.data.favs); save(); emit();
  }
  async function flush() {
    if (flushing || !S.ops.length) return;
    flushing = true; clearTimeout(timer);
    while (S.ops.length) {
      const o = S.ops[0];
      if (!(await ensure())) break;
      if (o.photo) {
        const [a, b] = await Promise.all([uploadPhoto(code, S.token, o.photo), uploadPhoto(code, S.token, o.thumb || o.photo)]);
        if (!a.ok || !b.ok) { if ([0, 429].includes(a.status) || a.status >= 500 || [0, 429].includes(b.status) || b.status >= 500) break; S.ops.shift(); S.favs = S.favs.filter((f) => f.k !== o.k); save(); emit(); toast("That photo couldn't be saved."); continue; }
        o.body.img = b.data.id; delete o.photo; delete o.thumb; save();
      }
      const r = await api(`/show/${code}/visitor/fav`, { method: "POST", token: S.token, body: o.body });
      if (r.ok) {
        tries = 0; S.ops.shift();
        const i = S.favs.findIndex((f) => f.k === o.k);
        const still = S.ops.some((x) => x.k === o.k);
        if (!still) {
          if (r.data.fav) { if (i >= 0) S.favs[i] = r.data.fav; else S.favs.push(r.data.fav); }
          else if (i >= 0) S.favs.splice(i, 1);
        }
        save(); emit(); continue;
      }
      if (r.status === 401) { S.token = null; save(); continue; }
      if (r.status === 0 || r.status >= 500 || r.status === 429) break;
      S.ops.shift(); save();
      if (o.body.on !== false) { S.favs = S.favs.filter((f) => f.k !== o.k); emit(); }
      toast(r.data.error || "That couldn't be saved.");
    }
    flushing = false;
    if (S.ops.length) timer = setTimeout(flush, retryDelay(tries++));
  }
  // body: {type, artist, piece, booth, sid, note, on}; local: what to show right away.
  function setFav(body, local, extra = {}) {
    const k = favKey(body);
    S.ops.push({ k, body, local: { ...local, k }, ...extra });
    if (body.on === false) S.favs = S.favs.filter((f) => f.k !== k);
    else { const i = S.favs.findIndex((f) => f.k === k); const v = { ...(i >= 0 ? S.favs[i] : {}), ...local, k, pending: true }; if (i >= 0) S.favs[i] = v; else S.favs.push(v); }
    save(); emit(); flush();
    return k;
  }
  const isFav = (k) => S.favs.some((f) => f.k === k);
  function visit(body) {
    if (memberHere()) return;
    ensure(body.via === "qr" ? "artist" : "show").then((t) => { if (t) api(`/show/${code}/visitor/visit`, { method: "POST", token: t, body }); });
  }
  async function update(body) {
    const t = await ensure();
    if (!t) return { ok: false, data: { error: "No connection. Try again when you have signal." } };
    const r = await api(`/show/${code}/visitor/me`, { method: "POST", token: t, body });
    if (r.ok) { S.me = r.data.visitor; save(); emit(); }
    return r;
  }
  function adopt(k) { if (k && k !== S.token) { S.token = k; save(); } }
  addEventListener("online", () => { tries = 0; flush(); sync(); });
  const api_ = { S, ensure, sync, flush, setFav, isFav, visit, update, adopt, on: (fn) => listeners.add(fn), off: (fn) => listeners.delete(fn), link: () => (S.token ? `${SITE}/v/${code}?k=${S.token}#saved` : "") };
  visitorStates[code] = api_;
  if (S.ops.length) setTimeout(flush, 300);
  return api_;
}

async function Visitor(code) {
  const V = visitorState(code);
  const k = takeKeyFromUrl();
  if (k) V.adopt(k);
  if (!V.S.via) { V.S.via = "show"; }
  const CK = "asc.vinfo." + code;
  const info = store.get(CK, {});
  const I = { show: info.show || null, booths: info.booths || [], booth: info.boothCache || {}, online: true };
  let lastHtml = "";
  async function loadInfo() {
    const r = await api(`/show/${code}/visit/info`, { timeout: 10000 });
    if (r.ok) { I.show = r.data.show; I.booths = r.data.booths; I.online = true; store.set(CK, { show: I.show, booths: I.booths, boothCache: I.booth }); }
    else { I.online = false; if (r.status === 404) I.missing = true; }
    return r;
  }
  if (!I.show) {
    app.innerHTML = `<section class="screen"><div class="boot">Opening the show…</div></section>`;
    let r = await loadInfo();
    for (let i = 0; i < 40 && !r.ok && r.status !== 404; i++) {
      app.innerHTML = `<section class="screen"><div class="empty"><h3>Waiting for signal</h3><p>This page opens by itself as soon as your phone connects.</p></div></section>`;
      await new Promise((res) => { const t = setTimeout(res, retryDelay(i)); addEventListener("online", () => { clearTimeout(t); res(); }, { once: true }); });
      r = await loadInfo();
    }
    if (!r.ok) { app.innerHTML = `<section class="screen"><div class="empty"><h3>${r.status === 404 ? "No show with that code" : "Can't reach Show Chat"}</h3><p>${r.status === 404 ? "Check the code on your ticket or the show sign." : "Check your signal and try again."}</p><button class="btn small" onclick="location.reload()">Try again</button></div></section>`; return; }
  } else loadInfo().then(() => render());
  setManifest(`/v/${code}`, I.show.name);

  const view = () => decodeURIComponent(location.hash.slice(1));
  const go = (h) => { location.hash = h; };
  const first = (n) => String(n || "the artist").split(/\s+/)[0];
  const favs = () => V.S.favs;
  const count = () => favs().length;
  const thumbSrc = (f) => (f.local ? f.local : f.type === "piece" && f.piece && f.piece.thumb ? imgUrl(code, f.piece.thumb) : f.img ? imgUrl(code, f.img) : "");
  const artistLink = (a, piece) => `/b/${code}/${a.id}?from=v${piece ? "&piece=" + encodeURIComponent(piece) : ""}`;

  async function loadBooth(n) {
    const r = await api(`/show/${code}/visit/booth?b=${encodeURIComponent(n)}`, { timeout: 10000 });
    if (r.ok) { I.booth[n] = r.data; store.set(CK, { show: I.show, booths: I.booths, boothCache: I.booth }); }
    else if (!I.booth[n]) I.booth[n] = { booth: n, error: r.status === 0 ? "offline" : "error" };
    render();
  }

  function bar(title, sub, back) {
    return `<div class="appbar">${back ? `<a class="iconbtn" href="#${back === "home" ? "" : back}" data-vgo="${back === "home" ? "" : back}" aria-label="Back">${ICON.back}</a>` : ""}<div class="grow"><h2>${title}</h2>${sub ? `<div class="sub">${sub}</div>` : ""}</div>
      <a class="favbtn" href="#saved" data-vgo="saved" aria-label="Your favorites, ${count()} saved">${HEART(count() > 0)}<span>${count()}</span></a></div>`;
  }
  function showSub() { return esc([I.show.venue, I.show.dates].filter(Boolean).join(" · ")); }
  function recapCard() {
    const me = V.S.me || {};
    if (me.email || me.phone || !count()) return "";
    return `<a class="card tint recapcard" href="#me" data-vgo="me"><b>Get your favorites after the fair</b><span class="small">Add your email and you'll get one email with everything you saved, with prices and a button to message each artist.</span></a>`;
  }
  function vHome() {
    const recent = favs().filter(thumbSrc).slice(-6).reverse();
    return `<section class="screen">${bar(esc(I.show.name), showSub())}
      <div class="scroll"><div class="pad">
        <form class="card boothform" id="v-booth"><label class="label" for="v-b">Go to a booth</label>
          <div class="boothrow"><input class="input code" id="v-b" maxlength="14" autocomplete="off" autocapitalize="characters" inputmode="text" placeholder="BOOTH #" required><button class="btn">Go</button></div>
          <p class="hint">Or scan the QR code at a booth with your phone's camera. Tap ${HEART(false)} on anything you like to save it.</p></form>
        ${I.show.map ? `<div class="card"><p class="label">Show map</p><button type="button" class="mapimg" data-photo="${esc(imgUrl(code, I.show.map.img))}" aria-label="Open the show map"><img src="${esc(imgUrl(code, I.show.map.thumb || I.show.map.img))}" alt="Map of ${esc(I.show.name)}" loading="lazy"></button><p class="small">Tap to zoom. Find a booth number, then type it above.</p></div>` : ""}
        ${count() ? `<a class="card favsum" href="#saved" data-vgo="saved"><span class="grow"><b>Your favorites</b><span class="small">${count()} saved</span></span>${recent.length ? `<span class="favthumbs">${recent.map((f) => `<img src="${esc(thumbSrc(f))}" alt="">`).join("")}</span>` : ""}<span aria-hidden="true">›</span></a>` : ""}
        ${recapCard()}
        ${I.booths.length ? `<div><p class="label" style="margin-bottom:6px">Booths with photos and messaging</p>${I.booths.map((b) => `<a class="person" href="#b=${esc(b.n)}" data-vgo="b=${esc(b.n)}" style="text-decoration:none;color:inherit">${b.cover ? `<img class="cover" src="${esc(imgUrl(code, b.cover))}" alt="" loading="lazy">` : avatar(b)}<span class="who"><span class="nm">${esc(b.name)} <span class="booth">${esc(b.booth)}</span></span>${b.medium ? `<span class="md">${esc(b.medium)}</span>` : ""}</span>${V.isFav("b:" + b.n) || favs().some((f) => f.booth === b.n) ? `<span class="hearted">${HEART(true)}</span>` : ""}</a>`).join("")}</div>` : ""}
        <p class="small" style="text-align:center">No account or app needed. Your favorites stay on this phone.</p>
      </div></div></section>`;
  }
  function heartBtn(k, attrs, label) {
    const on = V.isFav(k);
    return `<button type="button" class="heart ${on ? "on" : ""}" ${attrs} aria-pressed="${on}" aria-label="${on ? "Saved. Tap to remove" : esc(label)}">${HEART(on)}</button>`;
  }
  function snapsFor(n) {
    const list = favs().filter((f) => f.type === "snap" && f.booth === n);
    return `<div class="galgrid">${list.map((f) => `<div class="galtile"><button type="button" class="galimg" data-photo="${esc(f.local || imgUrl(code, f.img))}" aria-label="Open your photo"><img src="${esc(thumbSrc(f))}" alt="" loading="lazy"></button><button type="button" class="galx" data-unsnap="${esc(f.k)}" aria-label="Remove this photo">✕</button></div>`).join("")}<button type="button" class="galadd" data-snap="${esc(n)}">${PHOTO_ICON}<br>Take a photo</button></div>`;
  }
  function vBooth(n) {
    const d = I.booth[n];
    if (!d) { loadBooth(n); return `<section class="screen">${bar("Booth " + esc(n), esc(I.show.name), "home")}<div class="boot">Finding the booth…</div></section>`; }
    if (!d.fresh) { d.fresh = true; loadBooth(n).then(() => { if (I.booth[n]) I.booth[n].fresh = true; }); V.visit({ booth: n, artist: d.artist ? d.artist.id : "", via: V.S.lastVia || "booth" }); V.S.lastVia = ""; }
    if (d.error && !d.artist && !d.booth) return `<section class="screen">${bar("Booth " + esc(n), esc(I.show.name), "home")}<div class="empty"><p>${d.error === "offline" ? "No signal right now. This opens by itself when you're back." : "Couldn't load this booth."}</p></div></section>`;
    const a = d.artist, g = d.gallery;
    const boothFav = heartBtn("b:" + n, `data-fav-booth="${esc(n)}"`, "Save this booth");
    if (!a) {
      const bf = favs().find((f) => f.k === "b:" + n);
      return `<section class="screen">${bar("Booth " + esc(n), esc(I.show.name), "home")}
        <div class="scroll"><div class="pad">
          <div class="card"><div class="boothhead"><span class="grow"><h3>Booth ${esc(n)}</h3><span class="small">This artist isn't on Show Chat yet</span></span>${boothFav}</div>
            <p class="hint">Save the booth and take photos of what you like, so you can find it after the fair.</p>
            ${bf ? `<input class="input" id="v-note" maxlength="120" placeholder="Artist's name, or what you liked" value="${esc(bf.note || "")}" aria-label="Note for this booth">` : ""}</div>
          <div class="card"><p class="label">Your photos from this booth</p>${snapsFor(n)}<p class="small">Only you see these.</p></div>
        </div></div></section>`;
    }
    const pcs = g && g.pieces.length ? `<p class="label">Pieces</p><div class="pgrid">${g.pieces.map((pc) => {
      const pk = `p:${a.id}:${pc.id}`, title = pc.title || "Untitled";
      return `<div class="pcard ${pc.sold ? "sold" : ""}"><div class="pimgwrap"><button type="button" class="pimg" data-photo="${esc(imgUrl(code, pc.img))}" aria-label="Open photo of ${esc(title)}"><img src="${esc(imgUrl(code, pc.thumb || pc.img))}" alt="${esc(title)}" loading="lazy">${pc.sold ? `<span class="soldtag">Sold</span>` : ""}</button>${heartBtn(pk, `data-fav-piece="${esc(pc.id)}" data-artist="${esc(a.id)}"`, "Save " + title)}</div>
        <span class="pt">${esc(title)}</span>${pc.price || pc.note ? `<span class="pp">${esc([pc.price, pc.note].filter(Boolean).join(" · "))}</span>` : ""}
        <a class="btn small ghost" href="${esc(artistLink(a, pc.id))}">Ask about this</a></div>`;
    }).join("")}</div>` : `<p class="hint">${esc(first(a.name))} hasn't added piece photos yet. You can take your own.</p>`;
    return `<section class="screen">${bar(esc(a.name), esc(["Booth " + (a.booth || n), a.medium].filter(Boolean).join(" · ")), "home")}
      <div class="scroll"><div class="pad">
        <div class="boothhead">${avatar(a, "lg")}<span class="grow"><h3>${esc(a.name)}</h3><span class="small">${esc(a.medium || "")}</span></span>${boothFav}</div>
        ${g && g.booth.length ? `<div class="bstrip">${g.booth.map((x) => `<button type="button" class="bshot" data-photo="${esc(imgUrl(code, x.img))}" aria-label="Open booth photo"><img src="${esc(imgUrl(code, x.thumb || x.img))}" alt="" loading="lazy"></button>`).join("")}</div>` : ""}
        <a class="btn" href="${esc(artistLink(a))}">Message ${esc(first(a.name))}</a>
        <div class="gallery">${pcs}</div>
        <div class="card"><p class="label">Your own photos</p>${snapsFor(n)}</div>
      </div></div></section>`;
  }
  function vSaved() {
    const groups = new Map();
    for (const f of favs()) {
      const key = f.booth || (f.artist && normBooth(f.artist.booth)) || "?";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }
    const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    const body = keys.map((n) => {
      const list = groups.get(n);
      const a = (list.find((f) => f.artist) || {}).artist || (I.booths.find((b) => b.n === n) ? { id: I.booths.find((b) => b.n === n).id, name: I.booths.find((b) => b.n === n).name, booth: I.booths.find((b) => b.n === n).booth } : null);
      const items = list.filter((f) => f.type !== "booth").map((f) => {
        if (f.type === "piece") {
          const pc = f.piece || {};
          return `<div class="favitem ${pc.sold ? "sold" : ""}"><button type="button" class="pimg" ${pc.img ? `data-photo="${esc(imgUrl(code, pc.img))}"` : ""} aria-label="Open photo">${thumbSrc(f) ? `<img src="${esc(thumbSrc(f))}" alt="" loading="lazy">` : ""}${pc.sold ? `<span class="soldtag">Sold</span>` : ""}</button>
            <span class="pt">${esc(pc.gone ? "No longer listed" : pc.title || "Untitled")}</span>${pc.price ? `<span class="pp">${esc(pc.price)}</span>` : ""}
            <span class="favacts">${a && !pc.gone ? `<a class="linkbtn plain" href="${esc(artistLink(a, pc.id))}">Ask</a>` : ""}<button type="button" class="linkbtn" data-unfav="${esc(f.k)}">Remove</button></span></div>`;
        }
        return `<div class="favitem"><button type="button" class="pimg" data-photo="${esc(f.local || imgUrl(code, f.img))}" aria-label="Open your photo"><img src="${esc(thumbSrc(f))}" alt="" loading="lazy"></button><span class="pt">Your photo</span><span class="favacts"><button type="button" class="linkbtn" data-unfav="${esc(f.k)}">Remove</button></span></div>`;
      }).join("");
      const bf = list.find((f) => f.type === "booth");
      return `<div class="favgroup"><div class="favhead"><a href="#b=${esc(n)}" data-vgo="b=${esc(n)}" class="grow" style="color:inherit;text-decoration:none"><b>${esc(a ? a.name : "Booth " + n)}</b> <span class="booth">${esc(a && a.booth ? a.booth : n)}</span>${!a ? `<span class="small"> Not on Show Chat yet</span>` : ""}${bf && bf.note ? `<span class="small"> · ${esc(bf.note)}</span>` : ""}</a>${a ? `<a class="btn small ghost" href="${esc(artistLink(a))}">Message</a>` : ""}</div>
        ${items ? `<div class="favgrid">${items}</div>` : `<p class="small">You saved this booth.</p>`}</div>`;
    }).join("");
    return `<section class="screen">${bar("Your favorites", esc(I.show.name), "home")}
      <div class="scroll"><div class="pad">
        ${recapCard()}
        ${count() ? body : `<div class="empty"><h3>Nothing saved yet</h3><p>Tap ${HEART(false)} on a piece or a booth and it shows up here.</p><a class="btn small" href="#" data-vgo="">Go to a booth</a></div>`}
        ${count() && (V.S.me || {}).email ? `<p class="small">${(V.S.me || {}).recap ? `After the fair you'll get these at ${esc(V.S.me.email)}.` : ""} <a href="#me" data-vgo="me">Change</a></p>` : ""}
      </div></div></section>`;
  }
  function vMe() {
    const me = V.S.me || {};
    const fresh = !me.email && !me.phone;
    return `<section class="screen">${bar("After the fair", esc(I.show.name), "saved")}
      <div class="scroll"><form class="pad" id="v-me">
        <p class="hint">Leave your email and you'll get one email after the fair with everything you saved: photos, prices, what's sold, and a button to message each artist.</p>
        <div class="field"><label class="label" for="vm-email">Email</label><input class="input" id="vm-email" type="email" autocomplete="email" maxlength="120" value="${esc(me.email || "")}" placeholder="you@email.com"></div>
        <div class="row2"><div class="field"><label class="label" for="vm-phone">Phone (optional)</label><input class="input" id="vm-phone" type="tel" autocomplete="tel" maxlength="30" value="${esc(me.phone || "")}"></div>
        <div class="field"><label class="label" for="vm-name">Name (optional)</label><input class="input" id="vm-name" autocomplete="name" maxlength="60" value="${esc(me.name || "")}"></div></div>
        <label class="check"><input type="checkbox" id="vm-recap" ${fresh || me.recap ? "checked" : ""}> Email me my favorites after the fair</label>
        <label class="check"><input type="checkbox" id="vm-artists" ${me.shareArtists ? "checked" : ""}> Let the artists I saved get in touch with me</label>
        <label class="check"><input type="checkbox" id="vm-show" ${me.shareShow ? "checked" : ""}> Share my contact with ${esc(I.show.name)} for future show news</label>
        <p class="small">Each one is up to you. Artists and the show only see your contact if you tick their box.</p>
        <button class="btn">Save</button>
        ${V.S.token ? `<div class="card"><p class="label">Your favorites on another phone</p><p class="small">This private link opens your favorites anywhere. Keep it to yourself.</p><button type="button" class="btn small ghost" data-vcopy>Copy my private link</button></div>` : ""}
      </form></div></section>`;
  }

  function render() {
    const v = view();
    const keep = {}; for (const el of $$("input,textarea", app)) if (el.id && el.type !== "checkbox") keep[el.id] = el.value;
    const active = document.activeElement ? document.activeElement.id : null;
    const sc = $(".scroll", app); const top = sc ? sc.scrollTop : 0;
    let html;
    if (v.startsWith("b=")) html = vBooth(normBooth(v.slice(2)));
    else if (v === "saved") html = vSaved();
    else if (v === "me") html = vMe();
    else html = vHome();
    if (html === lastHtml) return;
    const same = app.dataset.vview === v;
    lastHtml = html; app.innerHTML = html; app.dataset.vview = v;
    if (same) { for (const [id, val] of Object.entries(keep)) { const el = document.getElementById(id); if (el) el.value = val; } const s2 = $(".scroll", app); if (s2) s2.scrollTop = top; if (active) { const el = document.getElementById(active); if (el) el.focus(); } }
  }
  V.on(render);
  addEventListener("hashchange", render);
  addEventListener("online", () => { loadInfo().then(render); });

  app.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-vgo],[data-fav-booth],[data-fav-piece],[data-unfav],[data-unsnap],[data-snap],[data-vcopy]");
    if (!t) return;
    if (t.dataset.vgo !== undefined) { e.preventDefault(); if (t.dataset.vgo.startsWith("b=")) V.S.lastVia = view() === "saved" ? "fav" : "list"; return go(t.dataset.vgo); }
    if (t.dataset.favBooth) {
      const n = t.dataset.favBooth, d = I.booth[n] || {}, a = d.artist;
      V.setFav({ type: "booth", booth: n, artist: a ? a.id : "", on: !V.isFav("b:" + n) }, { type: "booth", booth: n, artist: a ? { id: a.id, name: a.name, booth: a.booth } : null, note: "" });
      if (V.isFav("b:" + n)) toast("Booth saved to your favorites");
      return;
    }
    if (t.dataset.favPiece) {
      const n = normBooth(view().slice(2)), d = I.booth[n] || {}, a = d.artist; if (!a) return;
      const pc = d.gallery.pieces.find((x) => x.id === t.dataset.favPiece); if (!pc) return;
      const k = `p:${a.id}:${pc.id}`, on = !V.isFav(k);
      V.setFav({ type: "piece", artist: a.id, piece: pc.id, on }, { type: "piece", booth: n, artist: { id: a.id, name: a.name, booth: a.booth }, piece: { id: pc.id, title: pc.title, price: pc.price, sold: pc.sold, img: pc.img, thumb: pc.thumb || pc.img } });
      if (on && navigator.vibrate) try { navigator.vibrate(15); } catch {}
      return;
    }
    if (t.dataset.unfav || t.dataset.unsnap) {
      const key = t.dataset.unfav || t.dataset.unsnap, f = favs().find((x) => x.k === key); if (!f) return;
      if (f.type === "snap" && !confirm("Remove this photo from your favorites?")) return;
      const body = f.type === "piece" ? { type: "piece", artist: f.artist.id, piece: f.piece.id } : f.type === "booth" ? { type: "booth", booth: f.booth } : { type: "snap", sid: key.slice(2) };
      V.setFav({ ...body, on: false }, {});
      return;
    }
    if (t.dataset.snap) {
      const n = t.dataset.snap, d = I.booth[n] || {}, a = d.artist;
      const ph = await pickPhotoPair(); if (!ph) return;
      const sid = uid().replace(/[^A-Za-z0-9-]/g, "").slice(0, 36);
      V.setFav({ type: "snap", sid, booth: n, artist: a ? a.id : "", on: true }, { type: "snap", booth: n, local: ph.thumb, artist: a ? { id: a.id, name: a.name, booth: a.booth } : null }, { photo: ph.full, thumb: ph.thumb });
      toast("Photo saved to your favorites");
      return;
    }
    if (t.dataset.vcopy !== undefined) copyText(V.link(), "Private link copied");
  });
  let noteTimer = null;
  app.addEventListener("input", (e) => {
    if (e.target.id !== "v-note") return;
    const n = normBooth(view().slice(2)), val = e.target.value;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => V.setFav({ type: "booth", booth: n, note: val, on: true }, { type: "booth", booth: n, note: val }), 700);
  });
  app.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (e.target.id === "v-booth") {
      const n = normBooth($("#v-b").value); if (!n) return;
      V.S.lastVia = "booth"; if (I.booth[n]) I.booth[n].fresh = false;
      return go("b=" + n);
    }
    if (e.target.id === "v-me") {
      const email = $("#vm-email").value.trim();
      const r = await V.update({ email, phone: $("#vm-phone").value, name: $("#vm-name").value, recap: $("#vm-recap").checked, shareArtists: $("#vm-artists").checked, shareShow: $("#vm-show").checked });
      if (!r.ok) return toast(r.data.error || "Couldn't save. Check your signal.");
      toast(email && $("#vm-recap").checked ? "Saved. Your favorites come to your email after the fair." : "Saved");
      go("saved");
    }
  });
  render();
  if (V.S.token) V.sync(); else V.ensure("show");
  V.flush();
}

// ---------- printable QR cards ----------
async function Cards(code) {
  const q = new URLSearchParams(location.search);
  const s = sessions()[code];
  if (!s) { location.replace(`/s/${code}`); return; }
  app.innerHTML = `<div class="boot">Making cards…</div>`;
  const r = await api(`/show/${code}/sync?since=999999999`, { token: s.token });
  const cached = store.get("asc.cache." + code, {});
  const data = r.ok ? r.data : cached;
  if (!data || !data.members) { app.innerHTML = `<div class="empty"><p>Can't load the artists. Check your signal.</p></div>`; return; }
  const only = q.get("only") === "me";
  const visitorOnly = q.get("visitor") === "1";
  const claims = (q.get("claim") || "").split(",").map((x) => normBooth(x)).filter(Boolean).slice(0, 60);
  const list = only ? data.members.filter((m) => m.id === data.me.id) : data.members.filter((m) => m.role === "artist");
  const showJoin = !only && data.me.role === "director";
  const origin = SITE;
  const card = (m) => {
    const url = `${origin}/b/${code}/${m.id}`;
    return `<div class="qrcard"><span class="show">${esc(data.show.name)}</span><span class="qn">${esc(m.name)}</span>${m.booth ? `<span class="qb">Booth ${esc(m.booth)}</span>` : ""}
      ${qrSvg(url)}<span class="qs">Scan to message me</span><span class="qt">Ask about a piece, prices or shipping, or save the ones you love.<br>No app or account needed.</span>${m.instagram ? `<span class="qt">Instagram @${esc(m.instagram)}</span>` : ""}<span class="qu">${esc(url.replace(/^https?:\/\//, ""))}</span></div>`;
  };
  const joinCard = () => {
    const url = `${origin}/s/${code}`;
    return `<div class="qrcard"><span class="show">${esc(data.show.name)}</span><span class="qn">Exhibitors: join the show chat</span>${qrSvg(url)}<span class="qs">Show code ${esc(code)}</span><span class="qt">Group chat, direct messages, buyer referrals and announcements.</span><span class="qu">${esc(url.replace(/^https?:\/\//, ""))}</span></div>`;
  };
  const visitorCard = () => {
    const url = `${origin}/v/${code}`;
    return `<div class="qrcard"><span class="show">${esc(data.show.name)}</span><span class="qn">Save your favorites</span>${qrSvg(url)}<span class="qs">Scan to open the show app</span><span class="qt">Type a booth number or scan a booth's code, tap ♥ on what you love, and get your list after the fair.<br>No app or account needed.</span><span class="qu">${esc(url.replace(/^https?:\/\//, ""))}</span></div>`;
  };
  let claimCounts = {};
  if (claims.length) {
    const rs = await Promise.all(claims.map((b) => api(`/show/${code}/visit/claim?b=${encodeURIComponent(b)}`)));
    rs.forEach((r, i) => { if (r.ok) claimCounts[claims[i]] = r.data.savers; });
  }
  const claimCard = (b) => {
    const url = `${origin}/s/${code}?booth=${encodeURIComponent(b)}`, n = claimCounts[b] || 0;
    return `<div class="qrcard"><span class="show">${esc(data.show.name)} · Booth ${esc(b)}</span><span class="qn">${n ? `${n} visitor${n === 1 ? "" : "s"} saved your work` : "Visitors are saving booths"}</span>${qrSvg(url)}<span class="qs">Scan to claim your booth</span><span class="qt">Free. See what they saved, add your pieces, and get buyer messages from your own QR card.</span><span class="qu">${esc(url.replace(/^https?:\/\//, ""))}</span></div>`;
  };
  if (visitorOnly || claims.length) {
    app.style.maxWidth = "none"; app.style.height = "auto";
    app.innerHTML = `<div class="print-page"><div class="print-tools">
      <div style="display:flex;gap:10px;align-items:center"><a class="iconbtn" href="/s/${esc(code)}#visitors" aria-label="Back">${ICON.back}</a><h1 class="display" style="font-size:26px">${claims.length ? "Booth claim cards" : "Visitor QR"}</h1></div>
      <p class="hint">${claims.length ? "Hand one to each booth. Scanning it opens Show Chat with their booth number filled in." : "Print this for tickets, the entrance and the map. Four per letter-size page."}</p>
      <div class="btnrow"><button class="btn small" onclick="print()">Print</button></div></div>
      <div class="cards">${claims.length ? claims.map(claimCard).join("") : [1, 2, 3, 4].map(visitorCard).join("")}</div></div>`;
    return;
  }
  app.style.maxWidth = "none"; app.style.height = "auto";
  app.innerHTML = `<div class="print-page"><div class="print-tools">
      <div style="display:flex;gap:10px;align-items:center"><a class="iconbtn" href="/s/${esc(code)}" aria-label="Back">${ICON.back}</a><h1 class="display" style="font-size:26px">${only ? "Your QR card" : "QR cards for every artist"}</h1></div>
      <p class="hint">${only ? "Show this on your phone, or print it for your booth." : "Four cards per letter-size page. Print, cut on the dashed lines and put one at each booth."} Each card opens a page where buyers can message that artist.</p>
      <div class="btnrow"><button class="btn small" onclick="print()">Print</button></div>
      ${!list.length ? `<p class="hint">No artists have joined yet.</p>` : ""}
    </div><div class="cards">${list.map(card).join("")}${showJoin ? joinCard() + visitorCard() : ""}</div></div>`;
}

// ---------- boot ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
route();
