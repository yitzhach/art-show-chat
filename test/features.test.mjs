// Phone screens for tabs and unread counts, typing dots, reactions, profiles, groups,
// the new-message pill and light/dark (jsdom), against a running server (npm run dev).
import { JSDOM } from "jsdom";
import fs from "node:fs";
const BASE = process.env.BASE || "http://127.0.0.1:8787";
const html = fs.readFileSync("public/index.html", "utf8").replace(/<script[^>]*><\/script>/g, "");
const appJs = fs.readFileSync("public/app.js", "utf8");
const qrJs = fs.readFileSync("public/vendor/qrcode.js", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } else console.log("ok -", m); };
const call = async (path, { method = "GET", body, token } = {}) => {
  const r = await fetch(BASE + "/api" + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

function browser(path, storage = {}, { tall = false } = {}) {
  const dom = new JSDOM(html, { url: BASE + path, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
  w.fetch = (u, o) => fetch(String(u).startsWith("data:") ? u : new URL(u, BASE), o);
  w.WebSocket = WebSocket;
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  Object.defineProperty(w, "crypto", { value: globalThis.crypto });
  w.HTMLFormElement.prototype.requestSubmit = function () { this.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); };
  w.Element.prototype.scrollIntoView = () => {};
  w.Element.prototype.scrollTo = function (o) { this.scrollTop = o.top; };
  w.confirm = () => true;
  if (tall) {
    // jsdom has no layout: pretend the chat is long enough to scroll.
    const tops = new WeakMap();
    Object.defineProperty(w.HTMLElement.prototype, "scrollHeight", { configurable: true, get() { return this.id === "scroller" ? 2000 : 0; } });
    Object.defineProperty(w.HTMLElement.prototype, "clientHeight", { configurable: true, get() { return this.id === "scroller" ? 500 : 0; } });
    Object.defineProperty(w.Element.prototype, "scrollTop", { configurable: true, get() { return tops.get(this) || 0; }, set(v) { tops.set(this, Math.max(0, Math.min(v, (this.scrollHeight || 0) - (this.clientHeight || 0)))); } });
  }
  w.eval(qrJs + "\nwindow.qrcode = qrcode;");
  w.eval(appJs);
  return w;
}
const $ = (w, sel) => w.document.querySelector(sel);
const $$ = (w, sel) => [...w.document.querySelectorAll(sel)];
const text = (w) => w.document.getElementById("app").textContent;
const click = (w, sel) => { const el = typeof sel === "string" ? $(w, sel) : sel; if (!el) throw new Error("nothing to click: " + sel); el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true })); };
const fire = (w, el, type) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true }));
const submit = (w, sel) => $(w, sel).dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
const type = (w, sel, v) => { const el = $(w, sel); el.value = v; el.dispatchEvent(new w.Event("input", { bubbles: true })); };
const badge = (w, tab) => { const b = $(w, `[data-tab="${tab}"] .badge`); return b ? Number(b.textContent) : 0; };
const go = async (w, hash, ms = 300) => { w.location.hash = hash; await sleep(ms); };

// A show with a director and two artists, made through the API.
const code = "F" + Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, "D");
let r = await call("/create", { method: "POST", body: { name: "Red Dot Features", director: "Isaac", code } });
const dirTok = r.data.token;
r = await call(`/show/${code}/sync?since=0`, { token: dirTok });
const dir = { token: dirTok, id: r.data.me.id, name: "Isaac", role: "director" };
r = await call(`/show/${code}/join`, { method: "POST", body: { name: "Maya Lindqvist", booth: "A14", medium: "Ceramics" } });
const maya = { token: r.data.token, id: r.data.me.id, name: "Maya Lindqvist", role: "artist" };
r = await call(`/show/${code}/join`, { method: "POST", body: { name: "Leo Park", booth: "B2", medium: "Prints" } });
const leo = { token: r.data.token, id: r.data.me.id, name: "Leo Park", role: "artist" };
const sess = (p) => ({ "asc.sessions": { [code]: { token: p.token, id: p.id, name: p.name, role: p.role, showName: "Red Dot Features" } } });
await call(`/show/${code}/me`, { method: "POST", token: maya.token, body: { bio: "Wheel-thrown blue jars" } });

const L = browser(`/s/${code}#dms`, sess(leo), { tall: true });
const M = browser(`/s/${code}#group`, sess(maya));
await sleep(1200);

// ---- tabs and their unread counts ----
assert(JSON.stringify($$(L, "[data-tab]").map((t) => t.textContent.replace(/\d+/g, "").trim())) === '["Show","DMs","Groups","Buyers"]', "Show, DMs, Groups and Buyers tabs");
const dmCh = "dm:" + [maya.id, leo.id].sort().join(":");
await call(`/show/${code}/send`, { method: "POST", token: maya.token, body: { id: "f1", channel: "group", body: "Morning, everyone" } });
await call(`/show/${code}/send`, { method: "POST", token: maya.token, body: { id: "f2", channel: dmCh, body: "Can you watch my booth at 2?" } });
r = await call(`/show/${code}/group/create`, { method: "POST", token: maya.token, body: { id: "gfeat01", name: "Aisle A", members: [leo.id] } });
const gid = r.data.group.id;
await sleep(900);
assert(badge(L, "group") === 1 && badge(L, "dms") === 1 && badge(L, "groups") === 1, "each tab counts its own new messages (Show 1, DMs 1, Groups 1)");
assert(!text(L).includes("Morning, everyone") || $(L, "[data-tab='dms']").getAttribute("aria-selected") === "true", "the show chat stays out of the DMs list");
assert(!$$(L, ".convo").some((c) => c.textContent.includes("Morning, everyone")), "Show chat messages aren't in the DMs list");
click(L, "[data-tab='group']"); await sleep(300);
assert(text(L).includes("Morning, everyone") && badge(L, "group") === 0, "opening the Show tab clears its count");
assert(badge(L, "dms") === 1, "the DMs count stays until the DM is read");
click(L, "[data-tab='groups']"); await sleep(200);
assert(text(L).includes("Aisle A"), "the new group shows in Groups");
click(L, `[data-go='g:${gid}']`); await sleep(300);
assert(text(L).includes("Maya Lindqvist started Aisle A"), "group chat opens");
await go(L, "groups");
assert(badge(L, "groups") === 0, "opening the group clears the Groups count");

// ---- a DM, with typing dots ----
await go(L, `dm:${maya.id}`, 400);
assert(text(L).includes("Can you watch my booth at 2?"), "Leo reads Maya's DM");
await go(M, `dm:${leo.id}`, 400);
type(M, "#compose-input", "Sure, I'll");
await sleep(500);
assert($(L, ".msg.typing") && text(L).includes("Maya is typing") && $$(L, ".bubble.dots i").length === 3, "Leo sees Maya's three typing dots");
submit(M, "form.composer");
await sleep(700);
assert(!$(L, ".msg.typing") && text(L).includes("Sure, I'll"), "the dots go away when she sends");
const box = $(L, "#compose-input");
box.focus(); type(L, "#compose-input", "Half-typed reply");
await call(`/show/${code}/send`, { method: "POST", token: maya.token, body: { id: "f3", channel: dmCh, body: "Thanks!" } });
type(M, "#compose-input", "one more"); await sleep(700);
assert(text(L).includes("Thanks!") && text(L).includes("Maya is typing") && $(L, "#compose-input") === box && L.document.activeElement === box && box.value === "Half-typed reply", "new messages and dots arrive without taking away what you're typing, so the keyboard stays up");
type(M, "#compose-input", ""); type(L, "#compose-input", ""); await sleep(300);
await go(L, "group", 300);
type(L, "#compose-input", "typing in the show chat");
await sleep(500);
await go(M, "group", 300);
type(L, "#compose-input", "typing in the show chat.");
await sleep(500);
assert(text(M).includes("Leo is typing"), "typing dots show in the Show chat too");
type(L, "#compose-input", "");
await sleep(500);
assert(!$(M, ".msg.typing"), "clearing the box takes the dots away");

// ---- reactions: double-tap for a heart, hold or right-click for the rest ----
await go(L, `dm:${maya.id}`, 400);
const bubble = () => $$(L, ".msg:not(.me) .bubble").find((b) => b.textContent.includes("Can you watch my booth"));
fire(L, bubble(), "dblclick"); await sleep(600);
const pill = (w, txt) => $$(w, ".rxp").find((p) => p.closest(".msg") && p.closest(".msg").textContent.includes(txt));
assert(pill(L, "Can you watch my booth") && pill(L, "Can you watch my booth").textContent.includes("❤️") && pill(L, "Can you watch my booth").textContent.includes("1"), "double-tap adds a heart with a count");
await go(M, `dm:${leo.id}`, 500);
assert(pill(M, "Can you watch my booth") && pill(M, "Can you watch my booth").textContent.includes("❤️"), "Maya sees Leo's heart");
fire(L, bubble(), "contextmenu"); await sleep(100);
assert($(L, ".rxpick") && $$(L, ".rxpick [data-pick]").length === 7, "right-click (or press and hold) opens the picker with six reactions and Copy");
click(L, ".rxpick [data-pick='haha']"); await sleep(600);
assert(pill(L, "Can you watch my booth").textContent.includes("😂") && !$$(L, ".rxp").some((p) => p.textContent.includes("❤️")), "picking a laugh replaces the heart");
await sleep(300);
assert(pill(M, "Can you watch my booth") && pill(M, "Can you watch my booth").textContent.includes("😂"), "and Maya sees it change live");
click(L, pill(L, "Can you watch my booth")); await sleep(600);
assert(!pill(L, "Can you watch my booth"), "tapping your reaction again takes it off");
await sleep(300);
assert(!pill(M, "Can you watch my booth"), "for Maya too");

// ---- profiles ----
await go(L, "group", 400);
const av = $$(L, "[data-profile]").find((b) => b.dataset.profile === maya.id);
assert(av, "Maya's thumbnail in the Show chat can be tapped");
click(L, av); await sleep(300);
assert(text(L).includes("Wheel-thrown blue jars") && text(L).includes("Message Maya"), "it opens her profile with her bio");
await go(M, "me", 400);
$(M, "#me-private").checked = true;
submit(M, "#me-form"); await sleep(900);
await go(L, "group", 200); await go(L, `p:${maya.id}`, 400);
assert(text(L).includes("This profile is private.") && !text(L).includes("Wheel-thrown"), "a private profile shows only name and photo");
const D = browser(`/s/${code}#p:${maya.id}`, sess(dir));
await sleep(1200);
assert(text(D).includes("Wheel-thrown blue jars"), "the director still sees it");

// ---- a referral goes to the other artist's DMs ----
await go(L, "refer", 300);
click(L, `[data-to='${maya.id}']`); await sleep(100);
type(L, "#ref-note", "Wants a tall blue jar");
submit(L, "#refer-form"); await sleep(900);
assert(L.location.hash === `#dm:${maya.id}` && $(L, ".refcard") && text(L).includes("Wants a tall blue jar"), "the referral lands in Leo's DM with Maya");

// ---- making a group on the phone ----
await go(L, "newgroup", 300);
click(L, `[data-gpick='${maya.id}']`); await sleep(100);
click(L, `[data-gpick='${dir.id}']`); await sleep(100);
assert($(L, "#newgroup-form button.btn").textContent.includes("2 people"), "picking two people");
type(L, "#ng-name", "Dinner plans");
submit(L, "#newgroup-form"); await sleep(1200);
assert(L.location.hash.startsWith("#g:") && text(L).includes("Dinner plans") && text(L).includes("Leo Park started Dinner plans"), "Leo starts a group of 3 and lands in it");

// ---- the new-message pill when you've scrolled up ----
const sc = $(L, "#scroller");
sc.scrollTop = 0; sc.dispatchEvent(new L.Event("scroll")); await sleep(50);
const lgid = L.location.hash.slice(3);
await call(`/show/${code}/send`, { method: "POST", token: maya.token, body: { id: "f9", channel: "g:" + lgid, body: "Pasta at 8?" } });
await sleep(700);
assert($(L, ".newpill") && $(L, ".newpill").textContent.includes("New message"), "scrolled up: a New message pill shows instead of jumping");
click(L, ".newpill"); await sleep(200);
assert(!$(L, ".newpill") && $(L, "#scroller").scrollTop === 1500, "tapping it goes to the newest message");
await call(`/show/${code}/send`, { method: "POST", token: maya.token, body: { id: "f10", channel: "g:" + lgid, body: "Or tacos" } });
await sleep(700);
assert(!$(L, ".newpill") && $(L, "#scroller").scrollTop === 1500, "at the bottom, new messages just come into view");
await go(L, "dms", 300);
await call(`/show/${code}/send`, { method: "POST", token: maya.token, body: { id: "f11", channel: "g:" + lgid, body: "Tacos it is" } });
await sleep(700);
assert(!L.document.getElementById("toast").hidden && L.document.getElementById("toast").textContent.includes("Maya Lindqvist in Dinner plans"), "a message for another chat shows a notice you can tap");
click(L, "#toast"); await sleep(300);
assert(L.location.hash === "#g:" + lgid, "tapping the notice opens that chat");

// ---- the director's Show tab: one-way announcements, and announcements only ----
await go(D, "group", 300);
assert($(D, "[data-go='ann']") && !$(D, "[data-tab='buyers']"), "the director has an Announce button in the Show tab");
await call(`/show/${code}/show`, { method: "POST", token: dir.token, body: { artistsPost: false } });
await go(L, "dms", 200); await sleep(600); await go(L, "group", 400);
assert(text(L).includes("Only the show director posts here") && !$(L, "#compose-input"), "announcements-only Show tab has no message box for artists");
await call(`/show/${code}/show`, { method: "POST", token: dir.token, body: { artistsPost: true } });

// ---- light and dark ----
await go(L, "me", 300);
assert(!L.document.documentElement.dataset.theme, "follows the phone's setting by default");
click(L, "[data-theme-pick='dark']");
assert(L.document.documentElement.dataset.theme === "dark" && L.localStorage.getItem("asc.theme") === '"dark"', "Dark sticks on this phone");
click(L, "[data-theme-pick='light']");
assert(L.document.documentElement.dataset.theme === "light", "Light");
click(L, "[data-theme-pick='auto']");
assert(!L.document.documentElement.dataset.theme, "Auto goes back to the phone's setting");
const L2 = browser(`/s/${code}#group`, { ...sess(leo), "asc.theme": '"dark"' });
assert(L2.document.documentElement.dataset.theme === "dark", "a saved choice is used when the app opens");
const css = fs.readFileSync("public/style.css", "utf8");
assert(/prefers-color-scheme: dark/.test(css) && /:root\[data-theme="dark"\]/.test(css) && /:root:not\(\[data-theme="light"\]\)/.test(css), "dark colors for both the phone setting and the toggle");
assert(/data-theme/.test(fs.readFileSync("public/index.html", "utf8")), "the page picks the theme before it draws, so there's no flash");

// ---- buyer page: reactions and typing dots ----
r = await call(`/show/${code}/buyer/start`, { method: "POST", body: { id: "bq1", artist: maya.id, body: "Is the tall jar sold?", name: "Dana" } });
const btok = r.data.token, bid = r.data.buyer.id;
await call(`/show/${code}/send`, { method: "POST", token: maya.token, body: { id: "bq2", channel: "buy:" + bid, body: "Not yet, come by!" } });
const B = browser(`/b/${code}/${maya.id}`, { "asc.buyers": { [`${code}/${maya.id}`]: { token: btok } } });
await sleep(1500);
const reply = $$(B, ".msg:not(.me) .bubble").find((b) => b.textContent.includes("Not yet"));
fire(B, reply, "dblclick"); await sleep(700);
assert($$(B, ".rxp").some((p) => p.textContent.includes("❤️")), "a buyer can heart the artist's reply");
await go(M, "buy:" + bid, 700);
assert(pill(M, "Not yet, come by!") && pill(M, "Not yet, come by!").textContent.includes("❤️"), "the artist sees the buyer's heart");
type(M, "#compose-input", "It's 24 inches");
await sleep(600);
assert(text(B).includes("Maya is typing"), "the buyer sees the artist typing");

console.log("\nAll feature screen checks passed.");
process.exit(0);
