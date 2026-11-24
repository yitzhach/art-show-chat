// Show Chat beta 1.0: the whole phone app in one file, no build step.
const VERSION = "1.0";
const app = document.getElementById("app");

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
function avatar(p, cls = "") { return `<span class="av ${cls}" style="--h:${hue(p?.id || p?.name)}" aria-hidden="true">${esc(initials(p?.name))}</span>`; }
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
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200);
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
    const r = await fetch("/api" + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctl.signal, cache: "no-store" });
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
  app.innerHTML = `
  <section class="screen">
    <div class="appbar"><a class="iconbtn" href="/?home" aria-label="Back">${ICON.back}</a><div class="grow"><h2>Join the show</h2><div class="sub">Show code ${esc(code)}</div></div></div>
    <div class="scroll"><form class="pad" id="f">
      <div class="showcard"><span class="name">${esc(sh.name)}</span><span class="meta">${esc([sh.venue, sh.dates, `${sh.artists} artist${sh.artists === 1 ? "" : "s"} here`].filter(Boolean).join(" · "))}</span></div>
      <div class="field"><label class="label" for="name">Your name</label><input class="input" id="name" required maxlength="60" autocomplete="name" placeholder="As buyers will see it"></div>
      <div class="row2">
        <div class="field"><label class="label" for="booth">Booth</label><input class="input" id="booth" maxlength="12" placeholder="A14" autocapitalize="characters"></div>
        <div class="field"><label class="label" for="ig">Instagram</label><input class="input" id="ig" maxlength="60" placeholder="@yourname" autocapitalize="none" autocomplete="off"></div>
      </div>
      <div class="field"><label class="label" for="medium">What you make (optional)</label><input class="input" id="medium" maxlength="80" placeholder="Ceramics, large abstract florals…"></div>
      <p class="error" id="e" hidden></p>
      <button class="btn" id="go">Join ${esc(sh.name)}</button>
      <p class="hint">No password. This phone stays signed in. You can get a link for another device later.</p>
    </form></div>
  </section>`;
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
    alerts: pushSupported() && Notification.permission === "granted" ? "on" : "off",
  };
  const token = sess.token;
  let ws = null, backoff = 1000, lastPong = Date.now(), syncing = false, flushing = false, retryTimer = null;
  const origin = location.origin;
  const isDirector = () => S.me.role === "director";
  const member = (id) => S.members.find((m) => m.id === id);
  const buyer = (id) => S.buyers.find((b) => b.id === id);
  const dmCh = (other) => "dm:" + [S.me.id, other].sort().join(":");
  const dmOther = (ch) => ch.slice(3).split(":").find((x) => x !== S.me.id);
  const myLink = () => `${origin}/s/${code}?k=${token}`;
  const buyerPage = (id) => `${origin}/b/${code}/${id}`;
  const buyerLink = (b) => `${origin}/b/${code}/${S.me.id}${b.key ? "?k=" + b.key : ""}`;

  function save() {
    store.set(CK, { me: S.me, show: S.show, members: S.members, buyers: S.buyers, messages: S.messages.slice(-1500), lastSeq: S.lastSeq, ann: S.ann });
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
      if (m.kind === "system") needSync = true;
      if (m.ch.startsWith("buy:") && !buyer(m.ch.slice(4))) needSync = true;
      if (!member(m.from) && !m.from.startsWith("b") && m.from !== "system") needSync = true;
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
    const r = await api(`/show/${code}/sync?since=${S.lastSeq}`, { token });
    syncing = false;
    if (r.status === 401) return signedOut();
    if (!r.ok) { if (r.status === 0) setOnline(false); return; }
    const d = r.data;
    if (d.truncated) S.messages = [];
    S.me = d.me; S.show = d.show; S.members = d.members; S.buyers = d.buyers; S.ann = d.ann;
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
      const r = await api(`/show/${code}/send`, { method: "POST", token, body: item });
      if (r.ok) { S.outbox.shift(); saveOutbox(); merge([r.data.message]); S.lastSeq = Math.max(S.lastSeq, 0); continue; }
      if (r.status === 401) { flushing = false; return signedOut(); }
      if (r.status === 0 || r.status >= 500 || r.status === 429) { if (r.status === 0) S.online = false; break; }
      S.outbox.shift(); saveOutbox();
      toast(r.data.error || "That message couldn't be sent.");
    }
    flushing = false;
    if (S.outbox.length) retryTimer = setTimeout(flush, 4000);
    render({ soft: true });
  }

  function queue(item) {
    S.outbox.push({ id: uid(), ts: Date.now(), ...item });
    saveOutbox();
    render({ soft: true, stick: true });
    flush();
  }

  function connect() {
    if (ws && ws.readyState <= 1) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    try { ws = new WebSocket(`${proto}://${location.host}/api/show/${code}/ws?t=${encodeURIComponent(token)}`); }
    catch { ws = null; return; }
    ws.onopen = () => { backoff = 1000; lastPong = Date.now(); sendVis(); S.online = true; sync(); flush(); };
    ws.onmessage = (e) => {
      lastPong = Date.now();
      if (e.data === "pong") return;
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d.t === "msg") { if (merge([d.m])) { onIncoming(d.m); render({ soft: true }); } }
      else if (d.t === "sync") sync();
    };
    ws.onclose = (e) => {
      ws = null;
      if (e.code === 4001) return signedOut();
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 20000);
    };
    ws.onerror = () => {};
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
  addEventListener("online", () => { S.online = true; sync(); flush(); connect(); render({ soft: true }); });
  addEventListener("offline", () => setOnline(false));
  addEventListener("hashchange", () => render({ stick: true }));
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.t === "push") sync(); });

  function onIncoming(m) {
    if (m.from === S.me.id) return;
    if (m.kind === "ref" && m.meta && m.meta.to === S.me.id) {
      const from = member(m.from);
      toast(`Buyer heading your way from ${from ? from.name : "another artist"}`);
      try { navigator.vibrate && navigator.vibrate([80, 60, 80]); } catch {}
    } else if (m.ch.startsWith("buy:") && view() !== m.ch) {
      toast("New buyer message");
      try { navigator.vibrate && navigator.vibrate(60); } catch {}
    }
  }

  function signedOut() {
    dropSession(code);
    app.innerHTML = `<section class="screen"><div class="empty"><h3>You're signed out</h3><p>This phone's sign-in for ${esc(S.show.name)} isn't valid any more. Ask the show director for a new link, or join again.</p><a class="btn small" href="/s/${esc(code)}">Join again</a></div></section>`;
    try { ws && ws.close(); } catch {}
  }

  // ----- unread -----
  const chKey = (ch) => (ch === "ann" ? "group" : ch);
  function lastSeqIn(ch) {
    let s = 0;
    for (const m of S.messages) if (chKey(m.ch) === ch && m.seq > s) s = m.seq;
    return s;
  }
  function unread(ch) {
    const r = S.read[ch] || 0;
    let n = 0;
    for (const m of S.messages) if (chKey(m.ch) === ch && m.seq > r && m.from !== S.me.id && m.kind !== "system") n++;
    return n;
  }
  function unreadPrefix(prefix) {
    const chans = new Set(S.messages.filter((m) => m.ch.startsWith(prefix)).map((m) => m.ch));
    let n = 0; for (const c of chans) n += unread(c); return n;
  }
  function markRead(ch) {
    if (document.visibilityState !== "visible") return;
    const s = lastSeqIn(ch);
    if (s > (S.read[ch] || 0)) { S.read[ch] = s; saveRead(); }
  }
  function updateBadges() {
    const total = unread("group") + unreadPrefix("dm:") + unreadPrefix("buy:");
    document.title = (total ? `(${total}) ` : "") + (S.show.name || "Show Chat");
    try { if (navigator.setAppBadge) total ? navigator.setAppBadge(total) : navigator.clearAppBadge(); } catch {}
  }

  // ----- views -----
  function view() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!h) return "group";
    return h;
  }
  const go = (v) => { location.hash = v; };
  const tabs = () => isDirector() ? [["group", "Show chat"], ["direct", "Direct"], ["ann", "Announce"]] : [["group", "Show chat"], ["direct", "Direct"], ["buyers", "Buyers"]];

  function msgHtml(m, prev) {
    const mine = m.from === S.me.id;
    if (m.kind === "system") return `<p class="sys">${esc(m.body)}</p>`;
    if (m.kind === "ann") {
      const urgent = m.meta && m.meta.urgent;
      const dir = member(m.from);
      return `<div class="ann-item ${urgent ? "urgent" : ""}"><div class="ah"><span class="kind">${urgent ? "Urgent" : "Announcement"}</span><span class="time">${fmtTime(m.ts)}</span></div><div class="tx">${linkify(m.body)}</div><div class="seen">From ${esc(dir ? dir.name : "the director")}</div></div>`;
    }
    const sender = m.from.startsWith("b") ? buyer(m.from.slice(0)) : member(m.from);
    const name = m.from.startsWith("b") ? (sender && sender.name) || "Visitor" : sender ? sender.name : "Someone";
    if (m.kind === "ref") {
      const to = member(m.meta && m.meta.to);
      const forMe = to && to.id === S.me.id;
      return `<div class="msg ${mine ? "me" : ""}"><div class="body" style="max-width:92%"><p class="from"><b>${esc(mine ? "You" : name)}</b>${boothTag(sender)}<span class="time">${fmtTime(m.ts)}</span></p>
        <div class="refcard"><span class="rt">${forMe ? "Buyer coming to you" : "Buyer referral"}</span>
        <span class="rto">→ ${esc(to ? to.name : "an artist")} ${boothTag(to)}</span>
        ${m.body ? `<span class="rn">${linkify(m.body)}</span>` : ""}${m.meta.status ? `<span class="rs">${esc(m.meta.status)}</span>` : ""}</div></div></div>`;
    }
    const cont = prev && prev.from === m.from && prev.kind === m.kind && m.ts - prev.ts < 5 * 60000 && !m.ch.startsWith("dm:") && !m.ch.startsWith("buy:");
    const showFrom = !mine && m.ch === "group";
    return `<div class="msg ${mine ? "me" : ""} ${cont ? "cont" : ""}">
      ${showFrom ? (cont ? `<span class="av sm" style="visibility:hidden"></span>` : avatar(sender || { id: m.from, name }, "sm")) : ""}
      <div class="body">${showFrom ? `<p class="from"><b>${esc(name)}</b>${boothTag(sender)}<span class="time">${fmtTime(m.ts)}</span></p>` : ""}
      <div class="bubble">${m.meta && m.meta.piece ? `<b>About ${esc(m.meta.piece)}:</b> ` : ""}${linkify(m.body)}</div>
      ${!showFrom ? `<span class="state">${fmtTime(m.ts)}</span>` : ""}</div></div>`;
  }
  function pendingHtml(o) {
    return `<div class="msg me pending"><div class="body"><div class="bubble">${o.kind === "ref" ? "Buyer referral" : linkify(o.body)}</div><span class="state">${S.online ? "Sending…" : "Waiting for signal"}</span></div></div>`;
  }
  function feed(chs, emptyText) {
    const list = S.messages.filter((m) => chs.includes(m.ch));
    const pend = S.outbox.filter((o) => chs.includes(o.channel));
    if (!list.length && !pend.length) return `<div class="empty"><p>${emptyText}</p></div>`;
    let out = "", day = "", prev = null;
    for (const m of list) {
      const d = fmtDay(m.ts);
      if (d !== day) { out += `<p class="daymark">${d}</p>`; day = d; prev = null; }
      out += msgHtml(m, prev); prev = m;
    }
    for (const o of pend) out += pendingHtml(o);
    return `<div class="msgs">${out}</div>`;
  }

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
    const badge = { group: unread("group"), direct: unreadPrefix("dm:"), buyers: unreadPrefix("buy:"), ann: 0 };
    return `<div class="seg" role="tablist">${tabs().map(([v, label]) => `<button type="button" role="tab" data-tab="${v}" aria-selected="${cur === v}">${label}${badge[v] && cur !== v ? ` <span class="badge">${badge[v]}</span>` : ""}</button>`).join("")}</div>`;
  }
  function topBar() {
    const artists = S.members.filter((m) => m.role === "artist").length;
    return `<div class="appbar"><div class="grow"><h2>${esc(S.show.name)}</h2><div class="sub">${esc([`${artists} artist${artists === 1 ? "" : "s"}`, S.show.venue].filter(Boolean).join(" · "))}</div></div>
      <button class="iconbtn" data-go="people" aria-label="Who's here">${ICON.people}</button>
      <button class="iconbtn" data-go="me" aria-label="Your profile and settings">${ICON.gear}</button></div>`;
  }
  function subBar(title, sub, extra = "") {
    return `<div class="appbar"><button class="iconbtn" data-act="back" aria-label="Back">${ICON.back}</button><div class="grow"><h2>${title}</h2>${sub ? `<div class="sub">${sub}</div>` : ""}</div>${extra}</div>`;
  }
  function composer(ch, placeholder, { refer = false } = {}) {
    return `<form class="composer" data-compose="${esc(ch)}">
      ${refer ? `<button class="refbtn" type="button" data-go="refer">${ICON.refer}Refer</button>` : ""}
      <textarea class="input" rows="1" id="compose-input" data-draft="c:${esc(ch)}" placeholder="${esc(placeholder)}" aria-label="Message" enterkeyhint="send"></textarea>
      <button class="send" type="submit" aria-label="Send">${ICON.send}</button></form>`;
  }

  function vGroup() {
    markRead("group");
    return `<section class="screen">${topBar()}${tabsHtml("group")}${banners()}${pinnedHtml()}
      <div class="scroll" id="scroller">${feed(["group", "ann"], "Say hello to the other exhibitors.")}</div>
      ${composer("group", "Message the show", { refer: true })}</section>`;
  }
  function vDirect() {
    const others = S.members.filter((m) => m.id !== S.me.id);
    const rows = others.map((m) => {
      const ch = dmCh(m.id);
      const last = [...S.messages].reverse().find((x) => x.ch === ch);
      return { m, ch, last, n: unread(ch) };
    }).sort((a, b) => (b.last ? b.last.seq : 0) - (a.last ? a.last.seq : 0));
    return `<section class="screen">${topBar()}${tabsHtml("direct")}${banners()}
      <div class="scroll">${rows.length ? rows.map(({ m, last, n }) => `<button class="convo ${n ? "unread" : ""}" data-go="dm:${m.id}">${avatar(m)}<span class="who"><span class="top"><span class="nm">${esc(m.name)}</span>${boothTag(m)}${last ? `<span class="time">${fmtShort(last.ts)}</span>` : ""}</span><span class="pv">${last ? esc((last.from === S.me.id ? "You: " : "") + last.body) : esc(m.medium || "Start a conversation")}</span></span>${n ? `<span class="badge">${n}</span>` : ""}</button>`).join("") : `<div class="empty"><p>No one else has joined yet. Share the show code ${esc(code)}.</p></div>`}</div></section>`;
  }
  function vDM(other) {
    const m = member(other);
    if (!m) return vGone("That person isn't in the show any more.");
    const ch = dmCh(other);
    markRead(ch);
    return `<section class="screen">${subBar(esc(m.name), [m.role === "director" ? "Show director" : m.booth ? "Booth " + esc(m.booth) : "", esc(m.medium)].filter(Boolean).join(" · "))}${banners()}
      <div class="scroll" id="scroller">${feed([ch], `Only you and ${esc(m.name)} see this conversation.`)}</div>${composer(ch, "Message " + m.name)}</section>`;
  }
  function vBuyers() {
    const rows = S.buyers.map((b) => {
      const ch = "buy:" + b.id;
      const last = [...S.messages].reverse().find((x) => x.ch === ch);
      return { b, last, n: unread(ch) };
    }).sort((a, b) => (b.last ? b.last.seq : 0) - (a.last ? a.last.seq : 0));
    return `<section class="screen">${topBar()}${tabsHtml("buyers")}${banners()}
      <div class="scroll">${rows.length ? rows.map(({ b, last, n }) => `<button class="convo ${n ? "unread" : ""}" data-go="buy:${b.id}">${avatar({ id: b.id, name: b.name || "Visitor" })}<span class="who"><span class="top"><span class="nm">${esc(b.name || "Visitor")}</span>${b.phone ? `<span class="pill">Text</span>` : b.email ? `<span class="pill">Email</span>` : ""}${last ? `<span class="time">${fmtShort(last.ts)}</span>` : ""}</span><span class="pv">${last ? esc((last.from === S.me.id ? "You: " : "") + last.body) : ""}</span></span>${n ? `<span class="badge">${n}</span>` : ""}</button>`).join("")
        : `<div class="empty"><p>When a buyer scans your QR card and sends a message, it shows up here.</p><a class="btn small" href="/s/${esc(code)}/cards?only=me">${ICON.qr} Your QR card</a></div>`}</div></section>`;
  }
  function vBuyer(bid) {
    const b = buyer(bid);
    if (!b) return vGone("That conversation isn't here.");
    const ch = "buy:" + bid;
    markRead(ch);
    const tel = b.phone.replace(/[^\d+]/g, "");
    const contact = (b.phone ? `<a href="sms:${esc(tel)}">Text ${esc(b.phone)}</a><a href="tel:${esc(tel)}">Call</a>` : "") + (b.email ? `<a href="mailto:${esc(b.email)}">Email</a>` : "");
    let follow = "";
    if (S.followup && S.followup.bid === bid && (b.phone || b.email)) {
      const msg = `${S.followup.text}\n\n— ${S.me.name}${S.me.booth ? ", Booth " + S.me.booth : ""}, ${S.show.name}\nKeep chatting here: ${buyerLink(b)}`;
      follow = `<div class="followup"><span>Also send it to ${esc(b.name || "them")} by ${b.phone ? "text" : "email"} so they see it right away:</span><div class="btnrow">
        ${b.phone ? `<a class="btn small" href="sms:${esc(tel)}?&body=${encodeURIComponent(msg)}" data-act="followed">Text it</a>` : ""}
        ${b.email ? `<a class="btn small ${b.phone ? "ghost" : ""}" href="mailto:${esc(b.email)}?subject=${encodeURIComponent("Your message at " + S.show.name)}&body=${encodeURIComponent(msg)}" data-act="followed">Email it</a>` : ""}
        <button class="btn small ghost" data-act="followed">Skip</button></div></div>`;
    }
    return `<section class="screen">${subBar(esc(b.name || "Visitor"), "Buyer · from your QR card")}
      <div class="contactbar">${contact || `<span class="none">No phone or email. They see your reply when they come back to the page.</span>`}<a href="#" data-act="copy-buyer" data-id="${esc(bid)}">Copy their chat link</a></div>${banners()}
      <div class="scroll" id="scroller">${feed([ch], "")}</div>${follow}${composer(ch, "Reply to " + (b.name || "this buyer"))}</section>`;
  }
  function vGone(text) {
    return `<section class="screen">${subBar("Not found", "")}<div class="empty"><p>${esc(text)}</p></div></section>`;
  }
  function vAnn() {
    const list = S.messages.filter((m) => m.ch === "ann").reverse();
    const pend = S.outbox.filter((o) => o.channel === "ann");
    const n = S.ann.artists;
    return `<section class="screen">${topBar()}${tabsHtml("ann")}${banners()}
      <div class="scroll"><div class="pad">
        ${pend.map((o) => `<div class="ann-item ${o.meta.urgent ? "urgent" : ""}"><div class="ah"><span class="kind">${o.meta.urgent ? "Urgent" : "Announcement"}</span><span>${S.online ? "Sending…" : "Waiting for signal"}</span></div><div class="tx">${esc(o.body)}</div></div>`).join("")}
        ${list.length ? list.map((m) => `<div class="ann-item ${m.meta && m.meta.urgent ? "urgent" : ""}"><div class="ah"><span class="kind">${m.meta && m.meta.urgent ? "Urgent, pinned" : "Announcement"}</span><span class="time">${fmtDay(m.ts)} ${fmtTime(m.ts)}</span></div><div class="tx">${linkify(m.body)}</div><div class="seen">Reached ${S.ann.delivered[m.seq] ?? 0} of ${n} artists' phones</div></div>`).join("") : pend.length ? "" : `<p class="hint">Announcements go to every exhibitor with an alert, and appear in the show chat. Urgent ones stay pinned at the top for a day.</p>`}
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
        <p class="hint">It goes to them as an alert and shows in the show chat.</p>
      </form></div></section>`;
  }
  function vPeople() {
    const dir = isDirector();
    return `<section class="screen">${subBar("Who's here", `${S.members.length} in the show chat`)}
      <div class="scroll"><div class="pad" style="gap:0">
        ${S.members.map((m) => `<div class="person"><button class="person" style="border:0;padding:0" data-go="${m.id === S.me.id ? "me" : "dm:" + m.id}">${avatar(m)}<span class="who"><span class="nm">${esc(m.name)} ${boothTag(m)}${m.id === S.me.id ? `<span class="you">you</span>` : ""}</span><span class="md">${esc([m.medium, m.instagram ? "@" + m.instagram : ""].filter(Boolean).join(" · ") || (m.role === "director" ? "Show director" : ""))}</span></span></button>
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
          <div class="field"><label class="label" for="me-name">Name</label><input class="input" id="me-name" value="${esc(me.name)}" maxlength="60" required></div>
          <div class="row2"><div class="field"><label class="label" for="me-booth">Booth</label><input class="input" id="me-booth" value="${esc(me.booth || "")}" maxlength="12"></div>
          <div class="field"><label class="label" for="me-ig">Instagram</label><input class="input" id="me-ig" value="${esc(me.instagram ? "@" + me.instagram : "")}" maxlength="60" autocapitalize="none" placeholder="@yourname"></div></div>
          <div class="field"><label class="label" for="me-medium">What you make</label><input class="input" id="me-medium" value="${esc(me.medium || "")}" maxlength="80"></div>
          <button class="btn ghost">Save</button></form>
        <div class="card"><h3>Alerts</h3>
          ${S.alerts === "on" ? `<p class="hint">Alerts are on for this phone. You'll get buyer messages, referrals, direct messages and announcements.</p><div class="btnrow"><button class="btn small ghost" data-act="test-alert">Send me a test alert</button></div>`
            : ios ? `<p class="hint"><b>On iPhone, add Show Chat to your Home Screen first.</b></p><ol class="hint" style="margin:0;padding-left:18px"><li>Tap the Share button at the bottom of Safari.</li><li>Choose <b>Add to Home Screen</b>, then Add.</li><li>Open Show Chat from the new icon and tap Turn on alerts.</li></ol><p class="small">You stay signed in on the Home Screen app.</p>`
            : `<p class="hint">Get a buzz when a buyer messages you or another artist sends you a buyer.</p><button class="btn" data-act="alerts-on">Turn on alerts</button><p class="small" id="alert-help"></p>`}
        </div>
        ${me.role === "artist" || !dir ? `<div class="card"><h3>Your QR card</h3><p class="hint">Buyers scan it to message you. No app or account for them.</p><div class="btnrow"><a class="btn small" href="/s/${esc(code)}/cards?only=me">${ICON.qr} Show or print it</a><button class="btn small ghost" data-act="copy" data-text="${esc(buyerPage(me.id))}">Copy your buyer link</button></div></div>` : ""}
        ${dir ? `<div class="card tint"><h3>Invite artists</h3><p class="hint">Artists open the link, or type the code on the home page.</p>
          <div class="copyline"><code>${esc(code)}</code><button class="btn small" data-act="share-invite">Share invite</button></div>
          <div class="btnrow"><a class="btn small ghost" href="/s/${esc(code)}/cards">Print QR cards for all artists</a></div></div>
          <form class="card" id="show-form"><h3>Show details</h3>
            <input class="input" id="sh-name" value="${esc(S.show.name)}" maxlength="60" required aria-label="Show name">
            <div class="row2"><input class="input" id="sh-venue" value="${esc(S.show.venue || "")}" maxlength="120" placeholder="Venue" aria-label="Venue"><input class="input" id="sh-dates" value="${esc(S.show.dates || "")}" maxlength="80" placeholder="Dates" aria-label="Dates"></div>
            <button class="btn ghost">Save show details</button></form>` : ""}
        <div class="card"><h3>Use another phone or computer</h3><p class="hint">This is your private sign-in link. Don't share it: anyone with it can post as you.</p><div class="btnrow"><button class="btn small ghost" data-act="copy" data-text="${esc(myLink())}">Copy my sign-in link</button></div></div>
        <button class="btn danger" data-act="leave">Sign out on this phone</button>
        <p class="small" style="text-align:center">Show Chat beta ${VERSION} · show code ${esc(code)}</p>
      </div></div></section>`;
  }
  function vWelcome() {
    const dir = isDirector();
    return `<section class="screen">${subBar(dir ? "Your show is ready" : "You're in", esc(S.show.name))}
      <div class="scroll"><div class="pad">
        <div class="showcard"><span class="name">${esc(S.show.name)}</span><span class="meta">Show code ${esc(code)}</span></div>
        ${dir ? `<p>Send artists the invite. They join with their name and booth, no password.</p><button class="btn" data-act="share-invite">Share invite link</button>
          <p class="hint">Keep your own sign-in link somewhere safe, in case you switch phones.</p><button class="btn ghost" data-act="copy" data-text="${esc(myLink())}">Copy my director link</button>`
          : `<p>Your QR card lets buyers message you straight from your booth.</p><a class="btn" href="/s/${esc(code)}/cards?only=me">${ICON.qr} See your QR card</a>`}
        ${pushSupported() ? `<button class="btn ghost" data-act="alerts-on">Turn on alerts</button>` : isIOS() ? `<button class="btn ghost" data-go="me">Get alerts on iPhone</button>` : ""}
        <button class="btn ghost" data-go="group">Go to the show chat</button>
      </div></div></section>`;
  }

  // ----- render (keeps typing, focus and scroll position across updates) -----
  function render(opts = {}) {
    const v = view();
    if (opts.soft && ["refer", "me", "people", "welcome"].includes(v)) { updateBadges(); return; }
    const prevScroller = $("#scroller");
    const wasAtBottom = !prevScroller || prevScroller.scrollHeight - prevScroller.scrollTop - prevScroller.clientHeight < 80;
    const prevTop = prevScroller ? prevScroller.scrollTop : 0;
    const active = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.draft : null;
    const sameView = app.dataset.view === v;
    let html;
    if (v === "group") html = vGroup();
    else if (v === "direct") html = vDirect();
    else if (v === "buyers") html = vBuyers();
    else if (v === "ann" && isDirector()) html = vAnn();
    else if (v === "refer") html = vRefer();
    else if (v === "people") html = vPeople();
    else if (v === "me") html = vMe();
    else if (v === "welcome") html = vWelcome();
    else if (v.startsWith("dm:")) html = vDM(v.slice(3));
    else if (v.startsWith("buy:")) html = vBuyer(v.slice(4));
    else html = vGroup();
    app.innerHTML = html;
    app.dataset.view = v;
    for (const el of $$("[data-draft]")) {
      const k = el.dataset.draft;
      if (S.draft[k] != null) el.value = S.draft[k];
      el.addEventListener("input", () => { S.draft[k] = el.value; if (el.tagName === "TEXTAREA" && el.id === "compose-input") autosize(el); if (k === "refq") { S.refer.q = el.value; rerenderKeepFocus(); } });
      if (k === active) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch {} }
    }
    const ci = $("#compose-input"); if (ci) autosize(ci);
    const sc = $("#scroller");
    if (sc) sc.scrollTop = !sameView || wasAtBottom || opts.stick ? sc.scrollHeight : prevTop;
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
  function autosize(el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 140) + "px"; }

  // ----- events -----
  app.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-go],[data-tab],[data-act],[data-to],[data-status],[data-urgent]");
    if (!t) return;
    if (t.dataset.go) { e.preventDefault(); return go(t.dataset.go); }
    if (t.dataset.tab) { history.replaceState(null, "", "#" + t.dataset.tab); return render(); }
    if (t.dataset.to) { S.refer.to = t.dataset.to; return render(); }
    if (t.dataset.status) { S.refer.status = t.dataset.status; return render(); }
    if (t.dataset.urgent) { S.annUrgent = t.dataset.urgent === "1"; return render(); }
    const act = t.dataset.act;
    if (act === "back") { e.preventDefault(); if (history.length > 1 && document.referrer !== "") history.back(); else go(view().startsWith("buy:") ? "buyers" : view().startsWith("dm:") ? "direct" : "group"); setTimeout(() => { if (["refer", "people", "me", "welcome"].includes(view()) || view() === "") render(); }, 50); return; }
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
      input.value = ""; S.draft["c:" + ch] = "";
      if (ch.startsWith("buy:")) S.followup = { bid: ch.slice(4), text: body };
      queue({ channel: ch, body });
      input.focus();
      return;
    }
    if (f.id === "refer-form") {
      if (!S.refer.to) return;
      const to = member(S.refer.to);
      queue({ channel: "group", kind: "ref", body: (S.draft.refnote || "").trim(), meta: { to: S.refer.to, status: S.refer.status } });
      S.draft.refnote = ""; S.draft.refq = ""; S.refer = { to: null, status: "Walking over now", q: "" };
      toast(`Heads-up sent to ${to ? to.name : "them"}`);
      history.replaceState(null, "", "#group"); render({ stick: true });
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
      const r = await api(`/show/${code}/me`, { method: "POST", token, body: { name: $("#me-name").value, booth: $("#me-booth").value, medium: $("#me-medium").value, instagram: $("#me-ig").value } });
      if (!r.ok) return toast(r.data.error || "Couldn't save. Check your signal.");
      S.me = r.data.me; toast("Saved"); sync(); return;
    }
    if (f.id === "show-form") {
      const r = await api(`/show/${code}/show`, { method: "POST", token, body: { name: $("#sh-name").value, venue: $("#sh-venue").value, dates: $("#sh-dates").value } });
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
  app.addEventListener("keydown", (e) => {
    if (e.target.id === "compose-input" && e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer: fine)").matches) {
      e.preventDefault(); e.target.form.requestSubmit();
    }
  });

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
  const CK = "asc.bcache." + key;
  const cached = store.get(CK, {});
  const B = { artist: cached.artist || null, show: cached.show || null, buyer: cached.buyer || null, messages: cached.messages || [], outbox: store.get("asc.boutbox." + key, []), online: true, alerts: pushSupported() && Notification.permission === "granted" ? "on" : "off" };
  let ws = null, backoff = 1000, flushing = false;

  const info = await api(`/show/${code}/artist?id=${artistId}`);
  if (info.ok) { B.artist = info.data.artist; B.show = info.data.show; }
  else if (!B.artist) {
    app.innerHTML = `<section class="screen"><div class="empty"><h3>${info.status === 404 ? "This card isn't active" : "Can't load this page"}</h3><p>${info.status === 404 ? "The artist may have left the show chat." : "Check your signal and try again."}</p><button class="btn small" onclick="location.reload()">Try again</button></div></section>`;
    return;
  }
  const A = () => B.artist;
  const first = () => (A().name || "the artist").split(/\s+/)[0];
  const sess = () => buyerSessions()[key];
  const saveCache = () => store.set(CK, { artist: B.artist, show: B.show, buyer: B.buyer, messages: B.messages.slice(-500) });
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
    B.online = true; B.buyer = r.data.buyer; if (r.data.artist) B.artist = r.data.artist;
    merge(r.data.messages); saveCache(); render();
  }
  async function flush() {
    const s = sess(); if (flushing || !B.outbox.length) return;
    flushing = true;
    while (B.outbox.length) {
      const item = B.outbox[0];
      let r;
      if (!s) r = await api(`/show/${code}/buyer/start`, { method: "POST", body: { ...item, artist: artistId } });
      else r = await api(`/show/${code}/buyer/send`, { method: "POST", token: s.token, body: item });
      if (r.ok) {
        if (!s && r.data.token) { saveBuyer(key, { token: r.data.token }); B.buyer = r.data.buyer; setManifest(`/b/${code}/${artistId}?k=${r.data.token}`, `${A().name}`); connect(); }
        B.outbox.shift(); saveOutbox(); merge([r.data.message]);
        if (!s) { flushing = false; return flush(); }
        continue;
      }
      if (r.status === 0 || r.status >= 500 || r.status === 429) { B.online = r.status !== 0; break; }
      B.outbox.shift(); saveOutbox(); toast(r.data.error || "That message couldn't be sent.");
    }
    flushing = false;
    if (B.outbox.length) setTimeout(flush, 4000);
    render();
  }
  function connect() {
    const s = sess(); if (!s || (ws && ws.readyState <= 1)) return;
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/show/${code}/ws?t=${encodeURIComponent(s.token)}`);
    ws.onopen = () => { backoff = 1000; sync(); flush(); ws.send(JSON.stringify({ t: "vis", v: document.visibilityState === "visible" })); };
    ws.onmessage = (e) => { if (e.data === "pong") return; try { const d = JSON.parse(e.data); if (d.t === "msg" && merge([d.m])) render(); } catch {} };
    ws.onclose = () => { ws = null; setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 20000); };
  }
  setInterval(() => { if (ws && ws.readyState === 1) ws.send("ping"); else if (sess()) sync(); }, 20000);
  document.addEventListener("visibilitychange", () => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: "vis", v: document.visibilityState === "visible" })); if (document.visibilityState === "visible") { sync(); flush(); connect(); } });
  addEventListener("online", () => { B.online = true; flush(); sync(); connect(); });
  addEventListener("offline", () => { B.online = false; render(); });

  function head() {
    const a = A();
    return `<div class="artist-head">${avatar(a, "lg")}<div><h3>${esc(a.name)}</h3><div class="md">${a.booth ? `<span class="booth">Booth ${esc(a.booth)}</span>` : ""}${esc([a.medium, B.show && B.show.name].filter(Boolean).join(" · "))}</div></div></div>`;
  }
  function igButton() {
    const a = A();
    return a.instagram ? `<a class="btn igbtn" href="https://ig.me/m/${encodeURIComponent(a.instagram)}" target="_blank" rel="noopener">Message @${esc(a.instagram)} on Instagram</a>` : "";
  }
  function thread() {
    const items = B.messages.map((m) => {
      const mine = m.from !== artistId;
      return `<div class="msg ${mine ? "me" : ""}">${mine ? "" : avatar(A(), "sm")}<div class="body"><div class="bubble">${m.meta && m.meta.piece ? `<b>About ${esc(m.meta.piece)}:</b> ` : ""}${linkify(m.body)}</div><span class="state">${mine ? "You" : esc(first())} · ${fmtDay(m.ts)} ${fmtTime(m.ts)}</span></div></div>`;
    }).join("") + B.outbox.map((o) => `<div class="msg me pending"><div class="body"><div class="bubble">${linkify(o.body)}</div><span class="state">${B.online ? "Sending…" : "Waiting for signal, it'll send by itself"}</span></div></div>`).join("");
    return `<div class="msgs" style="padding:0">${items}</div>`;
  }

  function render() {
    const s = sess();
    const active = document.activeElement ? document.activeElement.id : null;
    const keep = {}; for (const el of $$("input,textarea", app)) keep[el.id] = el.value;
    if (!s && !B.outbox.length) {
      app.innerHTML = `<section class="screen"><div class="scroll"><form class="pad" id="start">
        ${head()}
        <div class="field"><label class="label" for="b-msg">Message ${esc(first())}</label><textarea class="textarea" id="b-msg" required maxlength="2000" placeholder="Is the blue piece still available? Do you ship?"></textarea></div>
        <div class="oq"><p class="label" style="color:var(--accent)">How should ${esc(first())} reply?</p>
          <div class="field"><label class="label" for="b-phone">Your phone, for a text back</label><input class="input" id="b-phone" type="tel" autocomplete="tel" maxlength="30" placeholder="(305) 555-0100"></div>
          <div class="field"><label class="label" for="b-email">Or your email</label><input class="input" id="b-email" type="email" autocomplete="email" maxlength="120" placeholder="you@email.com"></div>
          <div class="field"><label class="label" for="b-name">Your name</label><input class="input" id="b-name" autocomplete="name" maxlength="60"></div>
          <p class="small">Both are optional. Replies also show on this page, and you can keep chatting here any time.</p></div>
        <button class="btn" id="b-go">Send to ${esc(first())}</button>
        ${igButton() ? `<div class="or">or</div>${igButton()}` : ""}
        <p class="small" style="text-align:center">No account or app needed. Only ${esc(first())} sees your message.</p>
      </form></div></section>`;
    } else {
      const b = B.buyer || {};
      const needContact = !b.phone && !b.email;
      app.innerHTML = `<section class="screen">
        <div class="appbar"><div class="grow"><h2>${esc(A().name)}</h2><div class="sub">${esc([A().booth ? "Booth " + A().booth : "", B.show && B.show.name].filter(Boolean).join(" · "))}</div></div>${A().instagram ? `<a class="iconbtn" href="https://ig.me/m/${encodeURIComponent(A().instagram)}" target="_blank" rel="noopener" aria-label="Message on Instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg></a>` : ""}</div>
        ${!B.online ? `<div class="banner warn" style="margin-top:8px"><span class="grow">No signal. Your message will send when you're back.</span></div>` : ""}
        <div class="scroll" id="scroller"><div class="pad">
          ${thread()}
          ${needContact && s ? `<form class="oq" id="contact"><p class="label" style="color:var(--accent)">Get ${esc(first())}'s reply by text</p><input class="input" id="c-phone" type="tel" autocomplete="tel" placeholder="Your phone" maxlength="30"><input class="input" id="c-email" type="email" autocomplete="email" placeholder="Or your email" maxlength="120"><button class="btn small">Save</button></form>` : ""}
          ${s && B.alerts !== "on" && pushSupported() ? `<button class="btn ghost small" id="b-alerts">Get a notification here when ${esc(first())} replies</button>` : ""}
          ${s ? `<button class="btn ghost small" id="b-save">Save this conversation (copy your private link)</button>` : ""}
        </div></div>
        <form class="composer" id="b-compose"><textarea class="input" rows="1" id="b-input" placeholder="Message ${esc(first())}" aria-label="Message"></textarea><button class="send" aria-label="Send">${ICON.send}</button></form>
      </section>`;
      const sc = $("#scroller"); if (sc) sc.scrollTop = sc.scrollHeight;
    }
    for (const [id, v] of Object.entries(keep)) { const el = document.getElementById(id); if (el && v) el.value = v; }
    if (active) { const el = document.getElementById(active); if (el) el.focus(); }
  }

  app.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (e.target.id === "start") {
      const body = $("#b-msg").value.trim(); if (!body) return;
      B.outbox.push({ id: uid(), body, name: $("#b-name").value, phone: $("#b-phone").value, email: $("#b-email").value });
      B.buyer = { name: $("#b-name").value, phone: $("#b-phone").value, email: $("#b-email").value };
      saveOutbox(); app.innerHTML = ""; render(); flush();
    } else if (e.target.id === "b-compose") {
      const el = $("#b-input"); const body = el.value.trim(); if (!body) return;
      el.value = ""; B.outbox.push({ id: uid(), body }); saveOutbox(); render(); flush();
    } else if (e.target.id === "contact") {
      const r = await api(`/show/${code}/buyer/me`, { method: "POST", token: sess().token, body: { phone: $("#c-phone").value, email: $("#c-email").value } });
      if (r.ok) { B.buyer = r.data.buyer; saveCache(); toast(`Saved. ${first()} can text or email you now.`); render(); } else toast(r.data.error || "Couldn't save. Check your signal.");
    }
  });
  app.addEventListener("click", async (e) => {
    if (e.target.id === "b-alerts") {
      const r = await ensurePush(code, sess().token, { ask: true });
      B.alerts = r.ok ? "on" : "off"; toast(r.ok ? "You'll get a notification when they reply" : alertsHelp(r.reason)); render();
    }
    if (e.target.id === "b-save") copyText(`${location.origin}/b/${code}/${artistId}?k=${sess().token}`, "Private link copied. Save it to come back to this chat.");
  });

  render();
  if (sess()) { setManifest(`/b/${code}/${artistId}?k=${sess().token}`, A().name); sync(); connect(); flush(); if (B.alerts === "on") ensurePush(code, sess().token); }
  else if (B.outbox.length) flush();
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
  const list = only ? data.members.filter((m) => m.id === data.me.id) : data.members.filter((m) => m.role === "artist");
  const showJoin = !only && data.me.role === "director";
  const origin = location.origin;
  const card = (m) => {
    const url = `${origin}/b/${code}/${m.id}`;
    return `<div class="qrcard"><span class="show">${esc(data.show.name)}</span><span class="qn">${esc(m.name)}</span>${m.booth ? `<span class="qb">Booth ${esc(m.booth)}</span>` : ""}
      ${qrSvg(url)}<span class="qs">Scan to message me</span><span class="qt">Ask about a piece, prices or shipping.<br>No app or account needed.</span>${m.instagram ? `<span class="qt">Instagram @${esc(m.instagram)}</span>` : ""}<span class="qu">${esc(url.replace(/^https?:\/\//, ""))}</span></div>`;
  };
  const joinCard = () => {
    const url = `${origin}/s/${code}`;
    return `<div class="qrcard"><span class="show">${esc(data.show.name)}</span><span class="qn">Exhibitors: join the show chat</span>${qrSvg(url)}<span class="qs">Show code ${esc(code)}</span><span class="qt">Group chat, direct messages, buyer referrals and announcements.</span><span class="qu">${esc(url.replace(/^https?:\/\//, ""))}</span></div>`;
  };
  app.style.maxWidth = "none"; app.style.height = "auto";
  app.innerHTML = `<div class="print-page"><div class="print-tools">
      <div style="display:flex;gap:10px;align-items:center"><a class="iconbtn" href="/s/${esc(code)}" aria-label="Back">${ICON.back}</a><h1 class="display" style="font-size:26px">${only ? "Your QR card" : "QR cards for every artist"}</h1></div>
      <p class="hint">${only ? "Show this on your phone, or print it for your booth." : "Four cards per letter-size page. Print, cut on the dashed lines and put one at each booth."} Each card opens a page where buyers can message that artist.</p>
      <div class="btnrow"><button class="btn small" onclick="print()">Print</button></div>
      ${!list.length ? `<p class="hint">No artists have joined yet.</p>` : ""}
    </div><div class="cards">${list.map(card).join("")}${showJoin ? joinCard() : ""}</div></div>`;
}

// ---------- boot ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
route();
