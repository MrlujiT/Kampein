# Kampein demo

A click-through demo of Kampein for pitching. It runs entirely in the browser with
sample data (a fictional MP campaign in Kasarani), so it needs no database.
Changes are saved in the viewer's browser only, and "Reset demo" restores the sample data.

Use the **Viewing as** menu to switch between the candidate, campaign manager,
finance lead, a ward coordinator and two data clerks. Each role sees a different view.

## Deploy to Cloudflare (once)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository**.
2. Pick `MrlujiT/kampein`.
3. Set **Root directory** to `demo`. Leave the build command empty.
   The deploy command is `npx wrangler deploy`.
4. Deploy. The demo goes live at `kampein-demo.<your-subdomain>.workers.dev`,
   and every push to `main` redeploys it.

## Map data

- Boundaries: Kenya county, constituency and ward shapes from
  [mikelmaron/kenya-election-data](https://github.com/mikelmaron/kenya-election-data), simplified with mapshaper.
- Registered voters per constituency: IEBC, 2022 general election register (`data/iebc_2022_registered_voters_per_constituency.csv`).
- New voters per county: IEBC, ECVR Phase 1 final status report, 30 April 2026 (`data/iebc_2026_ecvr_new_voters_per_county.csv`).
  IEBC has not published 2026 figures per constituency or ward, so those levels use the 2022 register.
- Kasarani ward figures (IEBC 2022): Ruai 37,361 · Clay City 34,387 · Njiru 28,140 · Mwiki 27,837 · Kasarani 27,525.
- Polling centres and stations (streams): IEBC 2022 register of voters per polling station for Nairobi City County
  (3,643 stations in 378 centres, totalling 2,415,310 voters), via
  [kigenchesire/kenya-polling-stations-data](https://github.com/kigenchesire/kenya-polling-stations-data), in `public/stations.js`.
- `data/build-map.mjs` regenerates `public/geo.js` from the boundaries and the CSVs.
