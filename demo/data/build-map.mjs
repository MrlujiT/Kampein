import fs from 'node:fs';
import * as d3 from 'd3-geo';

const csv = fs.readFileSync('iebc.csv', 'utf8').trim().split('\n').slice(1).map(l => l.split(','));
const titleCase = s => s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/'([A-Z])/g, (m, c) => "'" + c.toLowerCase()).replace(' - ', '-');
const counties = {}, consts = {};
for (const [cc, cn, kc, kn, rv] of csv) {
  const c = +cc;
  counties[c] ??= { code:c, name:titleCase(cn.replace(' CITY','')), reg:0, consts:0 };
  counties[c].reg += +rv; counties[c].consts++;
  consts[+kc] = { code:+kc, county:c, name:titleCase(kn), reg:+rv };
}
counties[47].name = 'Nairobi';
for (const l of fs.readFileSync('ecvr2026.csv','utf8').trim().split('\n').slice(1)) {
  const [c, e] = l.split(',').map(Number);
  counties[c].new26 = e;
}

function level(file, W, H, keyFn, rotate) {
  const gj = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Shapefile-derived rings can wind the "wrong" way for d3 (which then fills the whole globe): flip them.
  for (const f of gj.features) {
    if (d3.geoArea(f) > 2 * Math.PI) {
      const g = f.geometry;
      if (g.type === 'Polygon') g.coordinates.forEach(r => r.reverse());
      else g.coordinates.forEach(p => p.forEach(r => r.reverse()));
    }
  }
  const proj = d3.geoMercator().fitExtent([[12, 12], [W - 12, H - 12]], gj);
  const path = d3.geoPath(proj).digits(1);
  return { gj, proj, items: gj.features.map(f => ({ key:keyFn(f.properties), d:path(f), c:path.centroid(f).map(v => Math.round(v)) })) };
}

const K = level('counties_s.json', 600, 640, p => +p.COUNTY_COD);
const N = level('nairobi_s.json', 600, 420, p => +p.CONST_CODE);
const W = level('kasarani_s.json', 600, 330, p => p.COUNTY_A_1);

// Random points inside each Kasarani ward for activity markers
let s = 7;
const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
const pts = {};
for (const f of W.gj.features) {
  const [[x0, y0], [x1, y1]] = d3.geoBounds(f);
  const out = [];
  let guard = 0;
  while (out.length < 40 && guard++ < 5000) {
    const p = [x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0)];
    if (d3.geoContains(f, p)) out.push(W.proj(p).map(v => Math.round(v * 10) / 10));
  }
  pts[f.properties.COUNTY_A_1] = out;
}

const data = {
  source: 'IEBC: Registered voters per constituency, 2022 general election; ECVR Phase 1 final status report, 30 April 2026',
  counties: Object.values(counties),
  consts: Object.values(consts).filter(c => c.county === 47),
  map: {
    kenya: { w:600, h:640, items:K.items },
    nairobi: { w:600, h:420, items:N.items },
    kasarani: { w:600, h:330, items:W.items, pts },
  },
};
const js = 'const GEO = ' + JSON.stringify(data) + ';\n';
fs.writeFileSync('geo.js', js);
console.log('bytes', js.length, 'counties', data.counties.length, 'nairobi', N.items.length, 'wards', W.items.map(i => i.key));
