// Visitor app: entry by booth number, hearts, favorites, recap contact, booth claiming, artist and show numbers, recorded sales.
// Run against a local Worker: npx wrangler dev --port 8787, then node test/visitor.test.mjs
const BASE = process.env.BASE || "http://127.0.0.1:8787";
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok" : "FAIL"} - ${m}`); if (!c) fails++; };
async function j(path, o = {}) {
  const r = await fetch(BASE + "/api" + path, { method: o.method || "GET", headers: { "content-type": "application/json", ...(o.t ? { authorization: "Bearer " + o.t } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, headers: r.headers };
}
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
async function upload(show, t) {
  const r = await fetch(`${BASE}/api/show/${show}/upload`, { method: "POST", headers: { "content-type": "image/jpeg", authorization: "Bearer " + t }, body: JPEG });
  return (await r.json()).id;
}
const code = "V" + Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, "Q");
const dir = (await j("/create", { method: "POST", body: { name: "Red Dot Test", director: "Dir", code } })).data;
const show = dir.code;
const maya = (await j(`/show/${show}/join`, { method: "POST", body: { name: "Maya Lin", booth: "B12" } })).data;
const omar = (await j(`/show/${show}/join`, { method: "POST", body: { name: "Omar Ruiz", booth: "C-03" } })).data;
const lee = (await j(`/show/${show}/join`, { method: "POST", body: { name: "Lee Park", booth: "D1" } })).data;
const [p1, p2] = [await upload(show, maya.token), await upload(show, maya.token)];
await j(`/show/${show}/gallery`, { method: "POST", t: maya.token, body: { pieces: [{ id: "pvase00001", img: p1, title: "Tall blue vase", price: "$1,800" }, { id: "pbowl00001", img: p2, title: "Ash bowl", price: "$240" }] } });

// Entry
const info = await j(`/show/${show}/visit/info`);
ok(info.status === 200 && info.data.booths.length === 3 && info.data.booths[0].n === "B12", "the show app lists booths on Show Chat, in booth order");
ok(!("phone" in info.data.booths[0]) && !("email" in info.data.booths[0]), "the booth list carries no artist contact details");
const typed = await j(`/show/${show}/visit/booth?b=${encodeURIComponent("booth b-012")}`);
ok(typed.data.booth === "B12" && typed.data.artist && typed.data.artist.name === "Maya Lin" && typed.data.gallery.pieces.length === 2, "typing 'booth b-012' finds Maya at B12 with her pieces");
ok((await j(`/show/${show}/visit/booth?b=c3`)).data.artist.name === "Omar Ruiz", "booth C3 matches an artist who typed C-03");
const none = await j(`/show/${show}/visit/booth?b=F7`);
ok(none.status === 200 && none.data.artist === null && none.data.booth === "F7", "a booth that isn't on Show Chat still opens, with no artist");

// Visitors and hearts
const v1 = (await j(`/show/${show}/visitor/start`, { method: "POST", body: { via: "show" } })).data;
const v2 = (await j(`/show/${show}/visitor/start`, { method: "POST", body: { via: "artist" } })).data;
const v3 = (await j(`/show/${show}/visitor/start`, { method: "POST", body: {} })).data;
ok(v1.token && v1.visitor.id.startsWith("v"), "a visitor starts with no account and gets a private key");
let r = await j(`/show/${show}/visitor/fav`, { method: "POST", t: v1.token, body: { type: "piece", artist: maya.me.id, piece: "pvase00001" } });
ok(r.status === 200 && r.data.fav.piece.title === "Tall blue vase" && r.data.fav.piece.price === "$1,800", "a heart on a piece saves it, with title and price");
await j(`/show/${show}/visitor/fav`, { method: "POST", t: v1.token, body: { type: "piece", artist: maya.me.id, piece: "pvase00001" } });
await j(`/show/${show}/visitor/fav`, { method: "POST", t: v1.token, body: { type: "booth", booth: "f-7", note: "Big red abstracts" } });
const snapImg = await upload(show, v1.token);
r = await j(`/show/${show}/visitor/fav`, { method: "POST", t: v1.token, body: { type: "snap", sid: "snap-abc-123", booth: "F7", img: snapImg } });
ok(r.status === 200 && r.data.fav.img === snapImg && r.data.fav.booth === "F7", "a visitor saves their own photo at a booth that isn't on Show Chat");
const stolen = await j(`/show/${show}/visitor/fav`, { method: "POST", t: v2.token, body: { type: "snap", sid: "snap-xyz-999", booth: "F7", img: snapImg } });
ok(stolen.status === 400, "another visitor's photo can't be saved as yours");
const bad = await j(`/show/${show}/visitor/fav`, { method: "POST", t: v1.token, body: { type: "piece", artist: maya.me.id, piece: "pnope" } });
ok(bad.status === 404, "a piece that isn't on the artist's page can't be saved");
let me = (await j(`/show/${show}/visitor/me`, { t: v1.token })).data;
ok(me.favs.length === 3, "hearting the same piece twice keeps one favorite");
const f7 = me.favs.find((f) => f.k === "b:F7");
ok(f7 && f7.note === "Big red abstracts" && f7.artist === null, "the unclaimed booth is saved with the visitor's note");

await j(`/show/${show}/visitor/fav`, { method: "POST", t: v2.token, body: { type: "piece", artist: maya.me.id, piece: "pvase00001" } });
await j(`/show/${show}/visitor/fav`, { method: "POST", t: v2.token, body: { type: "booth", booth: "F7" } });
await j(`/show/${show}/visitor/fav`, { method: "POST", t: v3.token, body: { type: "booth", artist: omar.me.id } });
r = await j(`/show/${show}/visitor/fav`, { method: "POST", t: v2.token, body: { type: "piece", artist: maya.me.id, piece: "pvase00001", on: false } });
ok(r.status === 200 && r.data.fav === null, "tapping the heart again removes it");
await j(`/show/${show}/visitor/fav`, { method: "POST", t: v2.token, body: { type: "piece", artist: maya.me.id, piece: "pbowl00001" } });

// Visits
const vv = await j(`/show/${show}/visitor/visit`, { method: "POST", t: v1.token, body: { artist: maya.me.id, via: "qr" } });
const vv2 = await j(`/show/${show}/visitor/visit`, { method: "POST", t: v1.token, body: { booth: "b12", via: "booth" } });
ok(vv.data.counted === true && vv2.data.counted === false, "a booth visit counts once in 20 minutes, by QR or typed");
await j(`/show/${show}/visitor/visit`, { method: "POST", t: v2.token, body: { booth: "B12", via: "booth" } });
await j(`/show/${show}/visitor/visit`, { method: "POST", t: v2.token, body: { booth: "F7", via: "booth" } });
await j(`/show/${show}/visitor/visit`, { method: "POST", t: v3.token, body: { artist: omar.me.id, via: "qr" } });

// Recap contact and consent
r = await j(`/show/${show}/visitor/me`, { method: "POST", t: v1.token, body: { email: "nope", recap: true } });
ok(r.status === 400, "a bad email is refused");
r = await j(`/show/${show}/visitor/me`, { method: "POST", t: v1.token, body: { email: "pat@example.com", name: "Pat", recap: true, shareArtists: true, shareShow: false } });
ok(r.data.visitor.recap && r.data.visitor.shareArtists && !r.data.visitor.shareShow, "a visitor adds an email for the recap and chooses who sees it");
await j(`/show/${show}/visitor/me`, { method: "POST", t: v2.token, body: { phone: "555-0100", name: "Sam", shareShow: true } });
ok([403, 404].includes((await j(`/show/${show}/visitor/me`, { t: maya.token })).status), "an artist's key can't open visitor pages");
ok((await j(`/show/${show}/sync?since=0`, { t: v1.token })).status === 404, "a visitor's key can't open the show chat");
ok((await j(`/show/${show}/data`, { t: v1.token })).status === 404, "a visitor's key can't open the show's data");

// Recap email stays off
r = await j(`/show/${show}/recap/send`, { method: "POST", t: dir.token });
ok(r.status === 409, "recap emails are off until email is set up");

// Booth claiming
let claim = await j(`/show/${show}/visit/claim?b=F7`);
ok(claim.data.savers === 2 && claim.data.claimed === false, "an unclaimed booth shows how many visitors saved it");
const fay = (await j(`/show/${show}/join`, { method: "POST", body: { name: "Fay Ortiz", booth: "F7" } })).data;
claim = await j(`/show/${show}/visit/claim?b=F7`);
ok(claim.data.claimed === true, "once the artist joins with that booth number, it's claimed");
me = (await j(`/show/${show}/visitor/me`, { t: v1.token })).data;
ok(me.favs.find((f) => f.k === "b:F7").artist.name === "Fay Ortiz", "visitors' saved booth now links to the artist who claimed it");
const fins = (await j(`/show/${show}/insights`, { t: fay.token })).data;
ok(fins.savers === 2 && fins.early === 2 && fins.visits === 1, "the claiming artist sees the visitors who saved their booth before they joined");
await j(`/show/${show}/visitor/fav`, { method: "POST", t: v3.token, body: { type: "booth", booth: "f7" } });
const fins2 = (await j(`/show/${show}/insights`, { t: fay.token })).data;
ok(fins2.savers === 3 && fins2.early === 2, "a booth number typed after the artist joined counts as a save, not an early one");

// Artist numbers
await j(`/show/${show}/buyer/start`, { method: "POST", body: { id: "q1" + code, artist: maya.me.id, body: "Still available?", pieceId: "pvase00001" } });
const ins = (await j(`/show/${show}/insights`, { t: maya.token })).data;
ok(ins.savers === 2 && ins.perPiece.pvase00001 === 1 && ins.perPiece.pbowl00001 === 1, "the artist sees saves per piece");
ok(ins.pieces[0].id === "pvase00001" && ins.pieces[0].asks === 1, "top pieces count saves and buyer asks");
ok(ins.leads.length === 1 && ins.leads[0].email === "pat@example.com" && ins.leads[0].saved.includes("Tall blue vase"), "only the visitor who said yes to artists shows as a lead, with what they saved");
ok(!JSON.stringify(ins.leads).includes("555-0100"), "a visitor who didn't say yes to artists isn't a lead");
ok(ins.rank && ins.rank.of === 4 && ins.rank.place >= 1, "the artist sees where they rank, without other artists' names");
ok(!JSON.stringify(ins).includes("Omar"), "the artist's numbers don't name other artists");

// Show data: totals only, consented contacts only, privacy switches
await j(`/show/${show}/me`, { method: "POST", t: omar.token, body: { privateStats: true } });
let data = (await j(`/show/${show}/data`, { t: dir.token })).data;
ok(data.totals.visitors === 3 && data.totals.savers === 3 && data.totals.qrScans === 2, "the show sees visitor totals and QR scans");
const b12 = data.booths.find((b) => b.booth === "B12");
ok(b12 && b12.visitors === 2 && b12.savers === 2 && b12.artist.name === "Maya Lin", "the show sees visits and saves per booth");
const c3 = data.booths.find((b) => b.booth === "C3");
ok(c3 && c3.artist === null && c3.claimed === true && c3.savers === 1, "an artist who opted out isn't named in the show's report");
ok(data.contacts.length === 1 && data.contacts[0].phone === "555-0100" && !JSON.stringify(data.contacts).includes("pat@example.com"), "the show sees only contacts that visitors shared with the show");
const blob = JSON.stringify(data);
ok(!blob.includes("$1,800") && !blob.includes("Still available") && !blob.includes("Tall blue vase"), "the show's data has no prices, chats or piece details");
ok(data.shared.length === 0 && data.sales.length === 0, "no artist results or sales are shared by default");
ok((await j(`/show/${show}/data`, { t: maya.token })).status === 403, "artists can't open the show's data");
const csv = await j(`/show/${show}/data/contacts-csv?t=${dir.token}`);
ok(csv.status === 200 && /text\/csv/.test(csv.headers.get("content-type")) && csv.data.includes("555-0100") && !csv.data.includes("pat@"), "the director downloads consented contacts as CSV");

// Map
const mapImg = await upload(show, dir.token);
r = await j(`/show/${show}/map`, { method: "POST", t: dir.token, body: { img: mapImg } });
ok(r.status === 200 && (await j(`/show/${show}/visit/info`)).data.show.map.img === mapImg, "the director adds a show map and visitors get it");
ok((await j(`/show/${show}/map`, { method: "POST", t: dir.token, body: { img: p1 } })).status === 400, "the map has to be the director's own upload");

// Recorded sales and sharing
r = await j(`/show/${show}/sale`, { method: "POST", t: maya.token, body: { piece: "pbowl00001", amount: "$240", source: "show" } });
ok(r.status === 200 && r.data.sale.amount === 24000 && r.data.sale.commissionRate === 0, "an artist records a sale with no payment");
const g = (await j(`/show/${show}/artist?id=${maya.me.id}`)).data.gallery;
ok(g.pieces.find((x) => x.id === "pbowl00001").sold === true, "recording a sale marks the piece sold");
data = (await j(`/show/${show}/data`, { t: dir.token })).data;
ok(data.sales.length === 0, "a show with no commission doesn't see sales the artist didn't share");
await j(`/show/${show}/me`, { method: "POST", t: maya.token, body: { shareStats: true, shareSales: true } });
data = (await j(`/show/${show}/data`, { t: dir.token })).data;
ok(data.sales.length === 1 && data.shared.length === 1 && data.shared[0].savers === 2, "an artist who opts in shares sales and results with the show");
await j(`/show/${show}/me`, { method: "POST", t: maya.token, body: { shareSales: false } });
await j(`/show/${show}/show`, { method: "POST", t: dir.token, body: { commission: 15 } });
r = await j(`/show/${show}/sale`, { method: "POST", t: lee.token, body: { title: "Print", amount: "1000", source: "after" } });
ok(r.data.sale.commissionRate === 15 && r.data.sale.commission === 15000, "with a 15% commission, a sale records the commission owed");
data = (await j(`/show/${show}/data`, { t: dir.token })).data;
ok(data.sales.length === 1 && data.sales[0].artist === "Lee Park" && data.salesTotals.commission === 15000, "a commission show sees sales recorded under its commission, and not older unshared ones");
ok((await j(`/show/${show}/sale`, { method: "POST", t: dir.token, body: { amount: "5" } })).status === 403, "directors can't record sales for artists");
ok((await j(`/show/${show}/insights`, { t: lee.token })).data.salesShared === true, "the artist is told their sales are shared because of the commission");

console.log(fails ? `\n${fails} FAILED` : "\nall visitor checks passed");
process.exit(fails ? 1 : 0);
