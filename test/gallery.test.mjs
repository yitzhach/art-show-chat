// Booth and piece photos: the artist's catalog, the buyer page, and asking about a piece.
// Run against a local Worker: npx wrangler dev --port 8787, then node test/gallery.test.mjs
import { JSDOM } from "jsdom";
import fs from "node:fs";
const BASE = process.env.BASE || "http://127.0.0.1:8787";
const WS = BASE.replace(/^http/, "ws");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok" : "FAIL"} - ${m}`); if (!c) fails++; };
async function j(path, o = {}) {
  const r = await fetch(BASE + "/api" + path, { method: o.method || "GET", headers: { "content-type": "application/json", ...(o.t ? { authorization: "Bearer " + o.t } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
async function upload(show, t) {
  const r = await fetch(`${BASE}/api/show/${show}/upload`, { method: "POST", headers: { "content-type": "image/jpeg", authorization: "Bearer " + t }, body: JPEG });
  return (await r.json()).id;
}

const code = "G" + Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, "Q");
const c = await j("/create", { method: "POST", body: { name: "Red Dot Test", director: "Dir", code } });
const show = c.data.code;
const maya = (await j(`/show/${show}/join`, { method: "POST", body: { name: "Maya Lin", booth: "B12" } })).data;
const omar = (await j(`/show/${show}/join`, { method: "POST", body: { name: "Omar Ruiz", booth: "C3" } })).data;

const [b1, b1t, p1, p1t, p2] = await Promise.all([1, 2, 3, 4, 5].map(() => upload(show, maya.token)));
const omarImg = await upload(show, omar.token);
const save = await j(`/show/${show}/gallery`, { method: "POST", t: maya.token, body: {
  booth: [{ img: b1, thumb: b1t }, { img: omarImg }],
  pieces: [
    { id: "pbluevase01", img: p1, thumb: p1t, title: "Tall blue vase", price: "$1,800", note: "18 in", sold: false },
    { id: "pnotmine01", img: omarImg, title: "Someone else's" },
    { id: "pbowl00001", img: p2, title: "Ash bowl", sold: true },
  ],
} });
ok(save.status === 200, "artist saves booth shots and pieces");
ok(save.data.gallery.booth.length === 1 && save.data.gallery.booth[0].thumb === b1t, "booth shots keep their thumbnails, and another artist's photo is refused");
ok(save.data.gallery.pieces.length === 2 && save.data.gallery.pieces[1].sold === true, "pieces saved with sold marks, another artist's photo refused");

const many = await j(`/show/${show}/gallery`, { method: "POST", t: omar.token, body: { pieces: Array.from({ length: 55 }, (_, i) => ({ id: "pmany" + i, img: omarImg, title: "x" + i })) } });
ok(many.data.gallery.pieces.length === 40, "at most 40 pieces per artist");
const anon = await j(`/show/${show}/gallery`, { method: "POST", body: { booth: [] } });
ok(anon.status === 401 || anon.status === 403, "saving a gallery needs the artist's sign-in");

const info = await j(`/show/${show}/artist?id=${maya.me.id}`);
ok(info.data.gallery && info.data.gallery.pieces[0].title === "Tall blue vase", "the QR page gets the artist's booth and pieces");

const start = await j(`/show/${show}/buyer/start`, { method: "POST", body: { id: "s1" + code, artist: maya.me.id, body: "Is it still available?", name: "Pat", pieceId: "pbluevase01" } });
const m1 = start.data.message;
ok(m1.meta && m1.meta.piece === "Tall blue vase" && m1.meta.pimg === p1t && m1.meta.pieceId === "pbluevase01", "a buyer's first message carries the piece they tapped");
const bt = start.data.token;
const bws = new WebSocket(`${WS}/api/show/${show}/ws?t=${encodeURIComponent(bt)}`);
const live = [];
bws.onmessage = (e) => { if (e.data !== "pong") try { live.push(JSON.parse(e.data)); } catch {} };
await new Promise((r) => (bws.onopen = r));
const s2 = await j(`/show/${show}/buyer/send`, { method: "POST", t: bt, body: { id: "s2" + code, body: "And the bowl?", pieceId: "pbowl00001" } });
ok(s2.data.message.meta.piece === "Ash bowl", "a follow-up can ask about another piece");
const s3 = await j(`/show/${show}/buyer/send`, { method: "POST", t: bt, body: { id: "s3" + code, body: "Thanks", pieceId: "pmany1" } });
ok(!s3.data.message.meta, "a piece from another artist's catalog isn't attached");
const sync = await j(`/show/${show}/sync?since=0`, { t: maya.token });
ok(sync.data.messages.filter((m) => m.meta && m.meta.pimg).length === 2, "the artist sees which piece each message is about");
ok(sync.data.gallery.booth.length === 1, "the artist's app gets its own gallery back");

await j(`/show/${show}/gallery`, { method: "POST", t: maya.token, body: { ...save.data.gallery, pieces: save.data.gallery.pieces.map((x) => (x.id === "pbluevase01" ? { ...x, sold: true } : x)) } });
await sleep(300);
const g = live.find((x) => x.t === "gallery");
ok(g && g.g.pieces[0].sold === true, "a buyer with the page open sees the update (sold) right away");
bws.close();

// ---- the screens (jsdom) ----
const html = fs.readFileSync("public/index.html", "utf8").replace(/<script[^>]*><\/script>/g, "");
const appJs = fs.readFileSync("public/app.js", "utf8");
const qrJs = fs.readFileSync("public/vendor/qrcode.js", "utf8");
function browser(path, storage = {}) {
  const dom = new JSDOM(html, { url: BASE + path, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  w.fetch = (u, o) => fetch(String(u).startsWith("data:") ? u : new URL(u, BASE), o);
  w.WebSocket = WebSocket;
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.confirm = () => true;
  Object.defineProperty(w, "crypto", { value: globalThis.crypto });
  w.eval(qrJs + "\nwindow.qrcode = qrcode;");
  w.eval(appJs);
  return w;
}
const text = (w) => w.document.getElementById("app").textContent;
const click = (w, el) => (typeof el === "string" ? w.document.querySelector(el) : el).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
const sessions = JSON.stringify({ [show]: { token: maya.token, id: maya.me.id, name: "Maya Lin", role: "artist", showName: "Red Dot Test" } });

// Artist edits a piece's title on the Booth and pieces screen; it saves by itself.
let a = browser(`/s/${show}#buyers`, { "asc.sessions": sessions }); await sleep(900);
ok(text(a).includes("Booth and pieces") && text(a).includes("1 booth photo and 2 pieces"), "Buyers tab shows the booth and pieces summary");
click(a, ".galrow"); await sleep(300);
const title = a.document.querySelector('[data-pf="title"]');
ok(title && title.value === "Tall blue vase" && a.document.querySelectorAll(".pieceedit").length === 2, "editor lists the pieces");
title.value = "Tall cobalt vase";
title.dispatchEvent(new a.Event("input", { bubbles: true }));
await sleep(1600);
ok(/Saved/.test(a.document.getElementById("gal-state").textContent), "editor says it saved");
const after = await j(`/show/${show}/artist?id=${maya.me.id}`);
ok(after.data.gallery.pieces[0].title === "Tall cobalt vase", "the new title reached the server");
click(a, '[data-act="gal-del-shot"]'); await sleep(900);
ok((await j(`/show/${show}/artist?id=${maya.me.id}`)).data.gallery.booth.length === 0, "removing a booth shot saves");
await j(`/show/${show}/gallery`, { method: "POST", t: maya.token, body: { ...after.data.gallery } });

// A new buyer scans the card, sees the booth and pieces, taps one and asks about it.
let b = browser(`/b/${show}/${maya.me.id}`); await sleep(900);
ok(b.document.querySelectorAll(".bshot").length === 1 && b.document.querySelectorAll(".pcard").length === 2, "buyer sees the booth shot and the pieces before writing");
ok(text(b).includes("Sold"), "a sold piece is marked sold");
click(b, '[data-piece="pbluevase01"]'); await sleep(200);
ok(b.document.querySelector(".pchip") && text(b).includes("About Tall cobalt vase"), "tapping Ask about this attaches the piece");
b.document.getElementById("b-msg").value = "Does it come in green?";
b.document.getElementById("start").dispatchEvent(new b.Event("submit", { bubbles: true, cancelable: true }));
await sleep(1200);
ok(b.document.querySelector(".msg.me .pref") && text(b).includes("Does it come in green?"), "the sent message shows the piece with its photo");
ok(b.document.querySelectorAll(".pstrip .pcard").length === 2, "the pieces stay at the top of the chat");
ok(!b.document.querySelector(".chipwrap"), "the piece is cleared after sending");
click(b, '[data-piece="pbowl00001"]'); await sleep(200);
ok(b.document.querySelector(".chipwrap .pchip"), "in the chat a piece can be attached to the next message");

await sleep(400);
a.location.hash = "#buyers"; await sleep(300);
const row = [...a.document.querySelectorAll("[data-go^='buy:']")].find((x) => x.textContent.includes("Does it come in green"));
click(a, row); await sleep(300);
ok(a.document.querySelector(".msg .pref") && text(a).includes("About Tall cobalt vase"), "artist sees which piece the buyer asked about");

console.log(fails ? `\n${fails} gallery check(s) failed.` : "\nAll gallery checks passed.");
process.exit(fails ? 1 : 0);
