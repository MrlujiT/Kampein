// Kampein website worker: serves the static site (web/public) and a small API for
// campaign sign-ups ("leads"), partners (podcasters and other referrers) and their QR links.
// Storage: Cloudflare D1, bound as DB. Tables are created on first use.
// Admin access: the ADMIN_KEY secret, set in the Cloudflare dashboard (never in this file).

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS partners (
     id INTEGER PRIMARY KEY,
     code TEXT UNIQUE NOT NULL,
     name TEXT NOT NULL,
     phone TEXT,
     rate REAL NOT NULL DEFAULT 0.15,
     token TEXT UNIQUE NOT NULL,
     active INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS leads (
     id INTEGER PRIMARY KEY,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     name TEXT NOT NULL,
     phone TEXT NOT NULL,
     role TEXT,
     seat TEXT NOT NULL,
     county INTEGER, county_name TEXT,
     cons INTEGER, cons_name TEXT,
     ward INTEGER, ward_name TEXT,
     partner_code TEXT,
     partner_rate REAL,
     status TEXT NOT NULL DEFAULT 'new',
     notes TEXT,
     ip_hash TEXT)`,
  `CREATE TABLE IF NOT EXISTS payments (
     id INTEGER PRIMARY KEY,
     lead_id INTEGER NOT NULL,
     amount INTEGER NOT NULL,
     mpesa_ref TEXT,
     kind TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS scans (
     id INTEGER PRIMARY KEY,
     partner_code TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS leads_partner ON leads(partner_code)`,
  `CREATE INDEX IF NOT EXISTS payments_lead ON payments(lead_id)`,
  `CREATE INDEX IF NOT EXISTS scans_partner ON scans(partner_code)`,
];

const SEATS = { mca: 'MCA', mp: 'MP', woman_rep: 'Woman Rep', senator: 'Senator', governor: 'Governor' };
const ROLES = { aspirant: 'Aspirant', manager: 'Campaign manager', team: 'Campaign team', other: 'Other' };
const STATUSES = ['new', 'contacted', 'meeting', 'won', 'lost'];
const PAYMENT_KINDS = ['setup', 'monthly', 'election_day', 'correction'];

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  schemaReady = true;
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const fail = (msg, status = 400) => json({ ok: false, error: msg }, status);

const clean = (v, max = 120) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const codeOk = (c) => /^[a-z0-9-]{2,24}$/.test(c);

// Kenyan mobile numbers: 07xx / 01xx / +2547xx / 2541xx -> 2547xxxxxxxx
function normPhone(p) {
  const d = String(p || '').replace(/[^\d]/g, '');
  let m = d.match(/^0([17]\d{8})$/) || d.match(/^254([17]\d{8})$/) || d.match(/^([17]\d{8})$/);
  return m ? '254' + m[1] : null;
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time comparison of two strings via their hashes
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([sha256(a || ''), sha256(b || '')]);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function randomToken(n = 18) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getCookie(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

const maskPhone = (p) => (p && p.length >= 12 ? '0' + p.slice(3, 6) + ' *** ' + p.slice(-3) : '');
const firstName = (n) => {
  const parts = String(n || '').split(' ').filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0] || '';
};

async function partnerByCode(db, code) {
  return db.prepare('SELECT * FROM partners WHERE code = ? AND active = 1').bind(code).first();
}

// ---------------------------------------------------------------- public routes

async function handleScan(req, env, code) {
  code = code.toLowerCase();
  const p = codeOk(code) ? await partnerByCode(env.DB, code) : null;
  if (!p) return Response.redirect(new URL('/', req.url).toString(), 302);
  await env.DB.prepare('INSERT INTO scans (partner_code) VALUES (?)').bind(code).run();
  const to = new URL('/?ref=' + encodeURIComponent(code), req.url).toString();
  return new Response(null, {
    status: 302,
    headers: { location: to, 'set-cookie': `kp_ref=${code}; Max-Age=${60 * 60 * 24 * 60}; Path=/; Secure; SameSite=Lax`, 'cache-control': 'no-store' },
  });
}

async function partnerName(req, env) {
  const code = clean(new URL(req.url).searchParams.get('code') || '', 24).toLowerCase();
  const p = codeOk(code) ? await partnerByCode(env.DB, code) : null;
  return json(p ? { ok: true, name: p.name, code: p.code } : { ok: false });
}

async function createLead(req, env) {
  let b;
  try { b = await req.json(); } catch { return fail('Bad request'); }
  if (b.website) return json({ ok: true }); // honeypot: bots fill hidden fields

  const name = clean(b.name, 80);
  const phone = normPhone(b.phone);
  const seat = SEATS[b.seat] ? b.seat : null;
  const role = ROLES[b.role] ? b.role : 'other';
  if (name.length < 3) return fail('Please enter your full name.');
  if (!phone) return fail('Please enter a valid Kenyan mobile number, like 0712 345 678.');
  if (!seat) return fail('Please choose the seat.');
  if (!b.consent) return fail('Please agree to be contacted about Kampein.');

  const county = Number.isInteger(b.county) ? b.county : null;
  const cons = Number.isInteger(b.cons) ? b.cons : null;
  const ward = Number.isInteger(b.ward) ? b.ward : null;
  if (!county) return fail('Please choose the county.');
  if ((seat === 'mp' || seat === 'mca') && !cons) return fail('Please choose the constituency.');
  if (seat === 'mca' && !ward) return fail('Please choose the ward.');

  const db = env.DB;
  const ipHash = await sha256((req.headers.get('cf-connecting-ip') || '') + '|kampein');

  // Light rate limit: at most 5 sign-ups an hour from one connection
  const recent = await db.prepare("SELECT COUNT(*) n FROM leads WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')").bind(ipHash).first();
  if (recent && recent.n >= 5) return fail('Too many sign-ups from this connection. Please try again later.', 429);

  // Same person, same seat, within a day: treat as already received
  const dupe = await db.prepare("SELECT id FROM leads WHERE phone = ? AND seat = ? AND created_at > datetime('now', '-1 day')").bind(phone, seat).first();
  if (dupe) return json({ ok: true, duplicate: true });

  let code = clean(b.ref || getCookie(req, 'kp_ref') || '', 24).toLowerCase();
  const partner = codeOk(code) ? await partnerByCode(db, code) : null;

  await db.prepare(
    `INSERT INTO leads (name, phone, role, seat, county, county_name, cons, cons_name, ward, ward_name, partner_code, partner_rate, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(name, phone, role, seat, county, clean(b.county_name, 60), cons, clean(b.cons_name, 60), ward, clean(b.ward_name, 60),
    partner ? partner.code : null, partner ? partner.rate : null, ipHash).run();
  return json({ ok: true });
}

// ---------------------------------------------------------------- partner dashboard

async function partnerData(env, token) {
  const db = env.DB;
  const p = await db.prepare('SELECT * FROM partners WHERE token = ?').bind(token).first();
  if (!p) return fail('Not found', 404);
  const [scans, leads] = await Promise.all([
    db.prepare('SELECT COUNT(*) n FROM scans WHERE partner_code = ?').bind(p.code).first(),
    db.prepare(`SELECT l.id, l.created_at, l.name, l.phone, l.seat, l.county_name, l.cons_name, l.ward_name, l.status, l.partner_rate,
                       COALESCE((SELECT SUM(amount) FROM payments WHERE lead_id = l.id), 0) paid
                FROM leads l WHERE l.partner_code = ? ORDER BY l.created_at DESC`).bind(p.code).all(),
  ]);
  const rows = leads.results.map((l) => ({
    date: l.created_at, name: firstName(l.name), phone: maskPhone(l.phone), seat: SEATS[l.seat] || l.seat,
    area: [l.ward_name, l.cons_name, l.county_name].filter(Boolean).join(', '), status: l.status,
    paid: l.paid, commission: Math.round(l.paid * (l.partner_rate ?? p.rate)),
  }));
  return json({
    ok: true,
    partner: { name: p.name, code: p.code, rate: p.rate, active: !!p.active },
    stats: {
      scans: scans.n, leads: rows.length, won: rows.filter((r) => r.status === 'won').length,
      paid: rows.reduce((a, r) => a + r.paid, 0), commission: rows.reduce((a, r) => a + r.commission, 0),
    },
    leads: rows,
  });
}

// ---------------------------------------------------------------- admin

async function isAdmin(req, env) {
  const h = req.headers.get('authorization') || '';
  const key = h.startsWith('Bearer ') ? h.slice(7) : '';
  return !!env.ADMIN_KEY && key.length > 0 && (await sameSecret(key, env.ADMIN_KEY));
}

async function adminSummary(env) {
  const db = env.DB;
  const [partners, leads, payments, scans] = await Promise.all([
    db.prepare('SELECT * FROM partners ORDER BY created_at').all(),
    db.prepare(`SELECT l.*, COALESCE((SELECT SUM(amount) FROM payments WHERE lead_id = l.id), 0) paid FROM leads l ORDER BY l.created_at DESC`).all(),
    db.prepare('SELECT * FROM payments ORDER BY created_at').all(),
    db.prepare('SELECT partner_code, COUNT(*) n FROM scans GROUP BY partner_code').all(),
  ]);
  const scanBy = Object.fromEntries(scans.results.map((s) => [s.partner_code, s.n]));
  const ps = partners.results.map((p) => {
    const mine = leads.results.filter((l) => l.partner_code === p.code);
    const paid = mine.reduce((a, l) => a + l.paid, 0);
    return {
      ...p, scans: scanBy[p.code] || 0, leads: mine.length, won: mine.filter((l) => l.status === 'won').length, paid,
      commission: Math.round(mine.reduce((a, l) => a + l.paid * (l.partner_rate ?? p.rate), 0)),
    };
  });
  const leadsOut = leads.results.map(({ ip_hash, ...l }) => ({ ...l, payments: payments.results.filter((x) => x.lead_id === l.id) }));
  return json({ ok: true, partners: ps, leads: leadsOut });
}

async function adminAddPartner(req, env) {
  const b = await req.json().catch(() => ({}));
  const name = clean(b.name, 80);
  const code = clean(b.code, 24).toLowerCase();
  const rate = Number(b.rate);
  if (name.length < 2) return fail('Name is required.');
  if (!codeOk(code)) return fail('Code: 2 to 24 lowercase letters, numbers or dashes.');
  if (!(rate >= 0 && rate <= 0.5)) return fail('Rate must be between 0% and 50%.');
  const exists = await env.DB.prepare('SELECT id FROM partners WHERE code = ?').bind(code).first();
  if (exists) return fail('That code is taken.');
  const phone = b.phone ? normPhone(b.phone) : null;
  if (b.phone && !phone) return fail('Phone must be a Kenyan mobile number.');
  await env.DB.prepare('INSERT INTO partners (code, name, phone, rate, token) VALUES (?, ?, ?, ?, ?)').bind(code, name, phone, rate, randomToken()).run();
  return json({ ok: true });
}

async function adminUpdatePartner(req, env, id) {
  const b = await req.json().catch(() => ({}));
  const p = await env.DB.prepare('SELECT * FROM partners WHERE id = ?').bind(id).first();
  if (!p) return fail('Not found', 404);
  const rate = b.rate === undefined ? p.rate : Number(b.rate);
  if (!(rate >= 0 && rate <= 0.5)) return fail('Rate must be between 0% and 50%.');
  const active = b.active === undefined ? p.active : b.active ? 1 : 0;
  const token = b.newToken ? randomToken() : p.token;
  await env.DB.prepare('UPDATE partners SET rate = ?, active = ?, token = ? WHERE id = ?').bind(rate, active, token, id).run();
  return json({ ok: true });
}

async function adminUpdateLead(req, env, id) {
  const b = await req.json().catch(() => ({}));
  const l = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first();
  if (!l) return fail('Not found', 404);
  const status = b.status === undefined ? l.status : b.status;
  if (!STATUSES.includes(status)) return fail('Unknown status.');
  const notes = b.notes === undefined ? l.notes : clean(b.notes, 2000);
  await env.DB.prepare('UPDATE leads SET status = ?, notes = ? WHERE id = ?').bind(status, notes, id).run();
  return json({ ok: true });
}

async function adminAddPayment(req, env, id) {
  const b = await req.json().catch(() => ({}));
  const l = await env.DB.prepare('SELECT id FROM leads WHERE id = ?').bind(id).first();
  if (!l) return fail('Not found', 404);
  const amount = Math.round(Number(b.amount));
  const kind = PAYMENT_KINDS.includes(b.kind) ? b.kind : 'setup';
  const ref = clean(b.mpesa_ref, 20).toUpperCase();
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 10_000_000) return fail('Enter an amount in KES.');
  if (kind !== 'correction' && amount < 0) return fail('Use a correction for negative amounts.');
  if (kind !== 'correction' && !/^[A-Z0-9]{8,12}$/.test(ref)) return fail('Enter the M-Pesa reference, like SKL4ABC123.');
  await env.DB.prepare('INSERT INTO payments (lead_id, amount, mpesa_ref, kind) VALUES (?, ?, ?, ?)').bind(id, amount, ref || null, kind).run();
  return json({ ok: true });
}

async function adminExport(env) {
  const r = await env.DB.prepare(`SELECT l.id, l.created_at, l.name, l.phone, l.role, l.seat, l.county_name, l.cons_name, l.ward_name, l.partner_code, l.status, l.notes,
      COALESCE((SELECT SUM(amount) FROM payments WHERE lead_id = l.id), 0) paid FROM leads l ORDER BY l.created_at`).all();
  const cols = ['id', 'created_at', 'name', 'phone', 'role', 'seat', 'county_name', 'cons_name', 'ward_name', 'partner_code', 'status', 'paid', 'notes'];
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  const csv = [cols.join(','), ...r.results.map((row) => cols.map((c) => esc(row[c])).join(','))].join('\n');
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="kampein-leads.csv"', 'cache-control': 'no-store' } });
}

// ---------------------------------------------------------------- router

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    const m = req.method;

    // Static pages that don't touch the database
    if (path.startsWith('/p/') && m === 'GET') return env.ASSETS.fetch(new Request(new URL('/partner', url), req));
    if (!path.startsWith('/api/') && !path.startsWith('/r/')) return env.ASSETS.fetch(req);

    if (!env.DB) return fail('Database not connected yet.', 503);
    try {
      await ensureSchema(env.DB);

      let r;
      if ((r = path.match(/^\/r\/([^/]+)\/?$/)) && m === 'GET') return handleScan(req, env, decodeURIComponent(r[1]));
      if (path === '/api/partner-name' && m === 'GET') return partnerName(req, env);
      if (path === '/api/leads' && m === 'POST') return createLead(req, env);
      if ((r = path.match(/^\/api\/p\/([A-Za-z0-9_-]{10,40})$/)) && m === 'GET') return partnerData(env, r[1]);

      if (path.startsWith('/api/admin/')) {
        if (!env.ADMIN_KEY) return fail('Admin is not set up: add the ADMIN_KEY secret in Cloudflare.', 503);
        if (!(await isAdmin(req, env))) return fail('Wrong admin key.', 401);
        if (path === '/api/admin/summary' && m === 'GET') return adminSummary(env);
        if (path === '/api/admin/export.csv' && m === 'GET') return adminExport(env);
        if (path === '/api/admin/partners' && m === 'POST') return adminAddPartner(req, env);
        if ((r = path.match(/^\/api\/admin\/partners\/(\d+)$/)) && m === 'PATCH') return adminUpdatePartner(req, env, Number(r[1]));
        if ((r = path.match(/^\/api\/admin\/leads\/(\d+)$/)) && m === 'PATCH') return adminUpdateLead(req, env, Number(r[1]));
        if ((r = path.match(/^\/api\/admin\/leads\/(\d+)\/payments$/)) && m === 'POST') return adminAddPayment(req, env, Number(r[1]));
      }
      return fail('Not found', 404);
    } catch (e) {
      console.error(e);
      return fail('Something went wrong. Please try again.', 500);
    }
  },
};
