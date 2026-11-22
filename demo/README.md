# Kampein demo

A click-through demo of Kampein for pitching. It runs entirely in the browser with
sample data (a fictional MP campaign in Kasarani), so it needs no database.
Changes are saved in the viewer's browser only, and "Reset demo" restores the sample data.

Use the **Viewing as** menu to switch between the candidate, campaign manager,
finance lead, a ward coordinator and two data clerks. Each role sees a different view.

## Where it lives

The demo's files are in `web/public/demo/` and it is served at `/demo/` by the Kampein website worker
(see `web/README.md`). Every push to `main` redeploys it on Cloudflare.

## Seats, places and data

Tap **Change seat & area** to pick a seat (MCA, MP, Woman Rep, Senator, Governor) and the place:
a county, then a constituency (MP, MCA), then a ward (MCA). The demo loads that county's file from
`web/public/demo/data/cNN.json` and builds the campaign from the real register.

- Registered voters, polling centres and polling stations (streams): IEBC 2022 register of voters per
  polling station, all 47 counties (46,096 stations, 22,102,532 voters), via
  [kigenchesire/kenya-polling-stations-data](https://github.com/kigenchesire/kenya-polling-stations-data).
- New voters per county: IEBC ECVR Phase 1 final status report, 30 April 2026
  (`data/iebc_2026_ecvr_new_voters_per_county.csv`). IEBC has not published 2026 figures per constituency or ward.
- Boundaries: county, constituency and ward shapes from
  [mikelmaron/kenya-election-data](https://github.com/mikelmaron/kenya-election-data), simplified with mapshaper.
- `data/build-national.mjs` regenerates `web/public/demo/geo.js` (Kenya map and index of every county, constituency
  and ward) and `web/public/demo/data/` (one file per county with stations and map shapes).
- The candidate, team, money, activity and votes are sample data.
