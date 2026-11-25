# Art Show Chat

A show chat for art fair exhibitors, show directors and their buyers. Beta 1.0, built for Red Dot Miami.

- **Show chat:** a group chat for everyone exhibiting at the show.
- **Direct messages:** one-to-one chats between exhibitors, saved over time.
- **Refer a buyer:** send a buyer to another artist, who gets a heads-up alert.
- **Announcements:** the director posts to every exhibitor. Urgent ones stay pinned, with a count of how many phones each one reached.
- **Buyer QR cards:** each artist has a printable card. Buyers scan it and message the artist with no app or account, and can keep the conversation going later. Phone (for a text back) is asked first, then email. Artists can also link their Instagram.
- **Booth and pieces:** once the booth is set up, an artist adds booth shots and a photo of each piece (title, price, sold). Buyers who scan the card see them at the top of the chat and can tap a piece to ask about it, so the artist sees exactly which piece the message is about.
- **Visitor app:** one show QR (on tickets, the entrance and the map) opens the show for visitors, no account or download. They type a booth number or scan a booth's card, tap a heart on pieces and booths they like, take their own photos at booths that aren't on Show Chat, and see all their favorites in one list. They can leave an email for one recap after the fair, and separately choose whether artists and the show may contact them.
- **Booth claiming:** booths visitors saved before the artist joined show up for the director, who prints claim cards ("3 visitors saved your work"). The artist scans, joins with the booth filled in, and sees what was saved.
- **Visitor numbers:** each artist sees saves and asks per piece, visitors who stopped by, busiest hours, an anonymous rank in the show, and the visitors who said yes to hearing from them. The director's Visitors tab shows totals by booth (visits, scans, saves), busiest hours, unclaimed booths and the contacts visitors chose to share with the show, as a CSV. Shows never see sales, prices, chats or buyers; artists can keep their name out of the report, or choose to share their results.
- **Recorded sales:** artists can record a sale (no payment moves). If the show sets a commission, sales recorded under it are shared with the show with the commission worked out; otherwise only sales the artist chooses to share.
- **Bad signal:** messages queue on the phone and send by themselves when signal returns. The app opens offline.
- **Alerts:** web push on Android and desktop, and on iPhone once Show Chat is added to the Home Screen (iOS 16.4+).

## How it runs

One Cloudflare Worker serves the app (`public/`) and the API (`src/worker.js`). Each show is a SQLite-backed Durable Object, so there is no database to create and nothing to pay for on the free plan. Push alerts use Web Push with keys the Worker makes and keeps itself (`src/webpush.js`).

## Deploy

Connect this repo to Cloudflare Workers (Workers & Pages, Create, Import a repository). Name the Worker `art-show-chat` to match `wrangler.jsonc`, and keep the default build settings (deploy command `npx wrangler deploy`). Every push to `main` deploys.

## Email (optional, free with Resend)

Email stays off until you add secrets to the Worker in Cloudflare (Workers & Pages > art-show-chat > Settings > Variables and Secrets, type Secret). Secrets survive every deploy.

- `RESEND_API_KEY`: an API key from resend.com.
- `OWNER_EMAIL`: your own address. You get every buyer's first message (then at most one email per buyer every 5 minutes) and every "text me" or "email me" request, with the conversation and a Text button. This works with Resend's test sender, as long as it's the address your Resend account is under.
- `MAIL_FROM` (later): a sender on a domain verified in Resend, such as `Show Chat <chat@yourdomain.com>`. With it, Show Chat also emails buyers their private link and each artist reply, sends "email me" conversations, and emails artists who haven't turned on app alerts. It also turns on the director's **Send recap emails** button for visitors' favorites (nothing is sent until the director presses it, and each visitor gets it once).

Test it locally with `npm run test:mail`, which uses a fake Resend server.

## Develop

```
npm install
npm run dev
```

Then, with the dev server running, `npm test` runs the push encryption check and the end-to-end API checks, `node test/ui.test.mjs` runs the screen checks, `node test/gallery.test.mjs` checks booth and piece photos, and `node test/visitor.test.mjs` and `node test/visitor-ui.test.mjs` check the visitor app.

## Using it

1. Director: open the site, tap **Start a show chat**, pick a show code (for example `REDDOT`).
2. Share the invite. Artists open the link or type the code, then add their name, booth and Instagram.
3. Each artist adds booth and piece photos from **Buyers → Booth and pieces** once they're set up.
4. Print QR cards from **You → Print QR cards for all artists** (four per letter page). The director's set includes the visitor QR.
5. Director: the **Visitors** tab has the visitor QR, an optional map photo, the numbers, and claim cards for booths visitors saved.
