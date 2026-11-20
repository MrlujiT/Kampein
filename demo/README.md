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
