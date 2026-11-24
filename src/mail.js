// Automatic email through Resend (free tier). Everything stays off until the Worker secrets are set.
//   RESEND_API_KEY  the API key from resend.com
//   OWNER_EMAIL     your own address: gets a copy of every buyer message and "text me" request.
//                   Works with Resend's test sender, which can only email the Resend account's own address.
//   MAIL_FROM       optional, a sender on a domain verified in Resend, e.g. "Show Chat <chat@example.com>".
//                   Only with this set does Show Chat email buyers and artists directly.

const okEmail = (s) => typeof s === "string" && /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(s) && s.length <= 120;

export function mailReady(env) {
  return !!(env && env.RESEND_API_KEY && env.MAIL_FROM && /@/.test(env.MAIL_FROM) && !/resend\.dev/i.test(env.MAIL_FROM));
}
export function ownerMailReady(env) {
  return !!(env && env.RESEND_API_KEY && okEmail(String(env.OWNER_EMAIL || "").trim()));
}

export function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// blocks: [{ who, text, img, ts }]; footer lines are plain text and may hold one link each.
export function renderMail({ intro, blocks = [], cta, ctaUrl, footer = [] }) {
  const lines = [intro, ""];
  for (const b of blocks) {
    lines.push(`${b.who}:`);
    if (b.text) lines.push(b.text);
    if (b.img) lines.push(`Photo: ${b.img}`);
    lines.push("");
  }
  if (ctaUrl) lines.push(`${cta}: ${ctaUrl}`, "");
  lines.push(...footer);
  const text = lines.join("\n").trim() + "\n";

  const msgHtml = blocks
    .map(
      (b) => `<tr><td style="padding:0 0 14px">
        <div style="font-size:12px;color:#5d6a68;margin:0 0 4px">${escHtml(b.who)}</div>
        ${b.img ? `<a href="${escHtml(b.img)}"><img src="${escHtml(b.img)}" alt="Photo" width="260" style="display:block;max-width:260px;border-radius:12px;margin:0 0 6px"></a>` : ""}
        ${b.text ? `<div style="background:#eef2f1;border-radius:14px;padding:10px 13px;font-size:15px;line-height:1.45;white-space:pre-wrap">${escHtml(b.text)}</div>` : ""}
      </td></tr>`
    )
    .join("");
  const html = `<!doctype html><html><body style="margin:0;background:#eef1ef;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#17201f">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1ef;padding:20px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:22px 20px">
    <tr><td style="font-size:15px;line-height:1.5;padding:0 0 16px">${escHtml(intro)}</td></tr>
    ${msgHtml}
    ${ctaUrl ? `<tr><td style="padding:6px 0 16px"><a href="${escHtml(ctaUrl)}" style="display:inline-block;background:#0d6b63;color:#ffffff;text-decoration:none;font-weight:600;border-radius:12px;padding:12px 18px">${escHtml(cta)}</a></td></tr>` : ""}
    ${footer.map((f) => `<tr><td style="font-size:12.5px;color:#5d6a68;line-height:1.5">${escHtml(f)}</td></tr>`).join("")}
  </table></td></tr></table></body></html>`;
  return { text, html };
}

export async function sendMail(env, { to, subject, text, html, replyTo, tag, owner }) {
  if (owner) to = String(env.OWNER_EMAIL || "").trim();
  if (!(owner ? ownerMailReady(env) : mailReady(env)) || !okEmail(to)) return { ok: false, skipped: true };
  const from = mailReady(env) ? env.MAIL_FROM : "Show Chat <onboarding@resend.dev>";
  const body = { from, to: [to], subject: subject.slice(0, 180), text, html };
  if (okEmail(replyTo)) body.reply_to = replyTo;
  if (tag) body.tags = [{ name: "kind", value: tag }];
  try {
    const res = await fetch(env.RESEND_API_URL || "https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.warn("mail status", res.status, (await res.text()).slice(0, 200));
    return { ok: res.ok, status: res.status };
  } catch (e) {
    console.warn("mail failed", String(e));
    return { ok: false };
  }
}
