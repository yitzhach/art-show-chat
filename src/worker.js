// Artist Show Chat: one Worker serves the app and the API.
// Each show lives in its own SQLite-backed Durable Object, so there is no database to set up.
import { DurableObject } from "cloudflare:workers";
import { generateVapidKeys, sendPush } from "./webpush.js";
import { mailReady, ownerMailReady, renderMail, sendMail } from "./mail.js";

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
const newVisitorId = () => "v" + randomString(10, idAlphabet);
// Booth numbers as people type them: "booth b-012", "B12" and "b 12" are all booth B12.
function normBooth(v) {
  return String(v == null ? "" : v).toUpperCase().replace(/^\s*BOOTH\s*/, "").replace(/[^A-Z0-9]/g, "").replace(/(^|[A-Z])0+(?=\d)/g, "$1").slice(0, 12);
}
const okEmailish = (s) => /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(s);

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

    const m = path.match(/^\/api\/show\/([A-Za-z0-9]{4,10})(\/[A-Za-z0-9/_-]*)$/);
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
      CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, owner TEXT, type TEXT, size INTEGER, data BLOB, created INTEGER);
      CREATE TABLE IF NOT EXISTS visitors (
        id TEXT PRIMARY KEY, token_hash TEXT UNIQUE, link_key TEXT, name TEXT DEFAULT '', email TEXT DEFAULT '', phone TEXT DEFAULT '',
        recap INTEGER DEFAULT 0, share_show INTEGER DEFAULT 0, share_artists INTEGER DEFAULT 0, via TEXT DEFAULT '',
        created INTEGER, last_active INTEGER DEFAULT 0, recap_sent INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS favs (
        visitor TEXT, k TEXT, type TEXT, booth TEXT DEFAULT '', artist TEXT DEFAULT '', piece TEXT DEFAULT '', img TEXT DEFAULT '',
        note TEXT DEFAULT '', created INTEGER, PRIMARY KEY (visitor, k));
      CREATE INDEX IF NOT EXISTS favs_booth ON favs(booth);
      CREATE INDEX IF NOT EXISTS favs_artist ON favs(artist);
      CREATE TABLE IF NOT EXISTS visits (visitor TEXT, booth TEXT, artist TEXT DEFAULT '', via TEXT DEFAULT '', ts INTEGER);
      CREATE INDEX IF NOT EXISTS visits_vb ON visits(visitor, booth, ts);
      CREATE INDEX IF NOT EXISTS visits_ts ON visits(ts);
      CREATE TABLE IF NOT EXISTS sales (
        id TEXT PRIMARY KEY, artist TEXT, piece TEXT DEFAULT '', title TEXT DEFAULT '', amount INTEGER DEFAULT 0, currency TEXT DEFAULT 'USD',
        buyer TEXT DEFAULT '', visitor TEXT DEFAULT '', source TEXT DEFAULT '', commission_rate REAL DEFAULT 0, status TEXT DEFAULT 'recorded',
        note TEXT DEFAULT '', created INTEGER, updated INTEGER);
      CREATE INDEX IF NOT EXISTS sales_artist ON sales(artist, created);
    `);
    // Columns added after the first release.
    for (const sql of [
      "ALTER TABLE members ADD COLUMN phone TEXT DEFAULT ''",
      "ALTER TABLE members ADD COLUMN email TEXT DEFAULT ''",
      "ALTER TABLE buyers ADD COLUMN moved TEXT DEFAULT ''",
      "ALTER TABLE members ADD COLUMN private_stats INTEGER DEFAULT 0",
      "ALTER TABLE members ADD COLUMN share_stats INTEGER DEFAULT 0",
      "ALTER TABLE members ADD COLUMN share_sales INTEGER DEFAULT 0",
    ]) { try { this.sql.exec(sql); } catch {} }
    try {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    } catch {}
    this.buyerStarts = [];
    this.visitorStarts = [];
    this.sendTimes = new Map();
  }
  // Each person can send up to 40 messages a minute; a stuck phone resending in a loop can't swamp the show.
  floodCheck(id) {
    const now = Date.now();
    const list = (this.sendTimes.get(id) || []).filter((t) => now - t < 60000);
    if (list.length >= 40) { this.sendTimes.set(id, list); return true; }
    list.push(now);
    this.sendTimes.set(id, list);
    if (this.sendTimes.size > 2000) this.sendTimes.clear();
    return false;
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
    return { id: m.id, name: m.name, booth: m.booth || "", medium: m.medium || "", instagram: m.instagram || "", phone: m.phone || "", email: m.email || "", role: m.role, active: m.last_active || 0, privateStats: !!m.private_stats, shareStats: !!m.share_stats, shareSales: !!m.share_sales };
  }
  publicBuyer(b, withKey = false) {
    const out = { id: b.id, name: b.name || "", phone: b.phone || "", email: b.email || "", moved: b.moved || "", created: b.created, active: b.last_active || 0 };
    // The artist's app gets the buyer's private link key so a text or email reply can take the buyer back to the chat.
    if (withKey) out.key = b.link_key || "";
    return out;
  }
  // ---------- booth photos and pieces: each artist's little catalog for the QR page ----------
  gallery(memberId) {
    const g = this.kvGet("gal:" + memberId) || {};
    return { booth: Array.isArray(g.booth) ? g.booth : [], pieces: Array.isArray(g.pieces) ? g.pieces : [], updated: g.updated || 0 };
  }
  galleryPiece(memberId, pieceId) {
    if (typeof pieceId !== "string" || !pieceId) return null;
    return this.gallery(memberId).pieces.find((x) => x.id === pieceId) || null;
  }
  pieceMeta(memberId, body) {
    const pc = this.galleryPiece(memberId, body.pieceId);
    if (pc) return { piece: pc.title || "this piece", pieceId: pc.id, pimg: pc.thumb || pc.img };
    return body.piece ? { piece: clean(body.piece, 80) } : null;
  }
  saveGallery(me, body) {
    const ownImg = (id) => typeof id === "string" && /^[A-Za-z0-9]{16,40}$/.test(id) && this.sql.exec("SELECT COUNT(*) AS n FROM images WHERE id = ? AND owner = ?", id, me.id).one().n > 0;
    const shot = (x) => (x && ownImg(x.img) ? { img: x.img, thumb: ownImg(x.thumb) ? x.thumb : x.img } : null);
    const booth = (Array.isArray(body.booth) ? body.booth : []).slice(0, 8).map(shot).filter(Boolean);
    const seen = new Set();
    const pieces = (Array.isArray(body.pieces) ? body.pieces : []).slice(0, 40).map((x) => {
      const base = shot(x);
      if (!base) return null;
      let id = typeof x.id === "string" && /^p[a-z0-9]{4,16}$/.test(x.id) ? x.id : "p" + newToken().slice(0, 10).toLowerCase();
      if (seen.has(id)) id = "p" + newToken().slice(0, 10).toLowerCase();
      seen.add(id);
      return { id, ...base, title: clean(x.title, 60), price: clean(x.price, 30), note: clean(x.note, 120), sold: !!x.sold };
    }).filter(Boolean);
    const g = { booth, pieces, updated: Date.now() };
    this.kvSet("gal:" + me.id, g);
    // Buyers who have this artist's page open see the new photos right away.
    const ids = new Set(this.sql.exec("SELECT id FROM buyers WHERE artist_id = ?", me.id).toArray().map((r) => r.id));
    const payload = JSON.stringify({ t: "gallery", g });
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() || {};
      if (ids.has(att.p)) try { ws.send(payload); } catch {}
    }
    return json({ gallery: g });
  }

  // ---------- visitors: walk the show, heart pieces, get a recap later (no account, a private key in their browser) ----------
  artistsByBooth() {
    const out = new Map();
    for (const m of this.sql.exec("SELECT * FROM members WHERE removed = 0 AND role = 'artist' ORDER BY created").toArray()) {
      const n = normBooth(m.booth);
      if (n && !out.has(n)) out.set(n, m);
    }
    return out;
  }
  coverOf(memberId) {
    const g = this.gallery(memberId);
    const x = g.booth[0] || g.pieces[0];
    return x ? x.thumb || x.img : "";
  }
  visitInfo(show) {
    const booths = [...this.artistsByBooth().entries()]
      .map(([n, m]) => ({ id: m.id, name: m.name, booth: m.booth, n, medium: m.medium || "", cover: this.coverOf(m.id) }))
      .sort((a, b) => a.n.localeCompare(b.n, "en", { numeric: true }));
    return json({ show: this.showInfo(show), booths });
  }
  visitBooth(raw) {
    const n = normBooth(raw);
    if (!n) return err("Type a booth number.");
    const a = this.artistsByBooth().get(n);
    return json({ booth: n, artist: a ? this.publicMember(a) : null, gallery: a ? this.gallery(a.id) : null });
  }
  // The "people saved your booth" nudge an artist sees when they join with an unclaimed booth number.
  visitClaim(raw) {
    const n = normBooth(raw);
    if (!n) return json({ booth: "", claimed: false, savers: 0 });
    const claimed = this.artistsByBooth().has(n);
    const savers = this.sql.exec("SELECT COUNT(DISTINCT visitor) AS n FROM favs WHERE booth = ?", n).one().n;
    return json({ booth: n, claimed, savers });
  }
  async visitorStart(body) {
    const now = Date.now();
    this.visitorStarts = this.visitorStarts.filter((t) => now - t < 60000);
    if (this.visitorStarts.length > 400) return err("Lots of people are arriving right now. Try again in a minute.", 429);
    this.visitorStarts.push(now);
    const total = this.sql.exec("SELECT COUNT(*) AS n FROM visitors").one().n;
    if (total > 30000) return err("This show can't take more visitors in the app.", 403);
    const id = newVisitorId(), token = newToken();
    const via = ["show", "artist", "link"].includes(body.via) ? body.via : "show";
    this.sql.exec("INSERT INTO visitors (id, token_hash, link_key, via, created, last_active) VALUES (?, ?, ?, ?, ?, ?)", id, await sha256(token), token, via, now, now);
    return json({ token, visitor: this.publicVisitor(this.visitorRow(id)) });
  }
  visitorRow(id) {
    return this.sql.exec("SELECT * FROM visitors WHERE id = ?", id).toArray()[0] || null;
  }
  publicVisitor(v) {
    return { id: v.id, name: v.name || "", email: v.email || "", phone: v.phone || "", recap: !!v.recap, shareShow: !!v.share_show, shareArtists: !!v.share_artists, recapSent: v.recap_sent || 0 };
  }
  // One saved thing, with what the visitor needs to see it now: the piece's current price and sold mark, and the artist if the booth is on Show Chat.
  resolveFav(f, byBooth) {
    const a = (f.artist && this.member(f.artist)) || (f.booth && byBooth.get(f.booth)) || null;
    const out = { k: f.k, type: f.type, booth: f.booth || (a ? normBooth(a.booth) : ""), note: f.note || "", img: f.img || "", created: f.created, artist: a ? { id: a.id, name: a.name, booth: a.booth || "", medium: a.medium || "", instagram: a.instagram || "" } : null, piece: null };
    if (f.type === "piece") {
      const pc = a ? this.galleryPiece(a.id, f.piece) : null;
      out.piece = pc ? { id: pc.id, title: pc.title || "", price: pc.price || "", note: pc.note || "", sold: !!pc.sold, img: pc.img, thumb: pc.thumb || pc.img } : { id: f.piece, gone: true };
    }
    return out;
  }
  visitorFavs(v) {
    const byBooth = this.artistsByBooth();
    return this.sql.exec("SELECT * FROM favs WHERE visitor = ? ORDER BY created", v.id).toArray().map((f) => this.resolveFav(f, byBooth));
  }
  visitorMe(v, show) {
    this.sql.exec("UPDATE visitors SET last_active = ? WHERE id = ?", Date.now(), v.id);
    return json({ visitor: this.publicVisitor(v), favs: this.visitorFavs(v), show: this.showInfo(show) });
  }
  visitorUpdate(v, body, show) {
    const name = body.name !== undefined ? clean(body.name, LIMITS.name) : v.name;
    const phone = body.phone !== undefined ? clean(body.phone, LIMITS.phone) : v.phone;
    let email = body.email !== undefined ? clean(body.email, LIMITS.email) : v.email;
    if (email && !okEmailish(email)) return err("That email doesn't look right.");
    const flag = (k, cur) => (body[k] !== undefined ? (body[k] ? 1 : 0) : cur);
    this.sql.exec("UPDATE visitors SET name = ?, phone = ?, email = ?, recap = ?, share_show = ?, share_artists = ?, last_active = ? WHERE id = ?",
      name, phone, email, flag("recap", v.recap), flag("shareShow", v.share_show), flag("shareArtists", v.share_artists), Date.now(), v.id);
    return json({ visitor: this.publicVisitor(this.visitorRow(v.id)) });
  }
  visitorFav(v, body) {
    const type = ["piece", "booth", "snap"].includes(body.type) ? body.type : null;
    if (!type) return err("Pick something to save.");
    const on = body.on !== false;
    let k, booth = "", artist = "", piece = "", img = "", note = clean(body.note, 120);
    const a = typeof body.artist === "string" && body.artist ? this.member(body.artist) : null;
    if (type === "piece") {
      if (!a) return err("That artist isn't in the show chat any more.", 404);
      const pc = this.galleryPiece(a.id, body.piece);
      if (!pc && on) return err("That piece isn't on the artist's page any more.", 404);
      piece = String(body.piece || "").slice(0, 20); artist = a.id; booth = normBooth(a.booth);
      k = `p:${a.id}:${piece}`;
    } else if (type === "booth") {
      booth = a ? normBooth(a.booth) : normBooth(body.booth);
      if (!booth) return err("Type a booth number.");
      const owner = a || this.artistsByBooth().get(booth);
      artist = owner ? owner.id : "";
      k = "b:" + booth;
    } else {
      const sid = String(body.sid || "");
      if (!/^[A-Za-z0-9-]{6,40}$/.test(sid)) return err("That photo couldn't be saved.");
      k = "s:" + sid;
      if (on) {
        booth = a ? normBooth(a.booth) : normBooth(body.booth);
        const owner = a || this.artistsByBooth().get(booth);
        artist = owner ? owner.id : "";
        img = String(body.img || "");
        const mine = /^[A-Za-z0-9]{16,40}$/.test(img) && this.sql.exec("SELECT COUNT(*) AS n FROM images WHERE id = ? AND owner = ?", img, v.id).one().n > 0;
        if (!mine) return err("That photo couldn't be saved.");
      }
    }
    if (!on) {
      this.sql.exec("DELETE FROM favs WHERE visitor = ? AND k = ?", v.id, k);
      return json({ k, fav: null });
    }
    const exists = this.sql.exec("SELECT COUNT(*) AS n FROM favs WHERE visitor = ? AND k = ?", v.id, k).one().n > 0;
    if (!exists && this.sql.exec("SELECT COUNT(*) AS n FROM favs WHERE visitor = ?", v.id).one().n >= 300) return err("You've saved 300 things. Remove a few to save more.", 403);
    this.sql.exec(
      `INSERT INTO favs (visitor, k, type, booth, artist, piece, img, note, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(visitor, k) DO UPDATE SET note = excluded.note, booth = excluded.booth, artist = excluded.artist`,
      v.id, k, type, booth, artist, piece, img, note, Date.now()
    );
    this.sql.exec("UPDATE visitors SET last_active = ? WHERE id = ?", Date.now(), v.id);
    const row = this.sql.exec("SELECT * FROM favs WHERE visitor = ? AND k = ?", v.id, k).one();
    // The artist's open app refreshes its "saved by visitors" numbers.
    if (artist) for (const ws of this.ctx.getWebSockets(artist)) try { ws.send(JSON.stringify({ t: "insights" })); } catch {}
    return json({ k, fav: this.resolveFav(row, this.artistsByBooth()) });
  }
  // One stop at a booth, for the show's traffic numbers. The same booth again within 20 minutes counts once.
  visitorVisit(v, body) {
    const a = typeof body.artist === "string" && body.artist ? this.member(body.artist) : null;
    const booth = a ? normBooth(a.booth) : normBooth(body.booth);
    if (!booth && !a) return err("Which booth?");
    const via = ["qr", "booth", "map", "list", "fav", "link"].includes(body.via) ? body.via : "link";
    const now = Date.now();
    const last = this.sql.exec("SELECT MAX(ts) AS t FROM visits WHERE visitor = ? AND booth = ?", v.id, booth).one().t || 0;
    if (now - last < 20 * 60e3) return json({ ok: true, counted: false });
    const hour = this.sql.exec("SELECT COUNT(*) AS n FROM visits WHERE visitor = ? AND ts > ?", v.id, now - 3600e3).one().n;
    if (hour > 120) return json({ ok: true, counted: false });
    this.sql.exec("INSERT INTO visits (visitor, booth, artist, via, ts) VALUES (?, ?, ?, ?, ?)", v.id, booth, a ? a.id : "", via, now);
    return json({ ok: true, counted: true });
  }

  // ---------- what an artist sees: who saved their work (contact details only when the visitor said yes) ----------
  artistStats(me) {
    const b = normBooth(me.booth);
    const where = b ? "(artist = ?1 OR booth = ?2)" : "artist = ?1";
    const favs = this.sql.exec(`SELECT * FROM favs WHERE ${where}`, me.id, b).toArray();
    const savers = new Set(favs.map((f) => f.visitor));
    const perPiece = {};
    let boothHearts = 0, snaps = 0;
    const early = new Set();
    for (const f of favs) {
      if (f.type === "piece") perPiece[f.piece] = (perPiece[f.piece] || 0) + 1;
      else if (f.type === "booth") boothHearts++;
      else snaps++;
      if (!f.artist) early.add(f.visitor);
    }
    // Buyer messages that asked about a piece, from this artist's QR chats.
    const asks = {};
    for (const r of this.sql.exec("SELECT m.meta FROM messages m JOIN buyers b ON m.channel = 'buy:' || b.id WHERE b.artist_id = ? AND m.sender = b.id AND m.meta IS NOT NULL", me.id).toArray()) {
      try { const mt = JSON.parse(r.meta); if (mt && mt.pieceId) asks[mt.pieceId] = (asks[mt.pieceId] || 0) + 1; } catch {}
    }
    const visits = this.sql.exec(`SELECT COUNT(DISTINCT visitor) AS n FROM visits WHERE ${where}`, me.id, b).one().n;
    const hours = this.sql.exec(`SELECT CAST(ts / 3600000 AS INTEGER) AS h, COUNT(DISTINCT visitor) AS n FROM visits WHERE ${where} GROUP BY h ORDER BY h`, me.id, b).toArray().map((r) => ({ h: r.h * 3600000, n: r.n }));
    const g = this.gallery(me.id);
    const pieces = g.pieces.map((pc) => ({ id: pc.id, title: pc.title || "Untitled", price: pc.price || "", sold: !!pc.sold, thumb: pc.thumb || pc.img, saves: perPiece[pc.id] || 0, asks: asks[pc.id] || 0 }))
      .sort((x, y) => y.saves + y.asks - (x.saves + x.asks));
    return { favs, savers, perPiece, boothHearts, snaps, early: early.size, visits, hours, pieces, buyerChats: this.sql.exec("SELECT COUNT(*) AS n FROM buyers WHERE artist_id = ?", me.id).one().n };
  }
  // Where this artist stands among the show's artists by visitors who saved their work. Anonymous: no other names.
  rankOf(me) {
    const per = new Map();
    for (const r of this.sql.exec("SELECT booth, COUNT(DISTINCT visitor) AS n FROM favs WHERE booth != '' GROUP BY booth").toArray()) per.set(r.booth, r.n);
    const counts = [...this.artistsByBooth().keys()].map((n) => per.get(n) || 0);
    const mine = per.get(normBooth(me.booth)) || 0;
    if (!normBooth(me.booth) || counts.length < 3) return null;
    const above = counts.filter((c) => c > mine).length;
    return { place: above + 1, of: counts.length, topPct: Math.max(1, Math.round(((above + 1) / counts.length) * 100)), median: counts.sort((x, y) => x - y)[Math.floor(counts.length / 2)] };
  }
  insights(me, show) {
    const st = this.artistStats(me);
    const title = (id) => { const pc = st.pieces.find((x) => x.id === id); return pc ? pc.title : ""; };
    const leads = [];
    for (const id of new Set(st.favs.map((f) => f.visitor))) {
      const v = this.visitorRow(id);
      if (!v || !v.share_artists || (!v.email && !v.phone)) continue;
      const mine = st.favs.filter((f) => f.visitor === id);
      leads.push({
        id: v.id, name: v.name || "", email: v.email || "", phone: v.phone || "",
        saved: mine.map((f) => (f.type === "piece" ? title(f.piece) : f.type === "booth" ? "Your booth" : "A photo of your work")).filter(Boolean),
        last: Math.max(...mine.map((f) => f.created)),
      });
    }
    leads.sort((x, y) => y.last - x.last);
    const sales = this.sql.exec("SELECT * FROM sales WHERE artist = ? ORDER BY created DESC LIMIT 200", me.id).toArray().map((x) => this.publicSale(x));
    return json({
      savers: st.savers.size, visits: st.visits, perPiece: st.perPiece, boothHearts: st.boothHearts, snaps: st.snaps, early: st.early,
      pieces: st.pieces, hours: st.hours, rank: this.rankOf(me), leads: leads.slice(0, 500), sales,
      commission: show.commission || 0, salesShared: !!(show.commission || me.share_sales),
    });
  }
  publicSale(x) {
    return { id: x.id, piece: x.piece, title: x.title, amount: x.amount, currency: x.currency, source: x.source, commissionRate: x.commission_rate, commission: Math.round(x.amount * x.commission_rate / 100), status: x.status, note: x.note, created: x.created };
  }
  // A sale the artist records, from the show or a follow-up after it. No payment moves here; it's the record a commission show needs.
  // Shared with the show only when the show takes a commission, or the artist chose to share sales.
  recordSale(me, body, show) {
    if (me.role !== "artist") return err("Only artists record sales.", 403);
    if (body.remove) {
      this.sql.exec("DELETE FROM sales WHERE id = ? AND artist = ?", String(body.remove), me.id);
      return json({ ok: true });
    }
    const amount = Math.round(Number(String(body.amount ?? "").replace(/[^0-9.]/g, "")) * 100);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e10) return err("Add the sale amount.");
    const pc = this.galleryPiece(me.id, body.piece);
    const title = pc ? pc.title || "Untitled" : clean(body.title, 60);
    const source = ["show", "after", "chat"].includes(body.source) ? body.source : "show";
    const buyer = typeof body.buyer === "string" && this.buyer(body.buyer) && this.buyer(body.buyer).artist_id === me.id ? body.buyer : "";
    const id = "s" + newToken().slice(0, 12).toLowerCase();
    const now = Date.now();
    this.sql.exec("INSERT INTO sales (id, artist, piece, title, amount, currency, buyer, source, commission_rate, note, created, updated) VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?)",
      id, me.id, pc ? pc.id : "", title, amount, buyer, source, show.commission || 0, clean(body.note, 120), now, now);
    if (pc && body.markSold !== false && !pc.sold) {
      const g = this.gallery(me.id);
      for (const x of g.pieces) if (x.id === pc.id) x.sold = true;
      this.saveGallery(me, g);
    }
    return json({ sale: this.publicSale(this.sql.exec("SELECT * FROM sales WHERE id = ?", id).one()) });
  }

  // ---------- what the show sees ----------
  showData(show) {
    const one = (sql, ...a) => this.sql.exec(sql, ...a).one().n;
    const totals = {
      visitors: one("SELECT COUNT(*) AS n FROM visitors"),
      savers: one("SELECT COUNT(DISTINCT visitor) AS n FROM favs"),
      saves: one("SELECT COUNT(*) AS n FROM favs"),
      visits: one("SELECT COUNT(*) AS n FROM visits"),
      qrScans: one("SELECT COUNT(*) AS n FROM visits WHERE via = 'qr'"),
      typed: one("SELECT COUNT(*) AS n FROM visits WHERE via = 'booth'"),
      contacts: one("SELECT COUNT(*) AS n FROM visitors WHERE email != '' OR phone != ''"),
      shareShow: one("SELECT COUNT(*) AS n FROM visitors WHERE share_show = 1 AND (email != '' OR phone != '')"),
      recapWanted: one("SELECT COUNT(*) AS n FROM visitors WHERE recap = 1 AND email != ''"),
      recapSent: one("SELECT COUNT(*) AS n FROM visitors WHERE recap_sent > 0"),
    };
    const byBooth = this.artistsByBooth();
    const rows = new Map();
    // Shows see visitor totals by booth only: never sales, prices, chats or buyer contacts. An artist can also keep their name out.
    const row = (n) => { if (!rows.has(n)) { const a = byBooth.get(n); rows.set(n, { booth: n, claimed: !!a, artist: a && !a.private_stats ? { id: a.id, name: a.name } : null, visitors: 0, savers: 0, saves: 0 }); } return rows.get(n); };
    for (const r of this.sql.exec("SELECT booth, COUNT(DISTINCT visitor) AS n FROM visits WHERE booth != '' GROUP BY booth").toArray()) row(r.booth).visitors = r.n;
    for (const r of this.sql.exec("SELECT booth, COUNT(DISTINCT visitor) AS s, COUNT(*) AS n FROM favs WHERE booth != '' GROUP BY booth").toArray()) { const x = row(r.booth); x.savers = r.s; x.saves = r.n; }
    for (const n of byBooth.keys()) row(n);
    const booths = [...rows.values()].sort((a, b) => b.savers - a.savers || b.visitors - a.visitors || a.booth.localeCompare(b.booth, "en", { numeric: true }));
    const since = Date.now() - 10 * 24 * 3600e3;
    const hours = this.sql.exec("SELECT CAST(ts / 3600000 AS INTEGER) AS h, COUNT(DISTINCT visitor) AS n FROM visits WHERE ts > ? GROUP BY h ORDER BY h", since).toArray().map((r) => ({ h: r.h * 3600000, n: r.n }));
    const contacts = this.sql.exec("SELECT v.*, (SELECT COUNT(*) FROM favs f WHERE f.visitor = v.id) AS saves FROM visitors v WHERE share_show = 1 AND (email != '' OR phone != '') ORDER BY created DESC LIMIT 2000").toArray()
      .map((v) => ({ name: v.name || "", email: v.email || "", phone: v.phone || "", saves: v.saves, created: v.created }));
    const entry = {};
    for (const r of this.sql.exec("SELECT via, COUNT(*) AS n FROM visitors GROUP BY via").toArray()) entry[r.via || "show"] = r.n;
    // Artists who chose to share their results, and sales the show is owed a commission on (or that the artist chose to share).
    const shared = [];
    for (const m of this.sql.exec("SELECT * FROM members WHERE removed = 0 AND role = 'artist' AND share_stats = 1 ORDER BY booth").toArray()) {
      const st = this.artistStats(m);
      shared.push({ id: m.id, name: m.name, booth: m.booth || "", savers: st.savers.size, visits: st.visits, buyerChats: st.buyerChats, pieces: st.pieces.slice(0, 5).map((x) => ({ title: x.title, thumb: x.thumb, saves: x.saves, asks: x.asks })) });
    }
    const saleRows = this.sql.exec(`SELECT s.*, m.name AS artist_name, m.booth AS artist_booth FROM sales s JOIN members m ON m.id = s.artist
      WHERE s.commission_rate > 0 OR m.share_sales = 1 ORDER BY s.created DESC LIMIT 1000`).toArray();
    const sales = saleRows.map((x) => ({ ...this.publicSale(x), artist: x.artist_name, booth: x.artist_booth || "" }));
    const salesTotals = { count: sales.length, amount: sales.reduce((t, x) => t + x.amount, 0), commission: sales.reduce((t, x) => t + x.commission, 0) };
    return json({ show: this.showInfo(show), totals, entry, booths, hours, contacts, shared, sales, salesTotals, mailOn: mailReady(this.env) });
  }
  contactsCsv(show) {
    const q = (s) => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
    const rows = this.sql.exec("SELECT v.*, (SELECT COUNT(*) FROM favs f WHERE f.visitor = v.id) AS saves FROM visitors v WHERE share_show = 1 AND (email != '' OR phone != '') ORDER BY created").toArray();
    const lines = ["name,email,phone,saved,joined"].concat(rows.map((v) => [q(v.name), q(v.email), q(v.phone), v.saves, q(new Date(v.created).toISOString())].join(",")));
    const file = `${(show.name || "show").replace(/[^A-Za-z0-9]+/g, "-")}-visitors.csv`;
    return new Response(lines.join("\r\n") + "\r\n", { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${file}"`, "cache-control": "no-store" } });
  }
  setMap(me, body) {
    if (body.img == null || body.img === "") { this.kvSet("map", null); return json({ map: null }); }
    const img = String(body.img), thumb = String(body.thumb || body.img);
    const own = (id) => /^[A-Za-z0-9]{16,40}$/.test(id) && this.sql.exec("SELECT COUNT(*) AS n FROM images WHERE id = ? AND owner = ?", id, me.id).one().n > 0;
    if (!own(img)) return err("Upload the map photo first.");
    const map = { img, thumb: own(thumb) ? thumb : img, updated: Date.now() };
    this.kvSet("map", map);
    return json({ map });
  }
  // The favorites recap email. Off until email is set up with a verified sender (MAIL_FROM); then only when the director presses send.
  async sendRecaps(show) {
    if (!mailReady(this.env)) return err("Recap emails are off until email is set up for Show Chat.", 409);
    const list = this.sql.exec("SELECT * FROM visitors WHERE recap = 1 AND email != '' AND recap_sent = 0 ORDER BY created LIMIT 300").toArray();
    let sent = 0, skipped = 0;
    for (const v of list) {
      const favs = this.visitorFavs(v);
      if (!favs.length) { skipped++; continue; }
      const blocks = favs.slice(0, 40).map((f) => {
        const who = f.artist ? `${f.artist.name}${f.artist.booth ? ` · Booth ${f.artist.booth}` : ""}` : `Booth ${f.booth}`;
        if (f.type === "piece" && f.piece && !f.piece.gone) return { who, text: [f.piece.title || "Untitled", f.piece.price, f.piece.sold ? "Sold" : ""].filter(Boolean).join(" · "), img: `${this.origin}/api/show/${this.code}/img/${f.piece.thumb}` };
        if (f.type === "snap") return { who, text: f.note || "Your photo", img: `${this.origin}/api/show/${this.code}/img/${f.img}` };
        return { who, text: f.type === "booth" ? "You saved this booth" + (f.note ? `: ${f.note}` : "") : "This piece is no longer listed" };
      });
      const m = renderMail({
        intro: `Here are the ${favs.length === 1 ? "piece" : `${favs.length} things`} you saved at ${show.name}. Prices and sold marks are as of today.`,
        blocks,
        cta: "See your favorites and message the artists",
        ctaUrl: `${this.origin}/v/${this.code}?k=${v.link_key}#saved`,
        footer: ["You asked for this recap in the Show Chat app at the show. This is the only email it sends you."],
      });
      const r = await sendMail(this.env, { to: v.email, subject: `Your favorites from ${show.name}`, ...m, tag: "recap" });
      if (r.ok) { sent++; this.sql.exec("UPDATE visitors SET recap_sent = ? WHERE id = ?", Date.now(), v.id); } else skipped++;
    }
    const left = this.sql.exec("SELECT COUNT(*) AS n FROM visitors WHERE recap = 1 AND email != '' AND recap_sent = 0").one().n;
    return json({ sent, skipped, left });
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
    const v = this.sql.exec("SELECT * FROM visitors WHERE token_hash = ?", h).toArray()[0];
    if (v) return { type: "visitor", id: v.id, row: v };
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
      if (path === "/visit/info") return this.visitInfo(show);
      if (path === "/visit/booth") return this.visitBooth(url.searchParams.get("b"));
      if (path === "/visit/claim") return this.visitClaim(url.searchParams.get("b"));
      if (path === "/visitor/start" && method === "POST") return this.visitorStart(await readJson(req));
      if (path.startsWith("/img/")) return this.image(path.slice(5));

      const p = await this.principal(req, url);
      if (!p) return err("This sign-in isn't valid any more. Ask the show director for a new link.", 401);

      if (path === "/ws") return this.ws(req, p);
      if (path === "/push/subscribe" && method === "POST") return this.subscribe(p, await readJson(req));
      if (path === "/push/unsubscribe" && method === "POST") return this.unsubscribe(p, await readJson(req));
      if (path === "/upload" && method === "POST") return this.upload(p, req);

      if (p.type === "visitor") {
        if (path === "/visitor/me" && method === "GET") return this.visitorMe(p.row, show);
        if (path === "/visitor/me" && method === "POST") return this.visitorUpdate(p.row, await readJson(req), show);
        if (path === "/visitor/fav" && method === "POST") return this.visitorFav(p.row, await readJson(req));
        if (path === "/visitor/visit" && method === "POST") return this.visitorVisit(p.row, await readJson(req));
        return err("Not found", 404);
      }

      if (p.type === "buyer") {
        if (path === "/buyer/sync") return this.buyerSync(p, Number(url.searchParams.get("since")) || 0, show);
        if (path === "/buyer/send" && method === "POST") return this.buyerSend(p, await readJson(req), show);
        if (path === "/buyer/me" && method === "POST") return this.buyerUpdate(p, await readJson(req));
        if (path === "/buyer/move" && method === "POST") return this.buyerMove(p, await readJson(req), show);
        return err("Not found", 404);
      }

      if (path === "/sync") return this.sync(p.row, Number(url.searchParams.get("since")) || 0, show);
      if (path === "/send" && method === "POST") return this.send(p.row, await readJson(req), show);
      if (path === "/me" && method === "POST") return this.updateMe(p.row, await readJson(req));
      if (path === "/gallery" && method === "POST") return this.saveGallery(p.row, await readJson(req));
      if (path === "/insights") return this.insights(p.row, show);
      if (path === "/sale" && method === "POST") return this.recordSale(p.row, await readJson(req), show);

      if (p.row.role !== "director") return err("Only the show director can do that.", 403);
      if (path === "/show" && method === "POST") return this.updateShow(show, await readJson(req));
      if (path === "/member/add" && method === "POST") return this.addMember(await readJson(req));
      if (path === "/member/link" && method === "POST") return this.relink(await readJson(req));
      if (path === "/member/remove" && method === "POST") return this.removeMember(p.row, await readJson(req));
      if (path === "/data") return this.showData(show);
      if (path === "/data/contacts-csv") return this.contactsCsv(show);
      if (path === "/map" && method === "POST") return this.setMap(p.row, await readJson(req));
      if (path === "/recap/send" && method === "POST") return this.sendRecaps(show);
      return err("Not found", 404);
    } catch (e) {
      console.error(e && e.stack ? e.stack : e);
      return err("Something went wrong on the server.", 500);
    }
  }

  showInfo(show) {
    const artists = this.sql.exec("SELECT COUNT(*) AS n FROM members WHERE removed = 0 AND role = 'artist'").one().n;
    const map = this.kvGet("map");
    return { code: this.code, name: show.name, venue: show.venue || "", dates: show.dates || "", artists, mail: mailReady(this.env), map: map && map.img ? map : null, commission: show.commission || 0 };
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
    if (body.commission !== undefined) { const c = Number(body.commission); next.commission = Number.isFinite(c) && c > 0 ? Math.min(50, Math.round(c * 10) / 10) : 0; }
    this.kvSet("show", next);
    return json({ show: this.showInfo(next) });
  }

  updateMe(me, body) {
    const name = body.name !== undefined ? clean(body.name, LIMITS.name) || me.name : me.name;
    const booth = body.booth !== undefined ? clean(body.booth, LIMITS.booth) : me.booth;
    const medium = body.medium !== undefined ? clean(body.medium, LIMITS.medium) : me.medium;
    const instagram = body.instagram !== undefined ? cleanInstagram(body.instagram) : me.instagram;
    const phone = body.phone !== undefined ? clean(body.phone, LIMITS.phone) : me.phone;
    const email = body.email !== undefined ? clean(body.email, LIMITS.email) : me.email;
    const flag = (k, cur) => (body[k] !== undefined ? (body[k] ? 1 : 0) : cur || 0);
    this.sql.exec("UPDATE members SET name = ?, booth = ?, medium = ?, instagram = ?, phone = ?, email = ?, private_stats = ?, share_stats = ?, share_sales = ? WHERE id = ?",
      name, booth, medium, instagram, phone, email, flag("privateStats", me.private_stats), flag("shareStats", me.share_stats), flag("shareSales", me.share_sales), me.id);
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
      gallery: this.gallery(me.id),
      ann: { artists: artists.length, delivered },
    });
  }

  photoMeta(body) {
    const id = body.meta && typeof body.meta.img === "string" ? body.meta.img : "";
    if (!id || !/^[A-Za-z0-9]{16,40}$/.test(id)) return null;
    const row = this.sql.exec("SELECT id, type FROM images WHERE id = ?", id).toArray()[0];
    return row ? { img: row.id } : null;
  }

  async send(me, body, show) {
    if (this.floodCheck(me.id)) return err("You're sending very fast. It'll go through in a moment.", 429);
    const text = clean(body.body, LIMITS.body);
    const channel = String(body.channel || "");
    let kind = "text";
    let meta = this.photoMeta(body);
    const hasContent = !!text || !!meta;
    if (channel === "ann") {
      if (me.role !== "director") return err("Only the show director can post announcements.", 403);
      if (!text) return err("Write the announcement first.");
      kind = "ann";
      meta = { ...(meta || {}), urgent: !!(body.meta && body.meta.urgent) };
    } else if (channel === "group") {
      if (body.kind === "ref") {
        const to = this.member(body.meta && body.meta.to);
        if (!to) return err("Pick who the buyer should go see.");
        kind = "ref";
        meta = { to: to.id, status: clean(body.meta.status, 40) };
      } else if (!hasContent) return err("Empty message.");
    } else if (channel.startsWith("dm:")) {
      const ids = channel.slice(3).split(":");
      if (ids.length !== 2 || !ids.includes(me.id)) return err("You can't post there.", 403);
      const other = ids[0] === me.id ? ids[1] : ids[0];
      if (!this.member(other) || ids[0] > ids[1]) return err("You can't post there.", 403);
      if (!hasContent) return err("Empty message.");
    } else if (channel.startsWith("buy:")) {
      const b = this.buyer(channel.slice(4));
      if (!b || b.artist_id !== me.id) return err("You can't post there.", 403);
      if (!hasContent) return err("Empty message.");
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
    return json({ artist: this.publicMember(a), show: this.showInfo(show), gallery: this.gallery(a.id) });
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
    if (this.buyerStarts.length > 150) return err("Too many new messages right now. Try again in a minute.", 429);
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
    const { msg } = this.insertMessage({ id: body.id, channel: "buy:" + id, sender: id, kind: "text", body: text, meta: this.pieceMeta(artist.id, body) });
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
      gallery: artist ? this.gallery(artist.id) : null,
      show: this.showInfo(show),
      messages: rows.map((r) => this.rowToMsg(r)),
      lastSeq: this.maxSeq(),
    });
  }

  buyerSend(p, body, show) {
    if (this.floodCheck(p.id)) return err("You're sending very fast. It'll go through in a moment.", 429);
    const b = this.buyer(p.id);
    if (!this.member(b.artist_id)) return err("This artist isn't in the show chat any more.", 404);
    const text = clean(body.body, LIMITS.body);
    const photo = this.photoMeta(body);
    if (!text && !photo) return err("Write a message first.");
    const pm = this.pieceMeta(b.artist_id, body);
    const meta = photo || pm ? { ...(photo || {}), ...(pm || {}) } : null;
    const before = this.maxSeq();
    const { msg } = this.insertMessage({ id: body.id, channel: "buy:" + b.id, sender: b.id, kind: "text", body: text, meta });
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
    if (mailReady(this.env)) this.ctx.waitUntil(this.mailFor(msg, show, visible).catch((e) => console.warn("mail", String(e))));
    if (ownerMailReady(this.env)) this.ctx.waitUntil(this.mailOwner(msg, show).catch((e) => console.warn("owner mail", String(e))));
  }

  // ---------- owner copy: buyer messages and carry-on requests go to OWNER_EMAIL ----------
  async mailOwner(msg, show) {
    if (!msg.ch.startsWith("buy:") || msg.from !== msg.ch.slice(4)) return;
    if (msg.kind !== "text" && msg.kind !== "move") return;
    const b = this.buyer(msg.from);
    const artist = b && this.member(b.artist_id);
    if (!b || !artist) return;
    // Every carry-on request is sent; ordinary messages at most once per buyer every 5 minutes.
    if (msg.kind === "text" && this.mailThrottled("o:" + b.id, 5 * 60e3)) return;
    const who = b.name || "A buyer";
    const at = `${artist.name}${artist.booth ? ` (Booth ${artist.booth})` : ""}`;
    const contact = [b.phone ? `Phone: ${b.phone}` : "", b.email ? `Email: ${b.email}` : ""].filter(Boolean);
    const move = msg.kind === "move" ? msg.meta.to : "";
    const rows = move
      ? this.sql.exec("SELECT * FROM messages WHERE channel = ? ORDER BY seq", msg.ch).toArray()
      : this.sql.exec("SELECT * FROM messages WHERE channel = ? AND seq <= ? ORDER BY seq DESC LIMIT 6", msg.ch, msg.seq).toArray().reverse();
    const tel = b.phone.replace(/[^\d+]/g, "");
    const intro = move === "text"
      ? `${who} asked ${at} to text them${b.phone ? ` at ${b.phone}` : ", but didn't leave a phone number"}.`
      : move === "email"
        ? `${who} asked ${at} to carry on by email${b.email ? ` at ${b.email}` : ""}.`
        : move === "instagram"
          ? `${who} is carrying on with ${at} on Instagram.`
          : `${who} messaged ${at} from the QR card at ${show.name}.`;
    const m = renderMail({
      intro,
      blocks: this.mailBlocks(rows, b, artist),
      cta: tel ? `Text ${who}` : "",
      ctaUrl: tel ? `sms:${tel}` : "",
      footer: [...contact, `Show: ${show.name} (code ${this.code})`],
    });
    const subject = move ? `${who} wants ${move === "text" ? "a text" : move === "email" ? "an email" : "Instagram"} · ${artist.name}` : `Buyer message for ${artist.name}`;
    await sendMail(this.env, { owner: true, subject, ...m, replyTo: b.email, tag: move ? "owner-move" : "owner-msg" });
  }

  // ---------- automatic email (only when RESEND_API_KEY and MAIL_FROM are set) ----------
  buyerLink(b) {
    return `${this.origin}/b/${this.code}/${b.artist_id}?k=${b.link_key}`;
  }
  mailBlocks(rows, b, artist) {
    return rows
      .filter((r) => r.kind === "text")
      .map((r) => {
        const meta = r.meta ? JSON.parse(r.meta) : null;
        return {
          who: r.sender === artist.id ? artist.name : b.name || "You",
          text: (meta && meta.piece ? `About ${meta.piece}: ` : "") + (r.body || ""),
          img: meta && (meta.img || meta.pimg) ? `${this.origin}/api/show/${this.code}/img/${meta.img || meta.pimg}` : "",
        };
      });
  }
  hasPush(id) {
    return this.sql.exec("SELECT COUNT(*) AS n FROM subs WHERE principal = ?", id).one().n > 0;
  }
  // At most one email per key in the window, so a quick back-and-forth doesn't flood an inbox.
  mailThrottled(key, ms) {
    const last = this.kvGet("mail:" + key) || 0;
    if (Date.now() - last < ms) return true;
    this.kvSet("mail:" + key, Date.now());
    return false;
  }
  async mailFor(msg, show, visible) {
    const env = this.env;
    const where = (a) => [a.booth ? `Booth ${a.booth}` : "", show.name].filter(Boolean).join(", ");
    const first = (n) => String(n || "the artist").split(/\s+/)[0];
    const jobs = [];

    if (msg.ch.startsWith("buy:")) {
      const b = this.buyer(msg.ch.slice(4));
      const artist = b && this.member(b.artist_id);
      if (!b || !artist) return;
      const link = this.buyerLink(b);
      const artistLink = `${this.origin}/s/${this.code}#buy:${b.id}`;
      const thisRow = this.sql.exec("SELECT * FROM messages WHERE seq = ?", msg.seq).toArray();

      if (msg.from === artist.id && msg.kind === "text" && b.email && !visible.has(b.id)) {
        // The artist replied and the buyer isn't looking at the page: email the reply.
        const m = renderMail({
          intro: `${artist.name} (${where(artist)}) replied to your message:`,
          blocks: this.mailBlocks(thisRow, b, artist),
          cta: "Open the conversation",
          ctaUrl: link,
          footer: [artist.email ? `Reply to this email to reach ${first(artist.name)} directly, or keep chatting at the link.` : "Keep chatting at the link. Replies to this email aren't read."],
        });
        jobs.push(sendMail(env, { to: b.email, subject: `${artist.name} replied`, ...m, replyTo: artist.email, tag: "reply" }));
      }

      if (msg.from === b.id) {
        const count = this.sql.exec("SELECT COUNT(*) AS n FROM messages WHERE channel = ? AND kind = 'text'", msg.ch).one().n;
        if (msg.kind === "text" && count === 1 && b.email) {
          // First message: give the buyer their private link so they can always get back to the chat.
          const m = renderMail({
            intro: `Your message reached ${artist.name} (${where(artist)}). Their reply will come to this email, and you can keep chatting at your private link.`,
            blocks: this.mailBlocks(thisRow, b, artist),
            cta: "Open the conversation",
            ctaUrl: link,
            footer: ["This link is private to you. Keep it to come back to the conversation."],
          });
          jobs.push(sendMail(env, { to: b.email, subject: `Your message to ${artist.name}`, ...m, replyTo: artist.email, tag: "confirm" }));
        }
        if (msg.kind === "move" && msg.meta && msg.meta.to === "email") {
          const rows = msg.meta.all
            ? this.sql.exec("SELECT * FROM messages WHERE channel = ? ORDER BY seq", msg.ch).toArray()
            : this.sql.exec("SELECT * FROM messages WHERE channel = ? AND kind = 'text' ORDER BY seq DESC LIMIT 1", msg.ch).toArray();
          const blocks = this.mailBlocks(rows, b, artist);
          if (b.email) {
            const m = renderMail({
              intro: `Here's your conversation with ${artist.name} (${where(artist)}).${artist.email ? ` Reply to this email to carry on with ${first(artist.name)} directly.` : ""}`,
              blocks, cta: "Open the conversation", ctaUrl: link,
              footer: artist.email ? [] : [`${first(artist.name)} will reply by email.`],
            });
            jobs.push(sendMail(env, { to: b.email, subject: `Your conversation with ${artist.name}`, ...m, replyTo: artist.email, tag: "move" }));
          }
          if (artist.email) {
            const m = renderMail({
              intro: `${b.name || "A buyer"} from your QR card asked to carry on by email.${b.email ? " Reply to this email to answer them directly." : " They didn't leave an email, so reply in Show Chat."}`,
              blocks, cta: "Open in Show Chat", ctaUrl: artistLink,
            });
            jobs.push(sendMail(env, { to: artist.email, subject: `${b.name || "A buyer"} wants to carry on by email`, ...m, replyTo: b.email, tag: "move-artist" }));
          }
        } else if (artist.email && !visible.has(artist.id) && !this.hasPush(artist.id) && !this.mailThrottled("a:" + b.id, 10 * 60e3)) {
          // The artist has no app alerts set up: email them about the buyer instead.
          const m = renderMail({
            intro: msg.kind === "move" ? `${b.name || "A buyer"} from your QR card wants to carry on by ${msg.meta.to === "text" ? "text" : msg.meta.to}.` : `${b.name || "A buyer"} sent you a message from your QR card:`,
            blocks: this.mailBlocks(thisRow, b, artist),
            cta: "Reply in Show Chat",
            ctaUrl: artistLink,
            footer: [b.email ? "Reply to this email to answer them by email instead." : "Turn on alerts in Show Chat to get these on your phone."],
          });
          jobs.push(sendMail(env, { to: artist.email, subject: `Buyer message from ${b.name || "your QR card"}`, ...m, replyTo: b.email, tag: "artist-alert" }));
        }
      }
    } else if ((msg.kind === "ref" && msg.meta && msg.meta.to) || (msg.ch === "ann" && msg.meta && msg.meta.urgent)) {
      // Time-sensitive: email artists who can't get app alerts.
      const ids = msg.kind === "ref" ? [msg.meta.to] : this.recipients(msg);
      const sender = this.member(msg.from);
      for (const id of ids) {
        const a = this.member(id);
        if (!a || !a.email || visible.has(id) || this.hasPush(id)) continue;
        const isRef = msg.kind === "ref";
        const m = renderMail({
          intro: isRef ? `${sender ? sender.name : "Another artist"}${sender && sender.booth ? ` (Booth ${sender.booth})` : ""} is sending a buyer your way.` : `Urgent announcement from ${show.name}:`,
          blocks: msg.body ? [{ who: sender ? sender.name : show.name, text: msg.body + (isRef && msg.meta.status ? ` · ${msg.meta.status}` : "") }] : [],
          cta: "Open Show Chat",
          ctaUrl: `${this.origin}/s/${this.code}#group`,
          footer: ["Turn on alerts in Show Chat to get these on your phone."],
        });
        jobs.push(sendMail(env, { to: a.email, subject: isRef ? "Buyer heading your way" : `Urgent: ${show.name}`, ...m, tag: isRef ? "ref" : "ann" }));
      }
    }
    await Promise.allSettled(jobs);
  }

  pushContent(msg, to, show) {
    const sender = msg.from.startsWith("b") ? this.buyer(msg.from) : this.member(msg.from);
    const senderName = sender ? sender.name || "A visitor" : "Show Chat";
    const base = `/s/${this.code}`;
    const snip = (s) => (s.length > 140 ? s.slice(0, 137) + "…" : s);
    if (msg.kind === "system") return null;
    if (!msg.body && msg.meta && msg.meta.img) msg = { ...msg, body: "Sent a photo" };
    if (msg.kind === "move") return { title: `${senderName} moved to ${msg.meta.to === "text" ? "text" : msg.meta.to}`, body: snip(msg.body), url: base + "#" + msg.ch, tag: "buy-" + msg.ch.slice(4), urgent: true };
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

  // ---------- photos ----------
  async upload(p, req) {
    const type = (req.headers.get("content-type") || "").split(";")[0].trim();
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type)) return err("Send a photo (JPEG, PNG, WebP or GIF).");
    const buf = await req.arrayBuffer();
    if (!buf.byteLength) return err("That photo was empty.");
    if (buf.byteLength > 1900000) return err("That photo is too big. Try a smaller one.", 413);
    const recent = this.sql.exec("SELECT COUNT(*) AS n FROM images WHERE owner = ? AND created > ?", p.id, Date.now() - 3600e3).one().n;
    if (recent > 120) return err("Too many photos in the last hour.", 429);
    const id = newToken().slice(0, 24);
    this.sql.exec("INSERT INTO images (id, owner, type, size, data, created) VALUES (?, ?, ?, ?, ?, ?)", id, p.id, type, buf.byteLength, buf, Date.now());
    return json({ id, url: `/api/show/${this.code}/img/${id}` });
  }
  image(id) {
    if (!/^[A-Za-z0-9]{16,40}$/.test(id)) return err("Not found", 404);
    const row = this.sql.exec("SELECT type, data FROM images WHERE id = ?", id).toArray()[0];
    if (!row) return err("Not found", 404);
    return new Response(row.data, { headers: { "content-type": row.type, "cache-control": "public, max-age=31536000, immutable" } });
  }

  // A buyer chose to carry on by text, email or Instagram. The artist sees a note in the chat.
  buyerMove(p, body, show) {
    const b = this.buyer(p.id);
    const to = ["text", "email", "instagram"].includes(body.to) ? body.to : null;
    if (!to) return err("Pick text, email or Instagram.");
    this.sql.exec("UPDATE buyers SET moved = ? WHERE id = ?", to, b.id);
    const who = b.name || "This buyer";
    const label = { text: "text message", email: "email", instagram: "Instagram" }[to];
    const { msg } = this.insertMessage({
      id: body.id, channel: "buy:" + b.id, sender: b.id, kind: "move",
      body: `${who} moved this conversation to ${label}${body.all ? " and took the whole thread with them" : ""}.`, meta: { to, all: !!body.all },
    });
    this.notify(msg, show);
    return json({ message: msg, buyer: this.publicBuyer(this.buyer(b.id)) });
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
