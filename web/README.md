# Kampein website

What runs at kampein.njautheinvestmentsconsultant.workers.dev today:

| Path | What it is |
|---|---|
| `/` | Landing page with the "Reserve your campaign" form |
| `/r/<code>` | A partner's QR link: counts the scan, credits sign-ups to that partner, opens the landing page |
| `/p/<token>` | A partner's private dashboard: scans, sign-ups, clients and commission |
| `/admin` | Your dashboard: every sign-up, call and WhatsApp buttons, status, notes, M-Pesa payments, partners and their QR codes |
| `/demo/` | The browser demo (sample data, no database) |

`web/worker.js` is the server code; `web/public/` holds the pages. Sign-ups are stored in a
Cloudflare D1 database named `kampein`, which Cloudflare creates on the first deploy. The tables
are created the first time the site is used.

## One-time setup in Cloudflare

1. **Admin key.** Workers & Pages → `kampein` → Settings → Variables and Secrets → Add.
   Type: **Secret**. Name: `ADMIN_KEY`. Value: a long password only you and Muchiri know.
   Deploy. This is what you type at `/admin`.
2. **Check the database.** Workers & Pages → `kampein` → Bindings should show `DB` → D1 `kampein`.
   If the deploy log says it could not create the database, create one under Storage & Databases → D1
   named `kampein`, copy its ID into `wrangler.jsonc` as `"database_id"`, and push.

## Adding a partner

At `/admin` → Partners: name, a short code (it becomes the link, e.g. `/r/manyora`) and the
commission rate (15% by default). Each partner gets a QR code to download for the show and a private
dashboard link to send them on WhatsApp. Commission is the rate times what their referred clients pay,
counted from the payments you record against each sign-up.

## Local testing

Put `ADMIN_KEY="something"` in `.dev.vars` (never committed) and run `npx wrangler dev`.
