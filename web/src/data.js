// Loads the files the backend writes to web/public/data/ (see docs/CONTRACT.md).

const TYPES = { float32: Float32Array, uint8: Uint8Array, uint16: Uint16Array, uint32: Uint32Array };

function unpack(buf, layout) {
  const cols = {};
  for (const c of layout) cols[c.name] = new TYPES[c.dtype](buf, c.offset, c.length);
  return cols;
}

// Binary columns ship as .bin; hosts that refuse binary files get the same bytes as base64 text.
async function fetchBin(path) {
  const r = await fetch(`${path}.bin`);
  const type = r.headers.get('content-type') || '';
  if (r.ok && !type.includes('text/html')) return r.arrayBuffer();
  const text = await fetch(`${path}.b64.txt`).then(x => { if (!x.ok) throw new Error(`missing ${path}`); return x.text(); });
  const raw = atob(text.trim());
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

export async function load(base = './data') {
  const [meta, bBuf, eBuf, hotspots] = await Promise.all([
    fetch(`${base}/meta.json`).then(r => r.json()),
    fetchBin(`${base}/buildings`),
    fetchBin(`${base}/events`),
    fetch(`${base}/hotspots.json`).then(r => r.json()),
  ]);
  const lists = await fetch(`${base}/lists.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const b = unpack(bBuf, meta.buildings_layout);
  const e = unpack(eBuf, meta.events_layout);
  const n = meta.buildings_layout[0].length;
  const m = meta.events_layout[0].length;

  // Interleaved positions for deck.gl binary attributes.
  const bPos = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { bPos[2 * i] = b.lon[i]; bPos[2 * i + 1] = b.lat[i]; }
  const ePos = new Float32Array(m * 2);
  for (let i = 0; i < m; i++) { ePos[2 * i] = e.lon[i]; ePos[2 * i + 1] = e.lat[i]; }

  return { meta, b, e, n, m, bPos, ePos, hotspots, lists };
}

export const DAY = 86400000;
export function dayToDate(meta, d) {
  return new Date(Date.parse(meta.events_start + 'T00:00:00') + d * DAY);
}
export function dateToDay(meta, iso) {
  return Math.round((Date.parse(iso + 'T00:00:00') - Date.parse(meta.events_start + 'T00:00:00')) / DAY);
}
