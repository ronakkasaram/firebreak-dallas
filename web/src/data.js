// Loads the files the backend writes to web/public/data/ (see docs/CONTRACT.md).

const TYPES = { float32: Float32Array, uint8: Uint8Array, uint16: Uint16Array, uint32: Uint32Array, int32: Int32Array };

function unpack(buf, layout) {
  const cols = {};
  for (const c of layout) cols[c.name] = new TYPES[c.dtype](buf, c.offset, c.length);
  return cols;
}

// Binary columns ship as .bin; hosts that refuse binary files get the same bytes as base64 text.
async function fetchBin(path, onBytes) {
  const r = await fetch(`${path}.bin`);
  const type = r.headers.get('content-type') || '';
  if (r.ok && !type.includes('text/html')) {
    const buf = await r.arrayBuffer(); onBytes?.(buf.byteLength); return buf;
  }
  const text = await fetch(`${path}.b64.txt`).then(x => { if (!x.ok) throw new Error(`missing ${path}`); return x.text(); });
  const raw = atob(text.trim());
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  onBytes?.(out.byteLength);
  return out.buffer;
}

export async function load(base = './data', progress = () => {}) {
  let done = 0;
  const step = label => x => { done += 1; progress(done / 9, label); return x; };
  const json = name => fetch(`${base}/${name}`).then(r => r.json()).then(step(name));
  const opt = name => fetch(`${base}/${name}`).then(r => (r.ok ? r.json() : null)).catch(() => null).then(step(name));
  const [meta, bBuf, eBuf, hotspots, lists, hawkes, alarms, evidence, search] = await Promise.all([
    json('meta.json'),
    fetchBin(`${base}/buildings`).then(step('buildings')),
    fetchBin(`${base}/events`).then(step('events')),
    json('hotspots.json'),
    opt('lists.json'), opt('hawkes.json'), opt('alarms.json'), opt('evidence.json'), opt('search.json'),
  ]);
  const b = unpack(bBuf, meta.buildings_layout);
  // Fixed-point pressure columns: stored value / 5000 = expected reports (see docs/CONTRACT.md).
  for (const k of ['push_nb', 'spare']) if (b[k] instanceof Uint16Array) b[k] = Float32Array.from(b[k], v => v / 5000);
  const e = unpack(eBuf, meta.events_layout);
  const n = meta.buildings_layout[0].length;
  const m = meta.events_layout[0].length;

  // Interleaved positions for deck.gl binary attributes.
  const bPos = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { bPos[2 * i] = b.lon[i]; bPos[2 * i + 1] = b.lat[i]; }
  const ePos = new Float32Array(m * 2);
  for (let i = 0; i < m; i++) { ePos[2 * i] = e.lon[i]; ePos[2 * i + 1] = e.lat[i]; }

  const falcon = await loadFalcon(base);
  return { meta, b, e, n, m, bPos, ePos, hotspots, lists, hawkes, alarms, evidence, search, falcon };
}

// FALCON neural field (backend/firebreak/falcon/net.py): a 256 x 256 grid of expected reports, ignition
// chances and blind-spot flags. Optional: the console runs without it.
async function loadFalcon(base) {
  try {
    const js = await fetch(`${base}/falcon.json`).then(r => (r.ok ? r.json() : null));
    if (!js) return null;
    const buf = await fetchBin(`${base}/falcon`);
    const G = js.grid, col = name => js.layout.find(c => c.name === name);
    const u16 = (c) => { const a = new Uint16Array(buf, c.offset, G * G); return Float32Array.from(a, v => v * c.scale); };
    js.rate = u16(col('rate')); js.ignite = u16(col('ignite')); js.blind = new Uint8Array(buf, col('blind').offset, G * G);
    js.center = k => [js.west + ((k % G) + 0.5) * js.dlon, js.north - (Math.floor(k / G) + 0.5) * js.dlat];
    return js;
  } catch { return null; }
}

export const DAY = 86400000;
export function dayToDate(meta, d) {
  return new Date(Date.parse(meta.events_start + 'T00:00:00') + d * DAY);
}
export function dateToDay(meta, iso) {
  return Math.round((Date.parse(iso.slice(0, 10) + 'T00:00:00') - Date.parse(meta.events_start + 'T00:00:00')) / DAY);
}
