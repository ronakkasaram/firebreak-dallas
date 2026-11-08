// Live Dallas 311: property reports filed since the snapshot, matched to the nearest building, and
// the extra reports each one is expected to set off over the next 90 days under the fitted Hawkes
// model (the same kernel the simulator uses). Where the feed is unreachable (offline, or a sandboxed
// preview that blocks outside requests), the console replays the snapshot's last 48 hours instead
// and says so.

const API = 'https://www.dallasopendata.com/resource/d7e7-envw.json';
// Service types and their kind codes in events.bin (backend/firebreak/geo.py).
const KIND = {
  'Code Concern - CCS': 0, 'Single Family Rental Needs Registration - CCS': 1,
  'Restaurant/Food Complaint - CCS': 2, 'Consumer Protection Complaint - CCS': 2,
  'Homeless Encampment - EMCR': 4,
  'Criminal Activities - DPD': 5, 'Narcotics/Vice Complaint - DPD': 5, 'Chronic Noise Complaint - DPD': 5,
};
const HK = [0, 1, 2, -1, 3, 4, -1]; // events.bin kind -> Hawkes kind
const HK_NAME = ['code', 'rental', 'tenant', 'vacancy', 'nuisance'];
const KIND_LABEL = ['code', 'rental registration', 'tenant', 'construction', 'encampment', 'nuisance', 'infrastructure'];
const M_LON = 111320 * Math.cos(32.78 * Math.PI / 180), M_LAT = 111320;
const CELL = 0.003;

let grid = null;
function buildingGrid(b, n) {
  if (grid) return grid;
  grid = new Map();
  for (let i = 0; i < n; i++) {
    const k = Math.floor(b.lon[i] / CELL) * 100000 + Math.floor(b.lat[i] / CELL);
    (grid.get(k) || grid.set(k, []).get(k)).push(i);
  }
  return grid;
}
function near(D, lon, lat, r, fn) {
  const g = buildingGrid(D.b, D.n), gx = Math.floor(lon / CELL), gy = Math.floor(lat / CELL), b = D.b;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const list = g.get((gx + dx) * 100000 + gy + dy); if (!list) continue;
    for (const i of list) {
      const ddx = (b.lon[i] - lon) * M_LON, ddy = (b.lat[i] - lat) * M_LAT, d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d <= r) fn(i, d);
    }
  }
}
function nearest(D, lon, lat, r = 40) {
  let best = -1, bd = r;
  near(D, lon, lat, r, (i, d) => { if (d < bd) { bd = d; best = i; } });
  return best;
}

// Expected extra reports at each building over 90 days from a set of new reports.
function jumps(D, events) {
  const p = D.hawkes?.params; if (!p) return [];
  const keep = (1 - p.fast_share) * (1 - Math.exp(-p.beta_slow * 90));
  const add = new Map(), why = new Map();
  for (const ev of events) {
    const k = HK[ev.kind]; if (k < 0) continue;
    near(D, ev.lon, ev.lat, p.radius_m, (i, d) => {
      const self = i === ev.b;
      const v = (self ? p.a_self[HK_NAME[k]] : p.a_nb[HK_NAME[k]] * Math.exp(-d / p.sigma_m)) * keep;
      if (v < 1e-4) return;
      add.set(i, (add.get(i) || 0) + v);
      const w = why.get(i) || why.set(i, { self: 0, nb: 0, kinds: new Set(), dmin: 1e9 }).get(i);
      if (self) w.self++; else { w.nb++; w.dmin = Math.min(w.dmin, d); }
      w.kinds.add(KIND_LABEL[ev.kind]);
    });
  }
  const top = [...add.entries()].sort((x, y) => y[1] - x[1]).slice(0, 25).map(([i, d]) => {
    const w = why.get(i);
    const parts = [];
    if (w.self) parts.push(`${w.self} new here`);
    if (w.nb) parts.push(`${w.nb} new within ${Math.round(w.dmin)}–${p.radius_m} m`);
    return { i, d, label: D.label(i), why: `${parts.join(', ')} · ${[...w.kinds].join(', ')}` };
  });
  top.all = add; // every building's jump, for the watchlist
  return top;
}

function parseLoc(x) {
  if (!x) return null;
  if (typeof x === 'object' && x.latitude) return [+x.longitude, +x.latitude];
  if (typeof x === 'object' && x.coordinates) return [x.coordinates[0], x.coordinates[1]];
  const m = String(x).match(/\(([-\d.]+),\s*([-\d.]+)\)/);
  return m ? [+m[2], +m[1]] : null;
}

export async function pullLive(D, todayDay) {
  const since = D.meta.as_of + 'T00:00:00';
  const types = Object.keys(KIND).map(t => `'${t.replace(/'/g, "''")}'`).join(',');
  const where = `created_date >= '${since}' AND service_request_type in(${types})`;
  const url = `${API}?$select=service_request_type,created_date,lat_location&$where=${encodeURIComponent(where)}&$order=created_date DESC&$limit=5000`;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 7000);
  let rows;
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`feed returned ${r.status}`);
    rows = await r.json();
  } finally { clearTimeout(timer); }
  const events = [];
  for (const row of rows) {
    const ll = parseLoc(row.lat_location); if (!ll) continue;
    const kind = KIND[row.service_request_type];
    events.push({ lon: ll[0], lat: ll[1], kind, day: todayDay, b: nearest(D, ll[0], ll[1]), type: row.service_request_type,
      when: new Date(row.created_date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) });
  }
  const at = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return { status: 'on', mode: 'live', count: events.length, at, events, jumps: jumps(D, events.filter(e => e.b >= 0)) };
}

// Offline fallback: the reports in the snapshot's last 48 hours, scored the same way.
export function replayLive(D, todayDay, why = '') {
  const { e, m } = D, events = [];
  for (let j = 0; j < m; j++) {
    if (e.kind[j] === 6 || !e.new_case[j] || todayDay - e.day[j] > 2 || e.day[j] > todayDay) continue;
    events.push({ lon: e.lon[j], lat: e.lat[j], kind: e.kind[j], day: e.day[j], b: e.b[j] });
  }
  return { status: 'on', mode: 'replay', count: events.length, at: 'replay of the snapshot’s last 48 h', note: why, events,
    jumps: jumps(D, events.filter(x => x.b >= 0)) };
}
