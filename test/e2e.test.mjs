// End-to-end check against a running server (npm run dev): director, two artists, a buyer.
const BASE = process.env.BASE || "http://127.0.0.1:8787";
const call = async (path, { method = "GET", body, token } = {}) => {
  const r = await fetch(BASE + "/api" + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
};
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } else console.log("ok -", m); };

const code = "T" + Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, "A");
let r = await call("/create", { method: "POST", body: { name: "Red Dot Test", venue: "Hall B", director: "Isaac", code } });
assert(r.status === 200 && r.data.code === code, "director creates show " + code);
const dir = r.data.token;
r = await call("/create", { method: "POST", body: { name: "Dup", director: "X", code } });
assert(r.status === 409, "duplicate code refused");
r = await call(`/show/${code}/info`);
assert(r.data.show.name === "Red Dot Test", "public show info");
r = await call(`/show/${code}/join`, { method: "POST", body: { name: "Maya Lindqvist", booth: "A14", medium: "Ceramics", instagram: "https://instagram.com/maya.makes/" } });
const maya = r.data; assert(maya.token && maya.me.instagram === "maya.makes", "artist joins, instagram cleaned");
r = await call(`/show/${code}/join`, { method: "POST", body: { name: "Leo Park", booth: "B2" } });
const leo = r.data; assert(leo.token, "second artist joins");

// live socket for Maya
const ws = new WebSocket(BASE.replace("http", "ws") + `/api/show/${code}/ws?t=${maya.token}`);
const live = [];
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = (e) => { if (e.data !== "pong") live.push(JSON.parse(e.data)); };
ws.send("ping");

r = await call(`/show/${code}/send`, { method: "POST", token: leo.token, body: { id: "c1", channel: "group", body: "Hi all, coffee at Booth B2" } });
assert(r.status === 200 && r.data.message.seq > 0, "group message");
const again = await call(`/show/${code}/send`, { method: "POST", token: leo.token, body: { id: "c1", channel: "group", body: "Hi all, coffee at Booth B2" } });
assert(again.data.message.seq === r.data.message.seq, "resend is deduplicated (bad-signal retry)");
const dm = "dm:" + [maya.me.id, leo.me.id].sort().join(":");
r = await call(`/show/${code}/send`, { method: "POST", token: leo.token, body: { id: "c2", channel: dm, body: "Can you watch my booth 5 min?" } });
assert(r.status === 200, "direct message");
r = await call(`/show/${code}/send`, { method: "POST", token: leo.token, body: { id: "c3", channel: "group", kind: "ref", body: "Wants a blue vase, ~$300", meta: { to: maya.me.id, status: "Walking over now" } } });
assert(r.status === 200 && r.data.message.kind === "ref", "buyer referral");
r = await call(`/show/${code}/send`, { method: "POST", token: leo.token, body: { channel: "ann", body: "nope" } });
assert(r.status === 403, "artists can't post announcements");
r = await call(`/show/${code}/send`, { method: "POST", token: dir, body: { id: "c4", channel: "ann", body: "Load-out 5pm Sunday", meta: { urgent: true } } });
assert(r.status === 200 && r.data.message.meta.urgent, "director urgent announcement");
const fake = "dm:" + [leo.me.id, "mzzzzzzzz"].sort().join(":");
r = await call(`/show/${code}/send`, { method: "POST", token: maya.token, body: { channel: fake, body: "x" } });
assert(r.status === 403, "can't post in someone else's DM");

// buyer from the QR page
r = await call(`/show/${code}/artist?id=${maya.me.id}`);
assert(r.data.artist.name === "Maya Lindqvist" && r.data.artist.instagram === "maya.makes", "QR page loads artist");
r = await call(`/show/${code}/buyer/start`, { method: "POST", body: { id: "b1", artist: maya.me.id, body: "Is the blue moon jar available?", name: "Dana", phone: "305 555 0100" } });
const buyer = r.data; assert(buyer.token && buyer.buyer.phone, "buyer sends first message, no account");
r = await call(`/show/${code}/buyer/start`, { method: "POST", body: { id: "b1", artist: maya.me.id, body: "Is the blue moon jar available?" } });
assert(r.data.token === buyer.token, "buyer resend returns the same conversation");

r = await call(`/show/${code}/sync?since=0`, { token: maya.token });
const s = r.data;
assert(s.members.length === 3, "Maya sees 3 members");
assert(s.buyers.length === 1 && s.buyers[0].key === buyer.token, "Maya sees her buyer with a reply link");
const chans = new Set(s.messages.map((m) => m.ch));
assert(chans.has(dm) && chans.has("buy:" + buyer.buyer.id) && chans.has("ann"), "Maya's sync has DM, buyer chat, announcement");
r = await call(`/show/${code}/sync?since=0`, { token: leo.token });
assert(!r.data.messages.some((m) => m.ch.startsWith("buy:")), "Leo can't see Maya's buyers");
r = await call(`/show/${code}/send`, { method: "POST", token: leo.token, body: { channel: "buy:" + buyer.buyer.id, body: "hijack" } });
assert(r.status === 403, "other artists can't reply to Maya's buyer");

r = await call(`/show/${code}/send`, { method: "POST", token: maya.token, body: { id: "c5", channel: "buy:" + buyer.buyer.id, body: "Yes! Come by Booth A14" } });
assert(r.status === 200, "artist replies to buyer");
r = await call(`/show/${code}/buyer/sync?since=0`, { token: buyer.token });
assert(r.data.messages.length === 2 && r.data.messages[1].body.startsWith("Yes"), "buyer sees the reply and full history");
r = await call(`/show/${code}/buyer/send`, { method: "POST", token: buyer.token, body: { id: "b2", body: "Great, on my way" } });
assert(r.status === 200, "buyer continues the conversation");
r = await call(`/show/${code}/sync?since=0`, { token: buyer.token });
assert(r.status === 404 || r.status === 403, "buyer can't read the show chat");

r = await call(`/show/${code}/sync?since=0`, { token: dir });
assert(r.data.ann.delivered[Object.keys(r.data.ann.delivered)[0]] >= 1, "announcement delivery count");
r = await call(`/show/${code}/member/link`, { method: "POST", token: dir, body: { id: leo.me.id } });
assert(r.data.token, "director makes a new sign-in link");
const old = await call(`/show/${code}/sync?since=0`, { token: leo.token });
assert(old.status === 401, "old sign-in stops working");
r = await call(`/show/${code}/sync?since=0`, { token: r.data.token });
assert(r.status === 200 && r.data.me.name === "Leo Park", "new link signs in as the same artist");

await new Promise((res) => setTimeout(res, 300));
assert(live.some((x) => x.t === "msg" && x.m.kind === "ref"), "Maya got the referral live over the socket");
assert(live.some((x) => x.t === "msg" && x.m.ch.startsWith("buy:")), "Maya got the buyer message live");
ws.close();
r = await call(`/show/${code}/push/key`);
assert(r.data.key && r.data.key.length > 80, "push key available");
const html = await fetch(BASE + `/b/${code}/${maya.me.id}`).then((x) => x.text());
assert(html.includes("app.js"), "QR link serves the app");
console.log("\nAll end-to-end checks passed.");
