// Headless smoke test of the phone app's screens (jsdom), against a running server.
import { JSDOM } from "jsdom";
import fs from "node:fs";
const BASE = process.env.BASE || "http://127.0.0.1:8787";
const html = fs.readFileSync("public/index.html", "utf8").replace(/<script[^>]*><\/script>/g, "");
const appJs = fs.readFileSync("public/app.js", "utf8");
const qrJs = fs.readFileSync("public/vendor/qrcode.js", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } else console.log("ok -", m); };

function browser(path, storage = {}) {
  const dom = new JSDOM(html, { url: BASE + path, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  w.__net = true; // set false to act like a phone with no signal
  w.fetch = (u, o) => (w.__net || String(u).startsWith("data:") ? fetch(String(u).startsWith("data:") ? u : new URL(u, BASE), o) : Promise.reject(new TypeError("offline")));
  w.WebSocket = WebSocket;
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  Object.defineProperty(w, "crypto", { value: globalThis.crypto });
  w.HTMLFormElement.prototype.requestSubmit = function () { this.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); };
  w.eval(qrJs + "\nwindow.qrcode = qrcode;");
  w.eval(appJs);
  return w;
}
const submit = (w, sel) => w.document.querySelector(sel).dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
const click = (w, sel) => w.document.querySelector(sel).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
const text = (w) => w.document.getElementById("app").textContent;

// Director starts a show
const code = "U" + Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, "B");
let d = browser("/new");
d.document.getElementById("name").value = "Red Dot Miami";
d.document.getElementById("director").value = "Isaac";
d.document.getElementById("code").value = code;
submit(d, "#f"); await sleep(600);
const dirStore = d.localStorage.getItem("asc.sessions");
assert(JSON.parse(dirStore)[code].role === "director", "director's phone is signed in");

// Artist joins from the invite link
let a = browser(`/s/${code}`); await sleep(500);
assert(text(a).includes("Join Red Dot Miami"), "join screen shows the show");
a.document.getElementById("name").value = "Maya Lindqvist";
a.document.getElementById("booth").value = "A14";
a.document.getElementById("ig").value = "@maya.makes";
submit(a, "#f"); await sleep(900);
const artStore = a.localStorage.getItem("asc.sessions");
const maya = JSON.parse(artStore)[code];
assert(maya && maya.token, "artist signed in");

// Artist opens the chat and posts
a = browser(`/s/${code}#group`, { "asc.sessions": artStore }); await sleep(900);
const tabNames = [...a.document.querySelectorAll("[data-tab]")].map((t) => t.textContent.trim());
assert(JSON.stringify(tabNames) === JSON.stringify(["Show", "DMs", "Groups", "Buyers"]), "artist sees Show, DMs, Groups and Buyers tabs");
a.document.getElementById("compose-input").value = "Hello from booth A14";
submit(a, "form.composer"); await sleep(700);
assert(text(a).includes("Hello from booth A14") && !text(a).includes("Sending"), "message sent and shown");

// No signal: the message waits on the phone, survives closing the app, and sends once signal is back
a.__net = false;
a.document.getElementById("compose-input").value = "Sent with no signal";
submit(a, "form.composer"); await sleep(600);
const queued = JSON.parse(a.localStorage.getItem(`asc.outbox.${code}`) || "[]");
assert(queued.length === 1 && text(a).includes("Sent with no signal"), "message is kept on the phone with no signal");
const offStore = { "asc.sessions": artStore, [`asc.outbox.${code}`]: a.localStorage.getItem(`asc.outbox.${code}`) };
const oldA = a; // the old copy stays without signal
a = browser(`/s/${code}#group`, offStore); await sleep(1500);
assert(JSON.parse(a.localStorage.getItem(`asc.outbox.${code}`) || "[]").length === 0, "queued message sent after reopening with signal");
a.dispatchEvent(new a.Event("online")); await sleep(300);

// Director sees it, sends an urgent announcement
d = browser(`/s/${code}#group`, { "asc.sessions": dirStore }); await sleep(900);
assert(text(d).includes("Hello from booth A14"), "director sees the artist's message");
d.location.hash = "#ann"; await sleep(200);
assert(text(d).includes("Send to all 1 exhibitor"), "announce tab for director");
d.document.getElementById("ann-msg").value = "Doors open at 11";
submit(d, "#ann-form"); await sleep(700);
assert(text(d).includes("Doors open at 11") && text(d).includes("Reached"), "announcement posted with delivery count");

await sleep(600);
assert(text(a).includes("Doors open at 11") && a.document.querySelector(".pinned"), "artist gets the pinned announcement live");

// Buyer scans Maya's QR
let b = browser(`/b/${code}/${maya.id}`); await sleep(700);
assert(text(b).includes("Maya Lindqvist") && text(b).includes("Message @maya.makes on Instagram"), "buyer page with Instagram button");
const labels = [...b.document.querySelectorAll("#start label")].map((l) => l.textContent);
assert(labels.findIndex((l) => /phone/i.test(l)) < labels.findIndex((l) => /email/i.test(l)), "phone is asked before email");
b.document.getElementById("b-msg").value = "Is the blue jar available?";
b.document.getElementById("b-phone").value = "305 555 0100";
submit(b, "#start"); await sleep(1000);
assert(text(b).includes("Is the blue jar available?") && b.document.getElementById("b-compose"), "buyer conversation opens");
await sleep(500);
a.location.hash = "#buyers"; await sleep(300);
assert(text(a).includes("Is the blue jar available?"), "artist sees the buyer in Buyers");
click(a, "[data-go^='buy:']"); await sleep(300);
assert(text(a).includes("Text 305 555 0100"), "artist sees buyer's phone");
a.document.getElementById("compose-input").value = "Yes, come by A14!";
submit(a, "form.composer"); await sleep(800);
const textLink = a.document.querySelector(".followup a[href^='sms:']");
assert(textLink && decodeURIComponent(textLink.href).includes("Keep chatting here:"), "Text it button carries the reply and a link back");
await sleep(400);
assert(text(b).includes("Yes, come by A14!"), "buyer sees the reply live");

// Cards
let c = browser(`/s/${code}/cards`, { "asc.sessions": dirStore }); await sleep(800);
assert(c.document.querySelectorAll(".qrcard svg").length === 2 && text(c).includes("Booth A14"), "director prints artist card plus join card");
console.log("\nAll UI checks passed.");
process.exit(0);
