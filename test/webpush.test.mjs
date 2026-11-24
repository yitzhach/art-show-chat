// Round-trip check: encrypt with our Worker code, decrypt with the reference http_ece library, verify the VAPID JWT.
import ece from "http_ece";
import crypto from "node:crypto";
import { encryptPayload, generateVapidKeys, vapidHeader, b64uEncode, b64uDecode } from "../src/webpush.js";
const ua = crypto.createECDH("prime256v1"); ua.generateKeys();
const auth = crypto.randomBytes(16);
const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: b64uEncode(ua.getPublicKey()), auth: b64uEncode(auth) } };
const msg = JSON.stringify({ title: "Buyer heading your way", body: "Wants a big abstract floral ✿" });
const ct = await encryptPayload(sub, msg);
const out = ece.decrypt(Buffer.from(ct), { version: "aes128gcm", privateKey: ua, authSecret: auth });
if (out.toString() !== msg) throw new Error("decrypt mismatch");
const v = await generateVapidKeys();
const hdr = await vapidHeader(sub.endpoint, v, "https://example.workers.dev");
const [, jwt, k] = hdr.match(/^vapid t=([^,]+), k=(.+)$/);
const [h, c, s] = jwt.split(".");
const pub = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64uEncode(b64uDecode(k).slice(1, 33)), y: b64uEncode(b64uDecode(k).slice(33)) }, format: "jwk" });
const ok = crypto.verify("sha256", Buffer.from(h + "." + c), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(b64uDecode(s)));
if (!ok) throw new Error("vapid signature invalid");
console.log("webpush OK:", JSON.parse(Buffer.from(b64uDecode(c)).toString()).aud);
