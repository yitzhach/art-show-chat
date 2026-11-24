# Art Show Chat

A show chat for art fair exhibitors, show directors and their buyers. Beta 1.0, built for Red Dot Miami.

- **Show chat:** a group chat for everyone exhibiting at the show.
- **Direct messages:** one-to-one chats between exhibitors, saved over time.
- **Refer a buyer:** send a buyer to another artist, who gets a heads-up alert.
- **Announcements:** the director posts to every exhibitor. Urgent ones stay pinned, with a count of how many phones each one reached.
- **Buyer QR cards:** each artist has a printable card. Buyers scan it and message the artist with no app or account, and can keep the conversation going later. Phone (for a text back) is asked first, then email. Artists can also link their Instagram.
- **Booth and pieces:** once the booth is set up, an artist adds booth shots and a photo of each piece (title, price, sold). Buyers who scan the card see them at the top of the chat and can tap a piece to ask about it, so the artist sees exactly which piece the message is about.
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
- `MAIL_FROM` (later): a sender on a domain verified in Resend, such as `Show Chat <chat@yourdomain.com>`. With it, Show Chat also emails buyers their private link and each artist reply, sends "email me" conversations, and emails artists who haven't turned on app alerts.

Test it locally with `npm run test:mail`, which uses a fake Resend server.

## Develop

```
npm install
npm run dev
```

Then, with the dev server running, `npm test` runs the push encryption check and the end-to-end API checks, `node test/ui.test.mjs` runs the screen checks, and `node test/gallery.test.mjs` checks booth and piece photos.

## Using it

1. Director: open the site, tap **Start a show chat**, pick a show code (for example `REDDOT`).
2. Share the invite. Artists open the link or type the code, then add their name, booth and Instagram.
3. Each artist adds booth and piece photos from **Buyers → Booth and pieces** once they're set up.
4. Print QR cards from **You → Print QR cards for all artists** (four per letter page).
