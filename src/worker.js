// Artist Show Chat: one Worker serves the app and the API.
// Each show lives in its own SQLite-backed Durable Object, so there is no database to set up.
import { DurableObject } from "cloudflare:workers";
import { generateVapidKeys, sendPush } from "./webpush.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LIMITS = { name: 60, booth: 12, medium: 80, body: 2000, phone: 30, email: 120, venue: 120, dates: 80 };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
const err = (message, status = 400) => json({ error: message }, status);

function randomString(n, alphabet = CODE_ALPHABET) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let s = "";
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}
const newToken = () => randomString(32, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");
const idAlphabet = "abcdefghijkmnpqrstuvwxyz23456789";
const newMemberId = () => "m" + randomString(8, idAlphabet);
const newBuyerId = () => "b" + randomString(10, idAlphabet);

async function sha256(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Accepts "@name", "name" or an instagram.com link and keeps just the handle.
function cleanInstagram(v) {
  let s = clean(v, 200);
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(s) ? s : "";
}
function clean(v, max) {
  if (v == null) return "";
  return String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
}
async function readJson(req) {
  try { return await req.json(); } catch { return {}; }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/api/manifest") return manifest(url);

    if (path === "/api/create" && req.method === "POST") {
      const body = await readJson(req);
      const wanted = clean(body.code, 10).toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (body.code && (wanted.length < 4 || wanted.length > 10)) return err("Show codes are 4 to 10 letters or numbers.");
      for (let i = 0; i < 6; i++) {
        const code = wanted || randomString(6);
        const stub = env.SHOW.get(env.SHOW.idFromName(code));
        const r = await stub.fetch("https://show/init", {
          method: "POST",
          headers: { "content-type": "application/json", "x-code": code, "x-origin": url.origin },
          body: JSON.stringify(body),
        });
        if (r.status !== 409) return r;
        if (wanted) return err("That show code is taken. Try another one.", 409);
      }
      return err("Couldn't create the show. Try again.", 500);
    }

    const m = path.match(/^\/api\/show\/([A-Za-z0-9]{4,10})(\/[a-z/]*)$/);
    if (m) {
      const code = m[1].toUpperCase();
      const stub = env.SHOW.get(env.SHOW.idFromName(code));
      const inner = new URL("https://show" + m[2] + url.search);
      const headers = new Headers(req.headers);
      headers.set("x-code", code);
      headers.set("x-origin", url.origin);
      return stub.fetch(new Request(inner, { method: req.method, headers, body: req.body }));
    }

    if (path.startsWith("/api/")) return err("Not found", 404);
    return env.ASSETS.fetch(req);
  },
};

// The web app manifest is generated so that a phone's home-screen icon opens the right show, already signed in.
function manifest(url) {
  let start = url.searchParams.get("start") || "/";
  if (!start.startsWith("/") || start.startsWith("//")) start = "/";
  const name = clean(url.searchParams.get("name"), 40) || "Show Chat";
  return new Response(
    JSON.stringify({
      name,
      short_name: "Show Chat",
      start_url: start,
      scope: "/",
      display: "standalone",
      background_color: "#0d6b63",
      theme_color: "#0d6b63",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    }),
    { headers: { "content-type": "application/manifest+json", "cache-control": "no-store" } }
  );
}

export class ShowRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY, token_hash TEXT UNIQUE, name TEXT, booth TEXT, medium TEXT,
        role TEXT, created INTEGER, seen_seq INTEGER DEFAULT 0, last_active INTEGER DEFAULT 0, removed INTEGER DEFAULT 0,
        instagram TEXT DEFAULT '');
      CREATE TABLE IF NOT EXISTS buyers (
        id TEXT PRIMARY KEY, token_hash TEXT UNIQUE, name TEXT, phone TEXT, email TEXT,
        artist_id TEXT, created INTEGER, last_active INTEGER DEFAULT 0, link_key TEXT);
      CREATE TABLE IF NOT EXISTS messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, channel TEXT, sender TEXT,
        kind TEXT, body TEXT, meta TEXT, ts INTEGER);
      CREATE INDEX IF NOT EXISTS messages_channel ON messages(channel, seq);
      CREATE TABLE IF NOT EXISTS subs (endpoint TEXT PRIMARY KEY, principal TEXT, data TEXT, created INTEGER);
    `);
    try {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    } catch {}
    this.buyerStarts = [];
  }

  // ---------- small helpers ----------
  kvGet(k) {
    const r = this.sql.exec("SELECT v FROM kv WHERE k = ?", k).toArray()[0];
    return r ? JSON.parse(r.v) : null;
  }
  kvSet(k, v) {
    this.sql.exec("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, JSON.stringify(v));
  }
  show() {
    return this.kvGet("show");
  }
  member(id) {
    return this.sql.exec("SELECT * FROM members WHERE id = ? AND removed = 0", id).toArray()[0] || null;
  }
  buyer(id) {
    return this.sql.exec("SELECT * FROM buyers WHERE id = ?", id).toArray()[0] || null;
  }
  publicMember(m) {
    return { id: m.id, name: m.name, booth: m.booth || "", medium: m.medium || "", instagram: m.instagram || "", role: m.role, active: m.last_active || 0 };
  }
  publicBuyer(b, withKey = false) {
    const out = { id: b.id, name: b.name || "", phone: b.phone || "", email: b.email || "", created: b.created, active: b.last_active || 0 };
    // The artist's app gets the buyer's private link key so a text or email reply can take the buyer back to the chat.
    if (withKey) out.key = b.link_key || "";
    return out;
  }
  rowToMsg(r) {
    return { seq: r.seq, id: r.id, ch: r.channel, from: r.sender, kind: r.kind, body: r.body, meta: r.meta ? JSON.parse(r.meta) : null, ts: r.ts };
  }
  maxSeq() {
    return this.sql.exec("SELECT COALESCE(MAX(seq), 0) AS s FROM messages").one().s;
  }
  async principal(req, url) {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : url.searchParams.get("t");
    if (!token || token.length < 20) return null;
    const h = await sha256(token);
    const m = this.sql.exec("SELECT * FROM members WHERE token_hash = ? AND removed = 0", h).toArray()[0];
    if (m) return { type: "member", id: m.id, row: m };
    const b = this.sql.exec("SELECT * FROM buyers WHERE token_hash = ?", h).toArray()[0];
    if (b) return { type: "buyer", id: b.id, row: b };
    return null;
  }

  // Used on the "__config__" instance: one VAPID key pair for every show.
  async getVapid() {
    let v = this.kvGet("vapid");
    if (!v) {
      v = await generateVapidKeys();
      this.kvSet("vapid", v);
    }
    return v;
  }
  async vapid() {
    if (!this._vapid) this._vapid = await this.env.SHOW.get(this.env.SHOW.idFromName("__config__")).getVapid();
    return this._vapid;
  }

  insertMessage({ id, channel, sender, kind, body, meta }) {
    id = clean(id, 40) || crypto.randomUUID();
    this.sql.exec(
      "INSERT OR IGNORE INTO messages (id, channel, sender, kind, body, meta, ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id, channel, sender, kind, body, meta ? JSON.stringify(meta) : null, Date.now()
    );
    const row = this.sql.exec("SELECT * FROM messages WHERE id = ?", id).one();
    return { msg: this.rowToMsg(row) };
  }

  // ---------- routing ----------
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    this.code = req.headers.get("x-code");
    this.origin = req.headers.get("x-origin") || "";
    const method = req.method;
    try {
      if (path === "/init" && method === "POST") return this.init(await readJson(req));
      const show = this.show();
      if (!show) return err("There's no show with that code.", 404);

      if (path === "/info") return json({ show: this.showInfo(show) });
      if (path === "/artist") return this.artistInfo(url.searchParams.get("id"), show);
      if (path === "/join" && method === "POST") return this.join(await readJson(req));
      if (path === "/buyer/start" && method === "POST") return this.buyerStart(await readJson(req), show);
      if (path === "/push/key") return json({ key: (await this.vapid()).publicKey });

      const p = await this.principal(req, url);
      if (!p) return err("This sign-in isn't valid any more. Ask the show director for a new link.", 401);

      if (path === "/ws") return this.ws(req, p);
      if (path === "/push/subscribe" && method === "POST") return this.subscribe(p, await readJson(req));
      if (path === "/push/unsubscribe" && method === "POST") return this.unsubscribe(p, await readJson(req));

      if (p.type === "buyer") {
        if (path === "/buyer/sync") return this.buyerSync(p, Number(url.searchParams.get("since")) || 0, show);
        if (path === "/buyer/send" && method === "POST") return this.buyerSend(p, await readJson(req), show);
        if (path === "/buyer/me" && method === "POST") return this.buyerUpdate(p, await readJson(req));
        return err("Not found", 404);
      }

      if (path === "/sync") return this.sync(p.row, Number(url.searchParams.get("since")) || 0, show);
      if (path === "/send" && method === "POST") return this.send(p.row, await readJson(req), show);
      if (path === "/me" && method === "POST") return this.updateMe(p.row, await readJson(req));

      if (p.row.role !== "director") return err("Only the show director can do that.", 403);
      if (path === "/show" && method === "POST") return this.updateShow(show, await readJson(req));
      if (path === "/member/add" && method === "POST") return this.addMember(await readJson(req));
      if (path === "/member/link" && method === "POST") return this.relink(await readJson(req));
      if (path === "/member/remove" && method === "POST") return this.removeMember(p.row, await readJson(req));
      return err("Not found", 404);
    } catch (e) {
      console.error(e && e.stack ? e.stack : e);
      return err("Something went wrong on the server.", 500);
    }
  }

  showInfo(show) {
    const artists = this.sql.exec("SELECT COUNT(*) AS n FROM members WHERE removed = 0 AND role = 'artist'").one().n;
    return { code: this.code, name: show.name, venue: show.venue || "", dates: show.dates || "", artists };
  }

  async init(body) {
    if (this.show()) return err("taken", 409);
    const name = clean(body.name, LIMITS.name);
    const director = clean(body.director, LIMITS.name);
    if (!name) return err("Give the show a name.");
    if (!director) return err("Add your name.");
    const show = { name, venue: clean(body.venue, LIMITS.venue), dates: clean(body.dates, LIMITS.dates), created: Date.now() };
    this.kvSet("show", show);
    const { member, token } = await this.createMember({ name: director, role: "director" });
    this.insertMessage({ channel: "group", sender: "system", kind: "system", body: `${director} started the show chat.` });
    return json({ code: this.code, token, me: this.publicMember(member), show: this.showInfo(show) });
  }

  async createMember({ name, booth = "", medium = "", instagram = "", role = "artist" }) {
    const id = newMemberId();
    const token = newToken();
    this.sql.exec(
      "INSERT INTO members (id, token_hash, name, booth, medium, instagram, role, created, last_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, await sha256(token), name, booth, medium, instagram, role, Date.now(), Date.now()
    );
    return { member: this.member(id), token };
  }

  async join(body) {
    const name = clean(body.name, LIMITS.name);
    if (!name) return err("Add your name.");
    const count = this.sql.exec("SELECT COUNT(*) AS n FROM members WHERE removed = 0").one().n;
    if (count >= 200) return err("This show is full.", 403);
    const { member, token } = await this.createMember({ name, booth: clean(body.booth, LIMITS.booth), medium: clean(body.medium, LIMITS.medium), instagram: cleanInstagram(body.instagram) });
    const { msg } = this.insertMessage({
      channel: "group", sender: "system", kind: "system",
      body: `${name}${member.booth ? ` (Booth ${member.booth})` : ""} joined the show.`,
    });
    this.notify(msg, this.show());
    return json({ code: this.code, token, me: this.publicMember(member) });
  }

  async addMember(body) {
    const name = clean(body.name, LIMITS.name);
    if (!name) return err("Add a name.");
    const role = body.role === "director" ? "director" : "artist";
    const { member, token } = await this.createMember({ name, booth: clean(body.booth, LIMITS.booth), medium: clean(body.medium, LIMITS.medium), instagram: cleanInstagram(body.instagram), role });
    return json({ member: this.publicMember(member), token });
  }

  async relink(body) {
    const m = this.member(body.id);
    if (!m) return err("That person isn't in this show.", 404);
    const token = newToken();
    this.sql.exec("UPDATE members SET token_hash = ? WHERE id = ?", await sha256(token), m.id);
    // Old devices are signed out, so close their live connections.
    for (const ws of this.ctx.getWebSockets(m.id)) try { ws.close(4001, "signed out"); } catch {}
    return json({ token });
  }

  removeMember(me, body) {
    const m = this.member(body.id);
    if (!m) return err("That person isn't in this show.", 404);
    if (m.id === me.id) return err("You can't remove yourself.");
    this.sql.exec("UPDATE members SET removed = 1, token_hash = NULL WHERE id = ?", m.id);
    this.sql.exec("DELETE FROM subs WHERE principal = ?", m.id);
    for (const ws of this.ctx.getWebSockets(m.id)) try { ws.close(4001, "removed"); } catch {}
    return json({ ok: true });
  }

  updateShow(show, body) {
    const next = { ...show };
    if (body.name !== undefined) next.name = clean(body.name, LIMITS.name) || show.name;
    if (body.venue !== undefined) next.venue = clean(body.venue, LIMITS.venue);
    if (body.dates !== undefined) next.dates = clean(body.dates, LIMITS.dates);
    this.kvSet("show", next);
    return json({ show: this.showInfo(next) });
  }

  updateMe(me, body) {
    const name = body.name !== undefined ? clean(body.name, LIMITS.name) || me.name : me.name;
    const booth = body.booth !== undefined ? clean(body.booth, LIMITS.booth) : me.booth;
    const medium = body.medium !== undefined ? clean(body.medium, LIMITS.medium) : me.medium;
    const instagram = body.instagram !== undefined ? cleanInstagram(body.instagram) : me.instagram;
    this.sql.exec("UPDATE members SET name = ?, booth = ?, medium = ?, instagram = ? WHERE id = ?", name, booth, medium, instagram, me.id);
    return json({ me: this.publicMember(this.member(me.id)) });
  }

  visibleWhere() {
    return `(channel IN ('group', 'ann') OR (channel LIKE 'dm:%' AND instr(channel, ?1) > 0)
             OR channel IN (SELECT 'buy:' || id FROM buyers WHERE artist_id = ?1))`;
  }

  sync(me, since, show) {
    const rows = this.sql
      .exec(`SELECT * FROM messages WHERE seq > ?2 AND ${this.visibleWhere()} ORDER BY seq DESC LIMIT 600`, me.id, since)
      .toArray()
      .reverse();
    const lastSeq = this.maxSeq();
    this.sql.exec("UPDATE members SET seen_seq = MAX(seen_seq, ?), last_active = ? WHERE id = ?", lastSeq, Date.now(), me.id);
    const members = this.sql
      .exec("SELECT * FROM members WHERE removed = 0 ORDER BY role = 'director' DESC, booth, name")
      .toArray()
      .map((m) => this.publicMember(m));
    const buyers = this.sql
      .exec("SELECT * FROM buyers WHERE artist_id = ? ORDER BY created", me.id)
      .toArray()
      .map((b) => this.publicBuyer(b, true));
    // Delivery counts for announcements: how many artists' apps have fetched each one.
    const artists = this.sql.exec("SELECT id, seen_seq FROM members WHERE removed = 0 AND role = 'artist'").toArray();
    const annRows = this.sql.exec("SELECT seq FROM messages WHERE channel = 'ann' ORDER BY seq DESC LIMIT 40").toArray();
    const delivered = {};
    for (const a of annRows) delivered[a.seq] = artists.filter((x) => x.seen_seq >= a.seq).length;
    return json({
      me: this.publicMember(this.member(me.id)),
      show: this.showInfo(show),
      members,
      buyers,
      messages: rows.map((r) => this.rowToMsg(r)),
      lastSeq,
      truncated: since > 0 && rows.length >= 600,
      ann: { artists: artists.length, delivered },
    });
  }

  async send(me, body, show) {
    const text = clean(body.body, LIMITS.body);
    const channel = String(body.channel || "");
    let kind = "text";
    let meta = null;
    if (channel === "ann") {
      if (me.role !== "director") return err("Only the show director can post announcements.", 403);
      if (!text) return err("Write the announcement first.");
      kind = "ann";
      meta = { urgent: !!(body.meta && body.meta.urgent) };
    } else if (channel === "group") {
      if (body.kind === "ref") {
        const to = this.member(body.meta && body.meta.to);
        if (!to) return err("Pick who the buyer should go see.");
        kind = "ref";
        meta = { to: to.id, status: clean(body.meta.status, 40) };
      } else if (!text) return err("Empty message.");
    } else if (channel.startsWith("dm:")) {
      const ids = channel.slice(3).split(":");
      if (ids.length !== 2 || !ids.includes(me.id)) return err("You can't post there.", 403);
      const other = ids[0] === me.id ? ids[1] : ids[0];
      if (!this.member(other) || ids[0] > ids[1]) return err("You can't post there.", 403);
      if (!text) return err("Empty message.");
    } else if (channel.startsWith("buy:")) {
      const b = this.buyer(channel.slice(4));
      if (!b || b.artist_id !== me.id) return err("You can't post there.", 403);
      if (!text) return err("Empty message.");
    } else {
      return err("You can't post there.", 403);
    }
    const before = this.maxSeq();
    const { msg } = this.insertMessage({ id: body.id, channel, sender: me.id, kind, body: text, meta });
    if (msg.seq > before) this.notify(msg, show);
    this.sql.exec("UPDATE members SET last_active = ? WHERE id = ?", Date.now(), me.id);
    return json({ message: msg });
  }

  // ---------- buyers (no account: the QR page gets a private token kept in their browser) ----------
  artistInfo(id, show) {
    const a = this.member(id);
    if (!a) return err("This artist isn't in the show chat any more.", 404);
    return json({ artist: this.publicMember(a), show: this.showInfo(show) });
  }

  async buyerStart(body, show) {
    const artist = this.member(body.artist);
    if (!artist) return err("This artist isn't in the show chat any more.", 404);
    const text = clean(body.body, LIMITS.body);
    if (!text) return err("Write a message first.");
    // A resend after a dropped connection gets the same conversation back instead of a duplicate.
    const prior = body.id ? this.sql.exec("SELECT channel FROM messages WHERE id = ?", clean(body.id, 40)).toArray()[0] : null;
    if (prior && prior.channel.startsWith("buy:")) {
      const b = this.buyer(prior.channel.slice(4));
      if (b && b.artist_id === artist.id) {
        const m = this.sql.exec("SELECT * FROM messages WHERE id = ?", clean(body.id, 40)).one();
        return json({ token: b.link_key, buyer: this.publicBuyer(b), message: this.rowToMsg(m) });
      }
    }
    const now = Date.now();
    this.buyerStarts = this.buyerStarts.filter((t) => now - t < 60000);
    if (this.buyerStarts.length > 40) return err("Too many new messages right now. Try again in a minute.", 429);
    this.buyerStarts.push(now);
    const total = this.sql.exec("SELECT COUNT(*) AS n FROM buyers").one().n;
    if (total > 5000) return err("This show can't take more visitor messages.", 403);
    const id = newBuyerId();
    const token = newToken();
    this.sql.exec(
      "INSERT INTO buyers (id, token_hash, name, phone, email, artist_id, created, last_active, link_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, await sha256(token), clean(body.name, LIMITS.name), clean(body.phone, LIMITS.phone), clean(body.email, LIMITS.email),
      artist.id, now, now, token
    );
    const { msg } = this.insertMessage({ id: body.id, channel: "buy:" + id, sender: id, kind: "text", body: text, meta: body.piece ? { piece: clean(body.piece, 80) } : null });
    this.notify(msg, show);
    return json({ token, buyer: this.publicBuyer(this.buyer(id)), message: msg });
  }

  buyerSync(p, since, show) {
    const b = this.buyer(p.id);
    const artist = this.member(b.artist_id);
    const rows = this.sql.exec("SELECT * FROM messages WHERE channel = ? AND seq > ? ORDER BY seq", "buy:" + b.id, since).toArray();
    this.sql.exec("UPDATE buyers SET last_active = ? WHERE id = ?", Date.now(), b.id);
    return json({
      buyer: this.publicBuyer(b),
      artist: artist ? this.publicMember(artist) : null,
      show: this.showInfo(show),
      messages: rows.map((r) => this.rowToMsg(r)),
      lastSeq: this.maxSeq(),
    });
  }

  buyerSend(p, body, show) {
    const b = this.buyer(p.id);
    if (!this.member(b.artist_id)) return err("This artist isn't in the show chat any more.", 404);
    const text = clean(body.body, LIMITS.body);
    if (!text) return err("Write a message first.");
    const before = this.maxSeq();
    const { msg } = this.insertMessage({ id: body.id, channel: "buy:" + b.id, sender: b.id, kind: "text", body: text });
    if (msg.seq > before) this.notify(msg, show);
    return json({ message: msg });
  }

  buyerUpdate(p, body) {
    const b = this.buyer(p.id);
    const name = body.name !== undefined ? clean(body.name, LIMITS.name) : b.name;
    const phone = body.phone !== undefined ? clean(body.phone, LIMITS.phone) : b.phone;
    const email = body.email !== undefined ? clean(body.email, LIMITS.email) : b.email;
    this.sql.exec("UPDATE buyers SET name = ?, phone = ?, email = ? WHERE id = ?", name, phone, email, b.id);
    const updated = this.buyer(b.id);
    // Let the artist's open app refresh the contact details.
    for (const ws of this.ctx.getWebSockets(b.artist_id)) try { ws.send(JSON.stringify({ t: "sync" })); } catch {}
    return json({ buyer: this.publicBuyer(updated) });
  }

  // ---------- live updates and notifications ----------
  ws(req, p) {
    if (req.headers.get("Upgrade") !== "websocket") return err("Expected a WebSocket", 426);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [p.id]);
    server.serializeAttachment({ p: p.id, vis: true });
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws, data) {
    try {
      const m = JSON.parse(data);
      if (m.t === "vis") ws.serializeAttachment({ ...(ws.deserializeAttachment() || {}), vis: !!m.v });
    } catch {}
  }
  webSocketClose(ws, code) {
    try { ws.close(code === 1005 ? 1000 : code); } catch {}
  }
  webSocketError() {}

  recipients(msg) {
    const ch = msg.ch;
    if (ch === "group" || ch === "ann") {
      return this.sql.exec("SELECT id FROM members WHERE removed = 0").toArray().map((r) => r.id).filter((id) => id !== msg.from);
    }
    if (ch.startsWith("dm:")) return ch.slice(3).split(":").filter((id) => id !== msg.from);
    if (ch.startsWith("buy:")) {
      const b = this.buyer(ch.slice(4));
      return b ? [b.id, b.artist_id].filter((id) => id !== msg.from) : [];
    }
    return [];
  }

  notify(msg, show) {
    const recipients = this.recipients(msg);
    const targets = new Set([...recipients, msg.from]);
    const visible = new Set();
    const payload = JSON.stringify({ t: "msg", m: msg });
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() || {};
      if (!targets.has(att.p)) continue;
      try { ws.send(payload); if (att.vis) visible.add(att.p); } catch {}
    }
    const pushTo = recipients.filter((id) => !visible.has(id));
    if (pushTo.length) this.ctx.waitUntil(this.push(msg, pushTo, show));
  }

  pushContent(msg, to, show) {
    const sender = msg.from.startsWith("b") ? this.buyer(msg.from) : this.member(msg.from);
    const senderName = sender ? sender.name || "A visitor" : "Show Chat";
    const base = `/s/${this.code}`;
    const snip = (s) => (s.length > 140 ? s.slice(0, 137) + "…" : s);
    if (msg.kind === "system") return null;
    if (msg.ch === "ann") {
      return { title: (msg.meta && msg.meta.urgent ? "Urgent: " : "") + show.name, body: snip(msg.body), url: base + "#group", tag: "ann-" + msg.seq, urgent: !!(msg.meta && msg.meta.urgent) };
    }
    if (msg.kind === "ref") {
      const target = this.member(msg.meta.to);
      if (to === msg.meta.to) {
        const from = sender && sender.booth ? `${senderName} (Booth ${sender.booth})` : senderName;
        return { title: "Buyer heading your way", body: snip(`From ${from}: ${msg.body || "A buyer is coming to see you."}${msg.meta.status ? " · " + msg.meta.status : ""}`), url: base + "#group", tag: "ref-" + msg.seq, urgent: true };
      }
      return { title: show.name, body: snip(`${senderName} sent a buyer to ${target ? target.name : "another artist"}`), url: base + "#group", tag: "group" };
    }
    if (msg.ch === "group") return { title: `${senderName} · ${show.name}`, body: snip(msg.body), url: base + "#group", tag: "group" };
    if (msg.ch.startsWith("dm:")) return { title: senderName, body: snip(msg.body), url: base + "#dm:" + msg.from, tag: "dm-" + msg.from };
    if (msg.ch.startsWith("buy:")) {
      const buyerId = msg.ch.slice(4);
      if (to === buyerId) {
        const b = this.buyer(buyerId);
        return { title: `${senderName} replied`, body: snip(msg.body), url: `/b/${this.code}/${b.artist_id}`, tag: "reply" };
      }
      return { title: `Buyer message: ${senderName}`, body: snip((msg.meta && msg.meta.piece ? `About ${msg.meta.piece}: ` : "") + msg.body), url: base + "#buy:" + buyerId, tag: "buy-" + buyerId, urgent: true };
    }
    return null;
  }

  async push(msg, ids, show) {
    let vapid;
    try { vapid = await this.vapid(); } catch (e) { console.error("vapid", e); return; }
    const subject = this.origin.startsWith("https://") ? this.origin : "mailto:alerts@example.com";
    const jobs = [];
    for (const id of ids) {
      const content = this.pushContent(msg, id, show);
      if (!content) continue;
      const subs = this.sql.exec("SELECT endpoint, data FROM subs WHERE principal = ?", id).toArray();
      for (const s of subs) {
        jobs.push(
          sendPush(JSON.parse(s.data), content, vapid, subject, { urgency: content.urgent ? "high" : "normal" })
            .then((status) => {
              if (status === 404 || status === 410) this.sql.exec("DELETE FROM subs WHERE endpoint = ?", s.endpoint);
              else if (status >= 400) console.warn("push status", status, new URL(s.endpoint).host);
            })
            .catch((e) => console.warn("push failed", String(e)))
        );
      }
    }
    await Promise.allSettled(jobs);
  }

  subscribe(p, body) {
    const sub = body.subscription;
    if (!sub || typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://") || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return err("That notification setup didn't work.");
    }
    const count = this.sql.exec("SELECT COUNT(*) AS n FROM subs WHERE principal = ?", p.id).one().n;
    if (count > 10) this.sql.exec("DELETE FROM subs WHERE endpoint IN (SELECT endpoint FROM subs WHERE principal = ? ORDER BY created LIMIT 1)", p.id);
    this.sql.exec(
      "INSERT INTO subs (endpoint, principal, data, created) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET principal = excluded.principal, data = excluded.data",
      sub.endpoint, p.id, JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }), Date.now()
    );
    return json({ ok: true });
  }
  unsubscribe(p, body) {
    if (body.endpoint) this.sql.exec("DELETE FROM subs WHERE endpoint = ? AND principal = ?", body.endpoint, p.id);
    return json({ ok: true });
  }
}
