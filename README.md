# Art Show Chat

A show chat for art fair exhibitors, show directors and their buyers. Beta 1.0, built for Red Dot Miami.

- **Show chat:** a group chat for everyone exhibiting at the show.
- **Direct messages:** one-to-one chats between exhibitors, saved over time.
- **Refer a buyer:** send a buyer to another artist, who gets a heads-up alert.
- **Announcements:** the director posts to every exhibitor. Urgent ones stay pinned, with a count of how many phones each one reached.
- **Buyer QR cards:** each artist has a printable card. Buyers scan it and message the artist with no app or account, and can keep the conversation going later. Phone (for a text back) is asked first, then email. Artists can also link their Instagram.
- **Bad signal:** messages queue on the phone and send by themselves when signal returns. The app opens offline.
- **Alerts:** web push on Android and desktop, and on iPhone once Show Chat is added to the Home Screen (iOS 16.4+).

## How it runs

One Cloudflare Worker serves the app (`public/`) and the API (`src/worker.js`). Each show is a SQLite-backed Durable Object, so there is no database to create and nothing to pay for on the free plan. Push alerts use Web Push with keys the Worker makes and keeps itself (`src/webpush.js`).

## Deploy

Connect this repo to Cloudflare Workers (Workers & Pages, Create, Import a repository). Name the Worker `art-show-chat` to match `wrangler.jsonc`, and keep the default build settings (deploy command `npx wrangler deploy`). Every push to `main` deploys.

## Develop

```
npm install
npm run dev
```

Then, with the dev server running, `npm test` runs the push encryption check and the end-to-end API checks, and `node test/ui.test.mjs` runs the screen checks.

## Using it

1. Director: open the site, tap **Start a show chat**, pick a show code (for example `REDDOT`).
2. Share the invite. Artists open the link or type the code, then add their name, booth and Instagram.
3. Print QR cards from **You → Print QR cards for all artists** (four per letter page).
