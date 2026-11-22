# Kampein

Campaign management for Kenyan candidates (MCA, MP, Senator, Woman Rep, Governor).
Non-partisan, sold per campaign. Each campaign's data is isolated from every other campaign.

**Modules**

| Module | Status |
| --- | --- |
| Campaign structure: wards and polling stations with IEBC registered voters, ward targets | Built (phase 1) |
| Team: candidate, manager, finance, coordinators, agents, clerks, with role-based access | Built (phase 1) |
| Field activity log and leaderboards | Built (phase 1) |
| Budgets, disbursements to named staff/vendors, audit trail | Database done, screens next (phase 2) |
| Telegram bot for field agents | Phase 3 |
| Election day: results-form photos (35A for MP, 36A MCA, 37A Governor, 38A Senator, 39A Woman Rep) and double-entry tallying | Database done, screens in phase 4 |

## Stack

- **Next.js 15** (App Router, server actions) + **Tailwind CSS 4**
- **Supabase**: Postgres, auth, storage, row-level security
- Deploys to Netlify or Vercel

## Rules the database enforces

These are enforced in Postgres itself, so no screen or API call can get around them:

- A user only ever sees campaigns they are a member of.
- Coordinators see their own ward; agents see their own activity.
- Money can only go to registered payees (team members or vendors). There is no voter record anywhere.
- After a disbursement is requested, its amount, payee and purpose cannot change. It can only move
  requested → approved/rejected → paid. Nobody approves their own request. "Paid" needs an M-Pesa or bank reference.
- Disbursements and the audit log cannot be deleted or edited. Every change to team, money and tally tables is logged.
- Each polling-station results form (35A–39A, by seat) needs two entries from two different clerks. If they match, the form is confirmed; if not, it is flagged
  as disputed for a manager to resolve. The tally is internal to the campaign: IEBC alone declares results.

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. In the Supabase SQL editor, run `supabase/migrations/20261120000000_init.sql`
   (or `supabase db push` with the Supabase CLI).
3. Copy `.env.example` to `.env.local` and fill in the project URL and anon key (Project settings → API).
4. Install and run:

   ```bash
   npm install
   npm run dev
   ```

5. Open http://localhost:3000, create an account, and set up your first campaign.

## Tests

`npm run test:db` loads the migration into an in-memory Postgres and checks the rules above
(campaign isolation, role limits, the disbursement flow, audit log, double-entry tallying).

## Project layout

```
app/
  login/            sign in / create account
  onboarding/       create a campaign (you become the owner)
  (app)/            signed-in area
    dashboard/      totals and wards against target
    structure/      wards and polling stations
    team/           roster and roles
    activities/     field activity log
    leaderboard/    wards and team ranked
lib/                Supabase client, current-campaign lookup, types, formatting
supabase/migrations the database schema, security policies and rules
scripts/            database rule tests
```
