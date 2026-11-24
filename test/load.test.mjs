// Busy-fair check against a running local Worker (npx wrangler dev --port 8787):
// 6 artists online, 80 buyers messaging at once, resends after "dropped" replies, no lost or doubled messages.
const B = process.env.BASE || "http://127.0.0.1:8787";
const WS = B.replace(/^http/, "ws");
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok" : "FAIL"} - ${m}`); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function j(path, o = {}) {
  const t0 = Date.now();
  const r = await fetch(B + "/api" + path, { method: o.method || "GET", headers: { "content-type": "application/json", ...(o.t ? { authorization: "Bearer " + o.t } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null), ms: Date.now() - t0 };
}
// Like the app: retry on no connection, 429 or 5xx, with backoff.
async function send(path, o) {
  for (let i = 0; i < 8; i++) {
    const r = await j(path, o).catch(() => ({ status: 0 }));
    if (r.status && r.status < 429) return r;
    if (r.status >= 400 && r.status < 500 && r.status !== 429) return r;
    await sleep(200 * 2 ** i);
  }
  return { status: 0 };
}

const code = "L" + Math.random().toString(36).slice(2, 7).toUpperCase();
const c = await j("/create", { method: "POST", body: { name: "Load test", director: "Dir", code } });
const show = c.data.code;
const artists = [];
for (let i = 0; i < 6; i++) {
  const a = await j(`/show/${show}/join`, { method: "POST", body: { name: `Artist ${i}`, booth: `A${i}` } });
  const live = [];
  const ws = new WebSocket(`${WS}/api/show/${show}/ws?t=${encodeURIComponent(a.data.token)}`);
  ws.onmessage = (e) => { if (e.data !== "pong") try { const d = JSON.parse(e.data); if (d.t === "msg") live.push(d.m); } catch {} };
  await new Promise((r) => (ws.onopen = r));
  artists.push({ id: a.data.me.id, token: a.data.token, ws, live });
}
ok(artists.length === 6, "6 artists joined and online");

const N = 80, EXTRA = 3;
const times = [];
const t0 = Date.now();
const buyers = await Promise.all(Array.from({ length: N }, async (_, i) => {
  const a = artists[i % 6];
  const id = `start-${i}-${code}`;
  const r = await send(`/show/${show}/buyer/start`, { method: "POST", body: { id, artist: a.id, body: `Hello from buyer ${i}`, name: `Buyer ${i}`, phone: "3055550100" } });
  times.push(r.ms || 0);
  // The reply got "lost" on bad wifi, so the phone sends the same message again.
  const again = await send(`/show/${show}/buyer/start`, { method: "POST", body: { id, artist: a.id, body: `Hello from buyer ${i}` } });
  const out = { i, a, token: r.data && r.data.token, again: again.data && again.data.token, bid: r.data && r.data.buyer && r.data.buyer.id };
  await Promise.all(Array.from({ length: EXTRA }, (_, k) => send(`/show/${show}/buyer/send`, { method: "POST", t: out.token, body: { id: `m-${i}-${k}-${code}`, body: `Follow-up ${k}` } })));
  await send(`/show/${show}/buyer/send`, { method: "POST", t: out.token, body: { id: `m-${i}-0-${code}`, body: `Follow-up 0` } });
  return out;
}));
const took = Date.now() - t0;
ok(buyers.every((b) => b.token), `all ${N} buyers got through (${took} ms in total)`);
ok(buyers.every((b) => b.again === b.token), "a resent first message returns the same conversation, not a new one");
times.sort((x, y) => x - y);
ok(times[Math.floor(times.length * 0.95)] < 3000, `95% of first messages answered in ${times[Math.floor(times.length * 0.95)]} ms`);

await sleep(800);
let totalStored = 0, perfect = true;
for (const a of artists) {
  const s = await j(`/show/${show}/sync?since=0`, { t: a.token });
  const mine = buyers.filter((b) => b.a === a);
  const msgs = s.data.messages.filter((m) => m.ch.startsWith("buy:"));
  totalStored += msgs.length;
  if (msgs.length !== mine.length * (1 + EXTRA)) perfect = false;
  const ids = new Set(msgs.map((m) => m.id));
  if (ids.size !== msgs.length) perfect = false;
  if (s.data.buyers.length !== mine.length) perfect = false;
}
ok(perfect, `every message stored exactly once (${totalStored} of ${N * (1 + EXTRA)})`);
const liveTotal = artists.reduce((n, a) => n + a.live.filter((m) => m.ch.startsWith("buy:")).length, 0);
ok(liveTotal === N * (1 + EXTRA), `artists got every buyer message live (${liveTotal})`);

// Isolation: one buyer can't read another's conversation.
const other = await j(`/show/${show}/buyer/sync?since=0`, { t: buyers[0].token });
ok(other.data.messages.every((m) => m.ch === "buy:" + buyers[0].bid), "each buyer sees only their own conversation");

// A phone stuck in a resend loop is slowed down, not allowed to swamp the show.
const flood = await Promise.all(Array.from({ length: 50 }, (_, k) => j(`/show/${show}/buyer/send`, { method: "POST", t: buyers[1].token, body: { id: `f-${k}-${code}`, body: "spam" } })));
ok(flood.some((r) => r.status === 429) && flood.filter((r) => r.status === 200).length <= 40, "a flood from one phone gets slowed down");
const fine = await j(`/show/${show}/buyer/send`, { method: "POST", t: buyers[2].token, body: { id: `ok-${code}`, body: "still fine" } });
ok(fine.status === 200, "other buyers are unaffected by the flood");

for (const a of artists) a.ws.close();
console.log(fails ? `\n${fails} load check(s) failed.` : "\nAll load checks passed.");
process.exit(fails ? 1 : 0);
