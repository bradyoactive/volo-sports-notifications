# volo-sports-notifications
A Cloudflare Worker that emails you when new Volo pickup sessions are posted.

## Setup
1. Turn on Email Routing for the domain you'll send from, and add your inbox as a verified destination.
2. Install and deploy, then set the email addresses as secrets so they stay out of git:
   ```bash
   npm install
   npm run deploy
   npx wrangler secret put FROM_ADDRESS   # any address on that domain
   npx wrangler secret put TO_ADDRESS     # your inbox
   ```
3. To turn alerts on, set `triggers.crons` to `["*/30 * * * *"]` in `wrangler.jsonc` and deploy again.

## Local dev
Copy `.dev.vars.example` to `.dev.vars` and fill it in, run `npm run dev`, then call `http://localhost:8787/__scheduled`. Emails are written to `.wrangler/tmp/email/` instead of being sent.
