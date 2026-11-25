// Group chats, DMs, announcements, reactions and profiles, against a running server (npm run dev).
// A director and six artists: five of them in a group, one left out.
const BASE = process.env.BASE || "http://127.0.0.1:8787";
const call = async (path, { method = "GET", body, token } = {}) => {
  const r = await fetch(BASE + "/api" + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
};
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } else console.log("ok -", m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const code = "G" + Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, "C");
let r = await call("/create", { method: "POST", body: { name: "Red Dot Groups", director: "Isaac", code } });
const dir = { token: r.data.token };
r = await call(`/show/${code}/sync?since=0`, { token: dir.token }); dir.id = r.data.me.id;

const names = ["Maya Lindqvist", "Leo Park", "Ana Ruiz", "Tom Okafor", "Jun Mori", "Sara Bell"];
const art = [];
for (const [i, name] of names.entries()) {
  r = await call(`/show/${code}/join`, { method: "POST", body: { name, booth: "A" + (i + 1), medium: "Painting" } });
  art.push({ name, token: r.data.token, id: r.data.me.id });
}
assert(art.every((a) => a.token), "six artists join");

// Live sockets for everyone, so we can see who gets what.
const live = new Map();
async function open(p) {
  const ws = new WebSocket(BASE.replace("http", "ws") + `/api/show/${code}/ws?t=${p.token}`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const got = []; ws.onmessage = (e) => { if (e.data !== "pong") got.push(JSON.parse(e.data)); };
  live.set(p.id, { ws, got });
}
for (const p of [dir, ...art]) await open(p);
const got = (p) => live.get(p.id).got;
const clear = () => { for (const v of live.values()) v.got.length = 0; };

// ---- a group of 5: Maya starts it with four others; Sara is left out ----
const [maya, leo, ana, tom, jun] = art, sara = art[5];
r = await call(`/show/${code}/group/create`, { method: "POST", token: maya.token, body: { id: "gtest123", name: "Aisle A", members: [leo.id, ana.id, tom.id, jun.id] } });
assert(r.status === 200 && r.data.group.members.length === 5 && r.data.group.creator === maya.id, "Maya starts a group of 5");
const gid = r.data.group.id, gch = "g:" + gid;
r = await call(`/show/${code}/group/create`, { method: "POST", token: maya.token, body: { id: "gtest123", name: "Aisle A", members: [leo.id] } });
assert(r.status === 200 && r.data.group.members.length === 5, "starting it twice (a retry on bad signal) doesn't make a second group");
r = await call(`/show/${code}/group/create`, { method: "POST", token: maya.token, body: { members: [] } });
assert(r.status === 400, "a group needs at least one other person");

await sleep(300); clear();
r = await call(`/show/${code}/send`, { method: "POST", token: leo.token, body: { id: "gm1", channel: gch, body: "Lunch at 1?" } });
assert(r.status === 200, "Leo posts in the group");
const gseq = r.data.message.seq;
await sleep(400);
assert([maya, ana, tom, jun].every((p) => got(p).some((d) => d.t === "msg" && d.m.ch === gch)), "the other 4 members get it live");
assert(!got(sara).some((d) => d.t === "msg" && d.m.ch === gch) && !got(dir).some((d) => d.t === "msg" && d.m.ch === gch), "Sara and the director, not in the group, don't");

r = await call(`/show/${code}/sync?since=0`, { token: sara.token });
assert(!r.data.messages.some((m) => m.ch === gch) && !r.data.groups.some((g) => g.id === gid), "Sara can't read the group or see it in her list");
r = await call(`/show/${code}/send`, { method: "POST", token: sara.token, body: { id: "gm-x", channel: gch, body: "Let me in" } });
assert(r.status === 403, "Sara can't post in it");
r = await call(`/show/${code}/react`, { method: "POST", token: sara.token, body: { seq: gseq, e: "heart" } });
assert(r.status === 403, "Sara can't react in it");
r = await call(`/show/${code}/sync?since=0`, { token: tom.token });
assert(r.data.groups.find((g) => g.id === gid).name === "Aisle A" && r.data.messages.some((m) => m.seq === gseq), "Tom sees the group and its messages");

r = await call(`/show/${code}/group/members`, { method: "POST", token: leo.token, body: { id: gid, add: [sara.id] } });
assert(r.status === 403, "only Maya, who started it, can add people");
r = await call(`/show/${code}/group/members`, { method: "POST", token: maya.token, body: { id: gid, add: [sara.id], remove: [jun.id] } });
assert(r.status === 200 && r.data.group.members.includes(sara.id) && !r.data.group.members.includes(jun.id), "Maya adds Sara and removes Jun");
r = await call(`/show/${code}/send`, { method: "POST", token: jun.token, body: { id: "gm-j", channel: gch, body: "still here?" } });
assert(r.status === 403, "Jun can't post after being removed");
r = await call(`/show/${code}/group/rename`, { method: "POST", token: maya.token, body: { id: gid, name: "Aisle A crew" } });
assert(r.status === 200 && r.data.group.name === "Aisle A crew", "Maya renames it");
r = await call(`/show/${code}/group/leave`, { method: "POST", token: maya.token, body: { id: gid } });
r = await call(`/show/${code}/sync?since=0`, { token: leo.token });
const g2 = r.data.groups.find((g) => g.id === gid);
assert(g2 && !g2.members.includes(maya.id) && g2.creator === leo.id, "when Maya leaves, Leo looks after the group");

// ---- a DM between two artists ----
clear();
const dm = "dm:" + [ana.id, tom.id].sort().join(":");
r = await call(`/show/${code}/send`, { method: "POST", token: ana.token, body: { id: "dm1", channel: dm, body: "Got bubble wrap?" } });
assert(r.status === 200, "Ana DMs Tom");
await sleep(400);
assert(got(tom).some((d) => d.t === "msg" && d.m.ch === dm), "Tom gets the DM live");
assert(!art.filter((p) => p !== ana && p !== tom).some((p) => got(p).some((d) => d.t === "msg" && d.m.ch === dm)), "nobody else gets it");
r = await call(`/show/${code}/send`, { method: "POST", token: leo.token, body: { id: "dm-x", channel: dm, body: "hi" } });
assert(r.status === 403, "Leo can't post into Ana and Tom's DM");

// ---- a referral goes as a DM to the artist the buyer is sent to ----
const dmRef = "dm:" + [maya.id, sara.id].sort().join(":");
r = await call(`/show/${code}/send`, { method: "POST", token: maya.token, body: { id: "ref1", channel: dmRef, kind: "ref", body: "Wants a big blue one", meta: { to: sara.id, status: "Walking over now" } } });
assert(r.status === 200 && r.data.message.kind === "ref", "Maya refers a buyer to Sara by DM");
r = await call(`/show/${code}/send`, { method: "POST", token: maya.token, body: { id: "ref2", channel: dmRef, kind: "ref", body: "x", meta: { to: leo.id } } });
assert(r.status === 400 || r.status === 403, "a DM referral must be for the other person in the DM");

// ---- one-way announcement from the director ----
clear();
r = await call(`/show/${code}/send`, { method: "POST", token: dir.token, body: { id: "ann1", channel: "ann", body: "Doors open at 11", meta: { urgent: true } } });
assert(r.status === 200, "director sends an announcement");
const aseq = r.data.message.seq;
await sleep(400);
assert(art.every((p) => got(p).some((d) => d.t === "msg" && d.m.ch === "ann")), "all six artists get it live");
r = await call(`/show/${code}/send`, { method: "POST", token: leo.token, body: { id: "ann-x", channel: "ann", body: "me too" } });
assert(r.status === 403, "artists can't send announcements");

// ---- the Show tab can be made announcements only ----
r = await call(`/show/${code}/send`, { method: "POST", token: leo.token, body: { id: "s1", channel: "group", body: "Morning all" } });
assert(r.status === 200, "artists can post in the Show chat by default");
r = await call(`/show/${code}/show`, { method: "POST", token: dir.token, body: { artistsPost: false } });
assert(r.status === 200 && r.data.show.artistsPost === false, "director turns the Show chat to announcements only");
r = await call(`/show/${code}/send`, { method: "POST", token: leo.token, body: { id: "s2", channel: "group", body: "Still here" } });
assert(r.status === 403, "then artists can't post there");
r = await call(`/show/${code}/send`, { method: "POST", token: dir.token, body: { id: "s3", channel: "group", body: "Thanks all" } });
assert(r.status === 200, "but the director can");
r = await call(`/show/${code}/show`, { method: "POST", token: dir.token, body: { artistsPost: true } });
assert(r.data.show.artistsPost === true, "and can turn it back on");

// ---- reactions ----
clear();
r = await call(`/show/${code}/react`, { method: "POST", token: tom.token, body: { seq: gseq, e: "heart" } });
assert(r.status === 200, "Tom hearts Leo's group message");
await sleep(400);
assert([leo, ana, sara].every((p) => got(p).some((d) => d.t === "react" && d.seq === gseq && d.who === tom.id && d.e === "heart")), "group members see the heart live");
assert(!got(jun).some((d) => d.t === "react") && !got(dir).some((d) => d.t === "react"), "people outside the group don't");
r = await call(`/show/${code}/react`, { method: "POST", token: tom.token, body: { seq: gseq, e: "haha" } });
r = await call(`/show/${code}/react`, { method: "POST", token: ana.token, body: { seq: gseq, e: "haha" } });
r = await call(`/show/${code}/sync?since=0&r=0`, { token: leo.token });
const mine = r.data.reactions.filter((x) => x.seq === gseq && x.e);
assert(mine.length === 2 && mine.every((x) => x.e === "haha"), "one reaction per person: Tom's heart became a laugh, Ana laughed too");
const rs = r.data.rseq;
r = await call(`/show/${code}/react`, { method: "POST", token: tom.token, body: { seq: gseq, e: "" } });
r = await call(`/show/${code}/sync?since=999999&r=${rs}`, { token: leo.token });
assert(r.data.reactions.length === 1 && r.data.reactions[0].who === tom.id && r.data.reactions[0].e === "", "tapping again takes it off, and a later sync says so");
r = await call(`/show/${code}/react`, { method: "POST", token: tom.token, body: { seq: gseq, e: "fire" } });
assert(r.status === 400, "only the six reactions are allowed");
for (const e of ["up", "down", "bang", "q"]) { r = await call(`/show/${code}/react`, { method: "POST", token: sara.token, body: { seq: aseq, e } }); assert(r.status === 200, `artists can react ${e} to an announcement`); }

// ---- profiles: private shows only name and photo to other artists ----
r = await call(`/show/${code}/me`, { method: "POST", token: ana.token, body: { bio: "Large abstract florals", private: true } });
assert(r.status === 200 && r.data.me.private && r.data.me.bio === "Large abstract florals", "Ana makes her profile private");
r = await call(`/show/${code}/sync?since=999999`, { token: tom.token });
const seen = r.data.members.find((m) => m.id === ana.id);
assert(seen.name === "Ana Ruiz" && seen.private && !seen.bio && !seen.medium && !seen.booth, "Tom sees only her name and photo");
r = await call(`/show/${code}/sync?since=999999`, { token: dir.token });
assert(r.data.members.find((m) => m.id === ana.id).bio === "Large abstract florals", "the director still sees her full profile");
r = await call(`/show/${code}/artist?id=${ana.id}`);
assert(r.data.artist.booth === "A3", "her buyer QR page is unchanged");
r = await call(`/show/${code}/me`, { method: "POST", token: ana.token, body: { photo: "notmyphoto1234567890" } });
assert(r.status === 400, "a profile photo must be one she uploaded");

// ---- typing dots go only to the others in that chat ----
clear();
live.get(leo.id).ws.send(JSON.stringify({ t: "typing", ch: gch }));
live.get(ana.id).ws.send(JSON.stringify({ t: "typing", ch: dm }));
live.get(jun.id).ws.send(JSON.stringify({ t: "typing", ch: gch }));
live.get(leo.id).ws.send(JSON.stringify({ t: "typing", ch: "ann" }));
await sleep(400);
assert([ana, tom, sara].every((p) => got(p).some((d) => d.t === "typing" && d.ch === gch && d.who === leo.id)), "group members see Leo typing in the group");
assert(!got(jun).some((d) => d.t === "typing" && d.ch === gch) && !got(dir).some((d) => d.t === "typing" && d.ch === gch) && !got(leo).some((d) => d.t === "typing" && d.who === leo.id), "people outside the group, and Leo himself, don't");
assert(got(tom).some((d) => d.t === "typing" && d.ch === dm && d.who === ana.id) && !got(leo).some((d) => d.t === "typing" && d.ch === dm), "DM typing reaches only the other person");
assert(!art.some((p) => got(p).some((d) => d.t === "typing" && d.who === jun.id)) && !art.some((p) => got(p).some((d) => d.t === "typing" && d.ch === "ann")), "removed members and announcements send no dots");

for (const v of live.values()) v.ws.close();
console.log("\nAll group, DM, announcement, reaction and profile checks passed.");
process.exit(0);
