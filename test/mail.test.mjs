// Email checks: starts a fake Resend server and a local Worker pointed at it.
// Run: node test/mail.test.mjs
import http from "node:http";
import { spawn } from "node:child_process";

const MOCK = 8799;
let PORT = 8788, B = `http://127.0.0.1:${PORT}`;
const sent = [];
const mock = http.createServer((req, res) => {
  let d = "";
  req.on("data", (c) => (d += c));
  req.on("end", () => { try { sent.push({ auth: req.headers.authorization, ...JSON.parse(d) }); } catch {} res.writeHead(200, { "content-type": "application/json" }); res.end('{"id":"x"}'); });
}).listen(MOCK, "127.0.0.1");

function startWorker(vars) {
  const args = ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", `/tmp/asc-mail-${Date.now()}`];
  for (const [k, v] of Object.entries(vars)) args.push("--var", `${k}:${v}`);
  const p = spawn("npx", args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("worker did not start")), 60000);
    const on = (b) => { if (/Ready on/.test(String(b))) { clearTimeout(t); resolve(p); } };
    p.stdout.on("data", on); p.stderr.on("data", on);
  });
}
const j = async (path, o = {}) => {
  const r = await fetch(B + path, { method: o.method || "GET", headers: { "content-type": "application/json", ...(o.t ? { authorization: "Bearer " + o.t } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok" : "FAIL"} - ${m}`); if (!c) fails++; };
const find = (fn) => sent.find(fn);

async function scenario(vars, label, check) {
  sent.length = 0;
  PORT += 1; B = `http://127.0.0.1:${PORT}`;
  const w = await startWorker({ RESEND_API_KEY: "re_test", RESEND_API_URL: `http://127.0.0.1:${MOCK}/emails`, ...vars });
  try {
    const code = "M" + Math.random().toString(36).slice(2, 7).toUpperCase();
    const c = await j("/api/create", { method: "POST", body: { name: "Red Dot Test", director: "Dir", code } });
    const show = c.data.code;
    const a = await j(`/api/show/${show}/join`, { method: "POST", body: { name: "Maya Lin", booth: "B12" } });
    await j(`/api/show/${show}/me`, { method: "POST", t: a.data.token, body: { name: "Maya Lin", booth: "B12", email: "maya@example.com", phone: "3055550111" } });
    const info = await j(`/api/show/${show}/info`);
    const s = await j(`/api/show/${show}/buyer/start`, { method: "POST", body: { id: "s1" + code, artist: a.data.me.id, body: "Is the blue vase available?", name: "Pat", phone: "(305) 555-0100", email: "pat@example.com" } });
    await wait(600);
    const afterStart = sent.slice();
    await j(`/api/show/${show}/send`, { method: "POST", t: a.data.token, body: { id: "r1" + code, channel: "buy:" + s.data.buyer.id, body: "Yes it is!" } });
    await wait(600);
    const afterReply = sent.slice();
    await j(`/api/show/${show}/buyer/move`, { method: "POST", t: s.data.token, body: { id: "mv" + code, to: "text", all: true } });
    await wait(600);
    await check({ info: info.data, afterStart, afterReply, all: sent.slice() });
  } finally {
    try { process.kill(-w.pid); } catch { w.kill(); }
    await wait(800);
  }
}

await scenario({ OWNER_EMAIL: "owner@example.com" }, "owner only", async ({ info, afterStart, afterReply, all }) => {
  ok(info.show.mail === false, "owner-only setup doesn't email buyers");
  ok(afterStart.length === 1 && afterStart[0].to[0] === "owner@example.com", "owner gets the first buyer message");
  ok(afterStart[0].from.includes("onboarding@resend.dev"), "owner mail uses the Resend test sender");
  ok(/Pat messaged Maya Lin/.test(afterStart[0].text) && /Is the blue vase/.test(afterStart[0].text), "owner mail names buyer, artist and message");
  ok(afterStart[0].reply_to === "pat@example.com", "replying to the owner mail goes to the buyer");
  ok(/sms:3055550100/.test(afterStart[0].html), "owner mail has a Text button with the buyer's number");
  ok(afterReply.length === 1, "artist reply sends no email in owner-only mode");
  const mv = all.find((m) => /wants a text/.test(m.subject));
  ok(!!mv && /asked Maya Lin \(Booth B12\) to text them at \(305\) 555-0100/.test(mv.text), "text-me request emails the owner");
  ok(!!mv && /Yes it is!/.test(mv.text), "text-me email carries the whole conversation");
  ok(all.every((m) => m.auth === "Bearer re_test"), "uses the API key");
});

await scenario({ MAIL_FROM: "Show Chat <chat@example.com>" }, "full", async ({ info, afterStart, afterReply }) => {
  ok(info.show.mail === true, "with a verified sender, the app knows email is on");
  const confirm = afterStart.find((m) => m.to[0] === "pat@example.com");
  ok(!!confirm && /\/b\/.+\?k=/.test(confirm.text), "buyer gets a confirmation with their private link");
  ok(!!confirm && confirm.reply_to === "maya@example.com", "buyer's email replies go to the artist");
  const alert = afterStart.find((m) => m.to[0] === "maya@example.com");
  ok(!!alert && alert.reply_to === "pat@example.com", "artist without app alerts gets the buyer message by email");
  const reply = afterReply.find((m) => m.to[0] === "pat@example.com" && /replied/.test(m.subject));
  ok(!!reply && /Yes it is!/.test(reply.text), "buyer gets the artist's reply by email");
  ok(afterReply.every((m) => m.from === "Show Chat <chat@example.com>"), "sends from the verified sender");
});

mock.close();
console.log(fails ? `\n${fails} email check(s) failed.` : "\nAll email checks passed.");
process.exit(fails ? 1 : 0);
