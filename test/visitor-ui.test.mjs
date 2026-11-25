// Screen checks for the visitor app (jsdom), against a running server: npx wrangler dev --port 8787
import { JSDOM } from "jsdom";
import fs from "node:fs";
const BASE = process.env.BASE || "http://127.0.0.1:8787";
const html = fs.readFileSync("public/index.html", "utf8").replace(/<script[^>]*><\/script>/g, "");
const appJs = fs.readFileSync("public/app.js", "utf8");
const qrJs = fs.readFileSync("public/vendor/qrcode.js", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok" : "FAIL"} - ${m}`); if (!c) fails++; };
function browser(path, storage = {}) {
  const dom = new JSDOM(html, { url: BASE + path, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  w.__net = true;
  w.fetch = (u, o) => (w.__net || String(u).startsWith("data:") ? fetch(String(u).startsWith("data:") ? u : new URL(u, BASE), o) : Promise.reject(new TypeError("offline")));
  w.WebSocket = WebSocket;
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.confirm = () => true;
  Object.defineProperty(w, "crypto", { value: globalThis.crypto });
  w.HTMLFormElement.prototype.requestSubmit = function () { this.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); };
  w.eval(qrJs + "\nwindow.qrcode = qrcode;");
  w.eval(appJs);
  return w;
}
const submit = (w, sel) => w.document.querySelector(sel).dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
const click = (w, sel) => { const el = w.document.querySelector(sel); if (!el) throw new Error("no " + sel); el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); };
const text = (w) => w.document.getElementById("app").textContent;
async function j(path, o = {}) {
  const r = await fetch(BASE + "/api" + path, { method: o.method || "GET", headers: { "content-type": "application/json", ...(o.t ? { authorization: "Bearer " + o.t } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const upload = async (show, t) => (await (await fetch(`${BASE}/api/show/${show}/upload`, { method: "POST", headers: { "content-type": "image/jpeg", authorization: "Bearer " + t }, body: JPEG })).json()).id;

const code = "W" + Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, "Q");
const dir = (await j("/create", { method: "POST", body: { name: "Red Dot Miami", director: "Isaac", code, venue: "Mana Wynwood", dates: "Dec 2–7" } })).data;
const maya = (await j(`/show/${code}/join`, { method: "POST", body: { name: "Maya Lin", booth: "B12", medium: "Ceramics" } })).data;
const img = await upload(code, maya.token);
await j(`/show/${code}/gallery`, { method: "POST", t: maya.token, body: { pieces: [{ id: "pvase00001", img, title: "Tall blue vase", price: "$1,800" }] } });

// Visitor scans the show QR
let v = browser(`/v/${code}`); await sleep(900);
ok(text(v).includes("Red Dot Miami") && text(v).includes("Go to a booth") && text(v).includes("Maya Lin"), "show QR opens the visitor app with booth entry and the booth list");
v.document.getElementById("v-b").value = "b 12";
submit(v, "#v-booth"); await sleep(900);
ok(text(v).includes("Tall blue vase") && text(v).includes("$1,800") && text(v).includes("Message Maya"), "typing a booth number opens that artist's pieces");
click(v, "[data-fav-piece]"); await sleep(700);
ok(v.document.querySelector("[data-fav-piece]").classList.contains("on") && v.document.querySelector(".favbtn").textContent.trim() === "1", "a heart saves the piece and the favorites count goes up");
const vstore = JSON.parse(v.localStorage.getItem("asc.v." + code));
ok(vstore.token && vstore.favs.length === 1 && !vstore.ops.length, "the favorite is saved on the phone and on Show Chat");

// Unclaimed booth, with no signal at first
v.__net = false;
v.location.hash = "b=F7"; await sleep(500);
v.__net = true;
v.dispatchEvent(new v.Event("hashchange")); await sleep(900);
ok(text(v).includes("isn't on Show Chat yet"), "a booth with no artist says so and still lets you save it");
v.__net = false;
click(v, "[data-fav-booth]"); await sleep(400);
ok(v.document.querySelector(".favbtn").textContent.trim() === "2", "with no signal, the booth heart shows at once");
v.__net = true;
v.dispatchEvent(new v.Event("online")); await sleep(1500);
const me = (await j(`/show/${code}/visitor/me`, { t: vstore.token })).data;
ok(me.favs.length === 2 && me.favs.some((f) => f.k === "b:F7"), "the queued heart reaches Show Chat when signal returns");

// Favorites and recap
v.location.hash = "saved"; v.dispatchEvent(new v.Event("hashchange")); await sleep(500);
ok(text(v).includes("Your favorites") && text(v).includes("Tall blue vase") && text(v).includes("Booth F7") && text(v).includes("Get your favorites after the fair"), "favorites list groups by booth and offers the recap");
v.location.hash = "me"; v.dispatchEvent(new v.Event("hashchange")); await sleep(300);
v.document.getElementById("vm-email").value = "pat@example.com";
v.document.getElementById("vm-artists").checked = true;
submit(v, "#v-me"); await sleep(800);
const me2 = (await j(`/show/${code}/visitor/me`, { t: vstore.token })).data.visitor;
ok(me2.email === "pat@example.com" && me2.recap && me2.shareArtists && !me2.shareShow, "recap email saved with only the boxes the visitor ticked");

// Artist QR page: heart there too, and it shares the same favorites
let b = browser(`/b/${code}/${maya.me.id}`, { ["asc.v." + code]: v.localStorage.getItem("asc.v." + code) }); await sleep(1200);
ok(b.document.querySelector("[data-bfav]") && b.document.querySelector("[data-bfav]").classList.contains("on"), "the booth's QR page shows the piece already hearted");
ok(b.document.getElementById("b-email").value === "pat@example.com", "the message form is filled with the visitor's email");
let piece = browser(`/b/${code}/${maya.me.id}?from=v&piece=pvase00001`); await sleep(1200);
ok(piece.document.querySelector(".pchip") && piece.document.querySelector(".pchip").textContent.includes("Tall blue vase"), "Ask about this opens the chat with the piece picked");

// Artist sees it
const aStore = JSON.stringify({ [code]: { token: maya.token, id: maya.me.id, name: "Maya Lin", role: "artist", showName: "Red Dot Miami" } });
let a = browser(`/s/${code}#insights`, { "asc.sessions": aStore }); await sleep(1500);
ok(text(a).includes("saved your work") && text(a).includes("Tall blue vase") && text(a).includes("pat@example.com".split("@")[0]) === false, "artist's visitor favorites screen loads");
ok(a.document.querySelectorAll(".lead").length === 1 && a.document.querySelector(".lead a[href^='mailto:']"), "the lead who said yes shows with an Email button");

// Director sees totals
const dStore = JSON.stringify({ [code]: { token: dir.token, id: dir.me.id, name: "Isaac", role: "director", showName: "Red Dot Miami" } });
let d = browser(`/s/${code}#visitors`, { "asc.sessions": dStore }); await sleep(1500);
ok(text(d).includes("visitors in the app") && text(d).includes("Unclaimed booths") && text(d).includes("F7"), "director's Visitors tab shows totals and the unclaimed booth");
ok(text(d).includes("Recap emails are off until email is set up"), "the recap is shown as off");
ok(!text(d).includes("$1,800") && !text(d).includes("pat@example.com"), "the director sees no prices and no contact the visitor didn't share with the show");
let cc = browser(`/s/${code}/cards?claim=F7`, { "asc.sessions": dStore }); await sleep(1200);
ok(cc.document.querySelectorAll(".qrcard svg").length === 1 && text(cc).includes("1 visitor saved your work") && text(cc).includes("Scan to claim your booth"), "claim card shows how many visitors saved the booth");
let vc = browser(`/s/${code}/cards?visitor=1`, { "asc.sessions": dStore }); await sleep(1000);
ok(vc.document.querySelectorAll(".qrcard svg").length === 4 && text(vc).includes("Save your favorites"), "visitor QR prints four to a page");

// Claim: the artist at F7 joins from the card
let f = browser(`/s/${code}?booth=F7`); await sleep(1200);
ok(text(f).includes("Claim your booth") && f.document.getElementById("booth").value === "F7" && text(f).includes("1 visitor saved Booth F7"), "the claim link fills the booth and shows the nudge");

console.log(fails ? `\n${fails} FAILED` : "\nAll visitor screen checks passed.");
process.exit(fails ? 1 : 0);
