// Builds the demo's national data: geo.js (Kenya map + index of every county,
// constituency and ward) and data/cNN.json per county (stations + map shapes).
import fs from 'node:fs';
import * as d3 from 'd3-geo';

const OUT = process.argv[2];
const titleCase = s => s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/'([A-Z])/g, (m, c) => "'" + c.toLowerCase()).replace(' - ', '-');
const csv = fs.readFileSync('iebc.csv', 'utf8').trim().split('\n').slice(1).map(l => l.split(','));
const constName = {}, countyName = {};
for (const [cc, cn, kc, kn] of csv) { constName[+kc] = titleCase(kn); countyName[+cc] = titleCase(cn.replace(' CITY', '')); }
countyName[47] = 'Nairobi';
const new26 = {};
for (const l of fs.readFileSync('ecvr2026.csv', 'utf8').trim().split('\n').slice(1)) { const [c, e] = l.split(',').map(Number); new26[c] = e; }
const ST = JSON.parse(fs.readFileSync('stations_all.json', 'utf8'));

function fix(gj) {
  for (const f of gj.features) if (d3.geoArea(f) > 2 * Math.PI) {
    const g = f.geometry;
    if (g.type === 'Polygon') g.coordinates.forEach(r => r.reverse()); else g.coordinates.forEach(p => p.forEach(r => r.reverse()));
  }
  return gj;
}
const counties = fix(JSON.parse(fs.readFileSync('counties_s.json', 'utf8')));
const consts = fix(JSON.parse(fs.readFileSync('consts_s.json', 'utf8')));
const wards = fix(JSON.parse(fs.readFileSync('wards_s.json', 'utf8')));

function shapes(features, W, H, key) {
  const fc = { type:'FeatureCollection', features };
  const proj = d3.geoMercator().fitExtent([[12, 12], [W - 12, H - 12]], fc);
  const path = d3.geoPath(proj).digits(1);
  return { proj, items:features.map(f => ({ k:key(f.properties), d:path(f), c:path.centroid(f).map(Math.round) })) };
}

let s = 11;
const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
const sum = a => a.reduce((x, y) => x + y, 0);

const idx = [];
fs.mkdirSync(OUT, { recursive:true });
for (let cc = 1; cc <= 47; cc++) {
  const sc = ST[String(cc)];
  const cfeat = consts.features.filter(f => +f.properties.COUNTY_COD === cc);
  const cshape = shapes(cfeat, 600, 440, p => +p.CONST_CODE);
  const file = { k:cc, name:countyName[cc], new26:new26[cc], map:{ w:600, h:440, items:cshape.items }, wmap:{}, consts:[] };
  const ix = { k:cc, name:countyName[cc], new26:new26[cc], reg:0, consts:[] };
  for (const kc of sc.consts) {
    const wfeat = wards.features.filter(f => +f.properties.CONST_CODE === kc.k);
    const wshape = shapes(wfeat, 600, 360, p => +p.COUNTY_ASS);
    const pts = {};
    for (const f of wfeat) {
      const [[x0, y0], [x1, y1]] = d3.geoBounds(f); const out = []; let g = 0;
      while (out.length < 40 && g++ < 4000) { const p = [x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0)]; if (d3.geoContains(f, p)) out.push(wshape.proj(p).map(v => Math.round(v * 10) / 10)); }
      pts[+f.properties.COUNTY_ASS] = out;
    }
    file.wmap[kc.k] = { w:600, h:360, items:wshape.items, pts };
    const kreg = sum(kc.wards.map(w => sum(w.c.map(c => sum(c[2])))));
    file.consts.push({ k:kc.k, name:constName[kc.k] || ('Constituency ' + kc.k), wards:kc.wards });
    ix.consts.push({ k:kc.k, name:constName[kc.k], reg:kreg, wards:kc.wards.map(w => ({ k:w.k, name:w.name, reg:sum(w.c.map(c => sum(c[2]))), st:sum(w.c.map(c => c[2].length)), ce:w.c.length })) });
    ix.reg += kreg;
  }
  const id = 'c' + String(cc).padStart(2, '0');
  fs.writeFileSync(`${OUT}/${id}.json`, JSON.stringify(file));
  idx.push(ix);
}

// Kenya level (county shapes) + index
const K = shapes(counties.features, 600, 640, p => +p.COUNTY_COD);
const GEO = { kenya:{ w:600, h:640, items:K.items }, idx };
fs.writeFileSync(`${OUT}/../geo.js`, '// IEBC 2022 register (per polling station) and 2026 ECVR new voters per county; boundaries from mikelmaron/kenya-election-data\nconst GEO = ' + JSON.stringify(GEO) + ';\n');
const tot = sum(idx.map(c => c.reg));
console.log('total voters', tot, 'counties', idx.length, 'consts', sum(idx.map(c => c.consts.length)), 'wards', sum(idx.map(c => sum(c.consts.map(k => k.wards.length)))));
