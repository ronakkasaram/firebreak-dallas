import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer, ColumnLayer, ArcLayer } from '@deck.gl/layers';
import { HexagonLayer } from '@deck.gl/aggregation-layers';
import { DataFilterExtension } from '@deck.gl/extensions';
import { load, dayToDate, dateToDay } from './data.js';
import { renderClaim, renderList, renderDossier, renderHud, renderLegend, veilAddr, renderWholesale, renderLead, LIST_COLOR,
  renderHouseIdle, renderHouse } from './panels.js';
import './style.css';

const STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json';
// Where outside tiles are blocked (a sandboxed preview), fall back to a plain dark ground:
// 241,000 building dots draw the city on their own.
const BARE = { version: 8, sources: {}, layers: [{ id: 'ground', type: 'background', paint: { 'background-color': '#07070a' } }] };
async function pickStyle() {
  try {
    const r = await Promise.race([fetch(STYLE), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 2500))]);
    return r.ok ? STYLE : BARE;
  } catch { return BARE; }
}
const HOME_VIEW = { center: [-96.79, 32.80], zoom: 10.6, pitch: 52, bearing: -18 };

// Night Survey palette
const EMBER = [255, 106, 43];
const BRASS = [201, 162, 90];
const LICHEN = [143, 191, 122];
const ASH = [92, 88, 82];
const KIND_COLOR = [
  [255, 106, 43],  // code
  [214, 140, 60],  // rental
  [230, 196, 120], // tenant
  [170, 150, 120], // construction
  [190, 90, 160],  // vacancy
  [235, 70, 70],   // nuisance
  [90, 150, 200],  // infra
];

const state = {
  mode: 'spread', day: 730, playing: false, filter: 'all', selected: null, veil: true, list: 'first_spark', lead: null,
  house: null, // { i, stab: [building indices], res, fb, busy, status }
};
let D, map, overlay, cutoffDay, todayDay, backtestTop, hitDay, sim, simReady = false;
const RUNS = 400, SEED = 20261107;
const HK_TO_KIND = [0, 1, 2, 4, 5]; // Hawkes kind -> KIND_COLOR index

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function topIndices(arr, k) {
  const idx = Array.from({ length: arr.length }, (_, i) => i);
  idx.sort((a, b) => arr[b] - arr[a]);
  return idx.slice(0, k);
}

// For the proof mode: the first day after the backtest cutoff that a report lands within ~30 m
// of each watched building. The official score in meta.json matches reports by address.
function computeHits() {
  const { b, e, m } = D;
  const cell = 0.0004; // about 40 m
  const grid = new Map();
  backtestTop.forEach((i, rank) => {
    const k = Math.floor(b.lon[i] / cell) + ':' + Math.floor(b.lat[i] / cell);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(rank);
  });
  hitDay = new Float32Array(backtestTop.length).fill(1e9);
  for (let j = 0; j < m; j++) {
    const d = e.day[j];
    if (d < cutoffDay || d > cutoffDay + 90 || e.kind[j] === 6) continue;
    const gx = Math.floor(e.lon[j] / cell), gy = Math.floor(e.lat[j] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const list = grid.get((gx + dx) + ':' + (gy + dy));
      if (!list) continue;
      for (const r of list) {
        const i = backtestTop[r];
        const ddx = (b.lon[i] - e.lon[j]) * 93800, ddy = (b.lat[i] - e.lat[j]) * 111320;
        if (ddx * ddx + ddy * ddy < 900 && d < hitDay[r]) hitDay[r] = d;
      }
    }
  }
}

// Columns are sized in metres; shrink them as the camera moves in so a block stays readable.
function zf() {
  return Math.max(0.1, Math.min(1.4, Math.pow(2, (HOME_VIEW.zoom - (map ? map.getZoom() : HOME_VIEW.zoom)) * 0.85)));
}

function layers() {
  const { b, n, m, bPos, ePos, hotspots, meta } = D;
  const out = [];

  out.push(new ScatterplotLayer({
    id: 'buildings',
    data: { length: n, attributes: { getPosition: { value: bPos, size: 2 } } },
    getFillColor: (_, { index }) => b.class[index] === 0 ? [120, 112, 100, 70] : [201, 162, 90, 120],
    getRadius: 14, radiusMinPixels: 0.6, radiusMaxPixels: 3,
    pickable: state.mode === 'house', onClick: ({ index }) => index >= 0 && pickHouse(index),
    updateTriggers: { pickable: state.mode },
  }));

  if (state.mode === 'house') return out.concat(houseLayers());

  if (state.mode === 'spread' || state.mode === 'backtest' || state.mode === 'wholesale') {
    const lo = state.mode === 'backtest' ? cutoffDay : state.day - 60;
    out.push(new ScatterplotLayer({
      id: 'reports',
      data: { length: m, attributes: { getPosition: { value: ePos, size: 2 }, getFilterValue: { value: D.eDayF, size: 1 },
        getFillColor: { value: D.eColor, size: 4, normalized: true } } },
      getRadius: 55, radiusMinPixels: 1.4, radiusMaxPixels: 10, opacity: state.mode === 'wholesale' ? 0.18 : 1,
      extensions: [new DataFilterExtension({ filterSize: 1 })],
      filterRange: [lo, state.day],
      filterSoftRange: state.mode === 'backtest' ? [lo, state.day] : [state.day - 20, state.day],
      parameters: { depthTest: false },
      updateTriggers: { filterRange: [lo, state.day] },
    }));
  }

  if (state.mode === 'backtest') {
    out.push(new ColumnLayer({
      id: 'watch',
      data: backtestTop.map((i, r) => ({ i, r })),
      getPosition: d => [b.lon[d.i], b.lat[d.i]],
      getElevation: d => b.risk_backtest[d.i] / 255,
      elevationScale: 1400 * zf(), radius: 32, diskResolution: 6, extruded: true,
      getFillColor: d => hitDay[d.r] <= state.day ? [...LICHEN, 235] : [...EMBER, 170],
      updateTriggers: { getFillColor: state.day },
      material: { ambient: 0.6, diffuse: 0.5, shininess: 20 },
    }));
  }

  if (state.mode === 'forecast') {
    const frac = Math.max(0.04, Math.min(1, (state.day - todayDay) / meta.horizon_days));
    out.push(new HexagonLayer({
      id: 'terrain',
      data: D.allIdx,
      getPosition: i => [b.lon[i], b.lat[i]],
      getElevationWeight: i => b.risk[i] / 255,
      getColorWeight: i => b.risk[i] / 255,
      elevationAggregation: 'SUM', colorAggregation: 'MEAN',
      radius: 260, coverage: 0.86, extruded: true, elevationRange: [0, 1100], elevationScale: frac * Math.max(0.3, zf()), upperPercentile: 99.5,
      colorRange: [[40, 30, 24], [92, 52, 30], [150, 70, 32], [205, 90, 36], [255, 106, 43], [255, 178, 110]],
      material: { ambient: 0.55, diffuse: 0.6, shininess: 24 },
      transitions: { elevationScale: 250 },
    }));
  }

  if (state.mode === 'wholesale' && D.lists) {
    const L = D.lists.lists.find(l => l.id === state.list) || D.lists.lists[0];
    const col = LIST_COLOR[L.id] || EMBER;
    out.push(new ScatterplotLayer({
      id: 'leads-glow', data: L.leads, getPosition: l => [l.lon, l.lat], getRadius: 140, radiusMinPixels: 5, radiusMaxPixels: 26,
      getFillColor: [...col, 40], parameters: { depthTest: false },
    }));
    out.push(new ScatterplotLayer({
      id: 'leads', data: L.leads, pickable: true, autoHighlight: true, highlightColor: [255, 236, 200, 255],
      getPosition: l => [l.lon, l.lat], getRadius: 70, radiusMinPixels: 4.5, radiusMaxPixels: 12, stroked: true, lineWidthMinPixels: 1,
      getFillColor: l => l === state.lead ? [255, 236, 200, 255] : [...col, 245], getLineColor: [255, 236, 200, 200],
      updateTriggers: { getFillColor: state.lead }, parameters: { depthTest: false },
      onClick: ({ object }) => object && pickLead(object),
    }));
    if (state.lead) {
      out.push(new ScatterplotLayer({
        id: 'lead-ring', data: [state.lead], getPosition: l => [l.lon, l.lat], getRadius: 250, stroked: true,
        getFillColor: [...col, 20], getLineColor: [...col, 200], lineWidthMinPixels: 1.2,
      }));
    }
    return out;
  }

  const shown = hotspots.filter(h => state.filter === 'all' || h.asset_class === state.filter);
  out.push(new ColumnLayer({
    id: 'hotspots',
    data: shown, pickable: true, autoHighlight: true, highlightColor: [255, 236, 200, 255],
    getPosition: h => [h.lon, h.lat],
    getElevation: h => Math.log10(1 + h.usd.exposure),
    elevationScale: (state.mode === 'forecast' ? 260 : 180) * zf(), radius: 46, diskResolution: 4, angle: 45,
    getFillColor: h => h === state.selected ? [255, 236, 200, 255] : h.asset_class === 'home' ? [...BRASS, 230] : [...EMBER, 240],
    updateTriggers: { getFillColor: state.selected },
    onClick: ({ object }) => object && select(object),
  }));

  const s = state.selected;
  if (s) {
    out.push(new ScatterplotLayer({
      id: 'ring', data: [s], getPosition: h => [h.lon, h.lat], getRadius: 250, stroked: true, filled: true,
      getFillColor: [255, 106, 43, 18], getLineColor: [255, 190, 140, 200], lineWidthMinPixels: 1.2,
    }));
    if (s.portfolio?.length) {
      out.push(new ArcLayer({
        id: 'portfolio', data: s.portfolio,
        getSourcePosition: () => [s.lon, s.lat], getTargetPosition: p => [p[0], p[1]],
        getSourceColor: [...EMBER, 220], getTargetColor: [...BRASS, 160], getWidth: 1.4, getHeight: 0.6,
      }));
    }
  }
  return out;
}

function houseLayers() {
  const { b, hawkes } = D, out = [], H = state.house, r = H?.res;
  if (hawkes?.arcs?.length) {
    out.push(new ArcLayer({
      id: 'trigger-arcs', data: hawkes.arcs,
      getSourcePosition: a => [a[0], a[1]], getTargetPosition: a => [a[2], a[3]],
      getSourceColor: a => [...KIND_COLOR[HK_TO_KIND[a[6]]], r ? 50 : Math.round(90 + 165 * a[4])],
      getTargetColor: a => [255, 236, 200, r ? 40 : Math.round(60 + 160 * a[4])],
      getWidth: a => 0.6 + 2.2 * a[4], getHeight: 1.6, widthMinPixels: 0.6,
      updateTriggers: { getSourceColor: !!r, getTargetColor: !!r },
    }));
  }
  if (!H) return out;
  const fx = [b.lon[H.i], b.lat[H.i]];
  out.push(new ScatterplotLayer({
    id: 'house-rings', data: [{ r: 700, a: 60 }, { r: 250, a: 190 }], getPosition: () => fx, getRadius: d => d.r,
    stroked: true, filled: false, getLineColor: d => [255, 190, 140, d.a], lineWidthMinPixels: 1,
  }));
  if (!r) return out;
  const t = Math.max(0, Math.min(90, state.day - todayDay)), N = r.N;
  const pBy = (r.withS || r.base).pBy, stab = new Set(H.stab);
  const data = Array.from({ length: N }, (_, a) => a);
  out.push(new ColumnLayer({
    id: 'house-odds', data, pickable: true,
    getPosition: a => [b.lon[r.glob[a]], b.lat[r.glob[a]]],
    getElevation: a => stab.has(r.glob[a]) ? 0.02 : pBy[t * N + a],
    elevationScale: 900 * Math.min(1, zf() * 2.2), radius: 7, diskResolution: 6, extruded: true,
    getFillColor: a => {
      const g = r.glob[a];
      if (g === H.i) return [255, 236, 200, 255];
      if (stab.has(g)) return [...LICHEN, 255];
      const p = Math.min(1, pBy[t * N + a] * 2.5);
      return [92 + 163 * p, 88 + 90 * p, 82 + 28 * p, 120 + 135 * p];
    },
    updateTriggers: { getElevation: [t, r, H.stab.join()], getFillColor: [t, r, H.stab.join()] },
    onClick: ({ object }) => object !== undefined && pickHouse(r.glob[object]),
    material: { ambient: 0.6, diffuse: 0.5, shininess: 18 },
  }));
  if (H.stab.length) {
    out.push(new ScatterplotLayer({
      id: 'house-stab', data: H.stab, getPosition: g => [b.lon[g], b.lat[g]], getRadius: 28, radiusMinPixels: 7,
      stroked: true, filled: true, getFillColor: [...LICHEN, 40], getLineColor: [...LICHEN, 255], lineWidthMinPixels: 1.6,
      parameters: { depthTest: false },
    }));
  }
  const top = r.drivers.top.filter(d => !d.self);
  const vmax = Math.max(...top.map(d => d.v), 1e-9);
  out.push(new ArcLayer({
    id: 'house-drivers', data: top,
    getSourcePosition: d => [d.lon, d.lat], getTargetPosition: () => fx,
    getSourceColor: d => [...KIND_COLOR[d.kind], 255], getTargetColor: [255, 236, 200, 255],
    getWidth: d => 1.5 + 5 * d.v / vmax, getHeight: 0.9,
  }));
  return out;
}

function caption() {
  const { meta } = D;
  if (state.mode === 'house') {
    const r = state.house?.res, t = Math.max(0, state.day - todayDay);
    if (!state.house) return `Arcs join each report since ${D.hawkes?.arcs_window_start || '—'} to the earlier report that most likely ` +
      'set it off (stochastic declustering). Click any building to simulate its next 90 days.';
    if (!r) return state.house.status || 'simulating …';
    return `Day ${t} of 90 ahead: column height is each house's chance of a new report by then, across ${r.runs} simulated ` +
      `futures. ${r.N.toLocaleString()} buildings within 700 m.`;
  }
  if (state.mode === 'backtest') {
    const landed = backtestTop.reduce((a, _, r) => a + (hitDay[r] <= state.day ? 1 : 0), 0);
    const days = Math.max(0, state.day - cutoffDay);
    return `Model frozen on ${fmtDate(dayToDate(meta, cutoffDay))}. Day ${days} of 90: reports have landed within 30 m of ` +
      `${landed.toLocaleString()} of the ${backtestTop.length.toLocaleString()} buildings it flagged.`;
  }
  if (state.mode === 'forecast') {
    const frac = Math.max(0, Math.min(1, (state.day - todayDay) / meta.horizon_days));
    return `Expected new distress reports by this date: ${Math.round(D.expected * frac).toLocaleString()} ` +
      `(height = expected reports per hex).`;
  }
  if (state.mode === 'wholesale') {
    const L = D.lists?.lists.find(l => l.id === state.list);
    return L ? `${L.title}: top ${L.leads.length} of ${L.eligible.toLocaleString()} houses that fit the rule. ` +
      `Small dots are the last 60 days of reports.` : 'Run the backend build to make lists.json.';
  }
  return state.day > todayDay ? 'Past today: switch to next 90 days.' :
    'Each dot is a 311 report about a building. Watch them cluster and spread block by block.';
}

function redraw() {
  const { meta } = D;
  document.getElementById('date').textContent = fmtDate(dayToDate(meta, state.day)) +
    (state.day > todayDay ? '  · forecast' : '');
  document.getElementById('caption').textContent = caption();
  document.getElementById('slider').value = state.day;
  overlay.setProps({ layers: layers() });
}

function setMode(mode) {
  state.mode = mode;
  const sl = document.getElementById('slider');
  if (mode === 'backtest') { sl.min = cutoffDay; sl.max = cutoffDay + 90; state.day = cutoffDay; }
  else if (mode === 'forecast') { sl.min = todayDay; sl.max = todayDay + D.meta.horizon_days; state.day = todayDay + 45; }
  else { sl.min = 0; sl.max = todayDay; state.day = todayDay; }
  const ws = mode === 'wholesale', hs = mode === 'house';
  if (hs) { sl.min = todayDay; sl.max = todayDay + 90; state.day = todayDay + 90; }
  document.getElementById('list-wrap').hidden = ws || hs;
  document.getElementById('wholesale').hidden = !ws;
  document.getElementById('house').hidden = !hs;
  document.getElementById('claim').hidden = ws || hs;
  document.getElementById('dossier').hidden = true;
  state.selected = null; state.lead = null; state.house = null;
  if (ws) renderWholesale(D, state, pickLead, () => redraw());
  if (hs) renderHouseIdle(D);
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  renderLegend(mode);
  drawTicks();
  redraw();
}

function drawTicks() {
  const sl = document.getElementById('slider');
  const lo = +sl.min, hi = +sl.max, el = document.getElementById('ticks');
  const parts = [];
  for (let k = 0; k <= 4; k++) {
    const d = lo + Math.round((hi - lo) * k / 4);
    parts.push(`<span style="left:${k * 25}%">${fmtDate(dayToDate(D.meta, d))}</span>`);
  }
  el.innerHTML = parts.join('');
}

let last = 0;
function tick(t) {
  if (!state.playing) return;
  if (t - last > 60) {
    last = t;
    const sl = document.getElementById('slider');
    state.day += state.mode === 'spread' ? 4 : 1;
    if (state.day >= +sl.max) { state.day = +sl.max; state.playing = false; document.getElementById('play').textContent = '▶'; }
    redraw();
  }
  requestAnimationFrame(tick);
}

function select(h) {
  state.selected = h;
  renderDossier(h, D, state, () => { state.selected = null; redraw(); });
  map.flyTo({ center: [h.lon, h.lat], zoom: 14.6, pitch: 58, bearing: -25, speed: 0.9 });
  redraw();
}

// ---------- house by house: the simulator runs in a worker ----------

function houseActions() {
  return {
    close: () => { state.house = null; renderHouseIdle(D); map.flyTo({ ...HOME_VIEW, speed: 0.8 }); redraw(); },
    toggle: () => {
      const H = state.house, k = H.stab.indexOf(H.i);
      if (k >= 0) H.stab.splice(k, 1); else H.stab.push(H.i);
      H.fb = null; runSim();
    },
    clear: () => { state.house.stab = []; state.house.fb = null; runSim(); },
    firebreaks: () => {
      const H = state.house; H.busy = true; H.status = 'searching firebreaks …';
      renderHouse(D, H, houseActions());
      sim.postMessage({ type: 'firebreaks', i: H.i, k: 3, stab: H.stab.filter(g => g !== H.i) });
    },
    fly: g => map.flyTo({ center: [D.b.lon[g], D.b.lat[g]], zoom: 16.4, speed: 0.9 }),
  };
}

function runSim() {
  const H = state.house;
  H.busy = true; H.status = simReady ? `simulating ${RUNS} futures …` : 'indexing 241,000 buildings for the simulator …';
  renderHouse(D, H, houseActions());
  sim.postMessage({ type: 'focus', i: H.i, stab: H.stab, runs: RUNS, seed: SEED });
}

function onSim({ data: msg }) {
  const H = state.house;
  if (msg.type === 'ready') { simReady = true; if (H && !H.res) { H.status = `simulating ${RUNS} futures …`; renderHouse(D, H, houseActions()); } return; }
  if (!H) return;
  if (msg.type === 'progress') { H.status = msg.text; const el = document.querySelector('#house .small:last-of-type'); if (el) el.textContent = msg.text; return; }
  if (msg.type === 'firebreaks') {
    H.fb = msg; H.stab = [...new Set([...H.stab.filter(g => g !== H.i), ...msg.picks.map(p => p.g)])];
    return runSim();
  }
  if (msg.type === 'result' && msg.i === H.i) {
    H.res = msg; H.busy = false; H.status = '';
    renderHouse(D, H, houseActions());
    redraw();
  }
}

function pickHouse(i) {
  if (state.mode !== 'house') return;
  const prev = state.house;
  state.house = { i, stab: prev ? prev.stab : [], res: null, fb: null, busy: true, status: '' };
  if (!prev || Math.hypot((D.b.lon[prev.i] - D.b.lon[i]) * 93600, (D.b.lat[prev.i] - D.b.lat[i]) * 111320) > 400) {
    state.house.stab = [];
    map.flyTo({ center: [D.b.lon[i], D.b.lat[i]], zoom: 15.6, pitch: 60, bearing: -24, speed: 0.9 });
  }
  runSim();
  redraw();
}

function pickLead(l) {
  state.lead = l;
  renderLead(l, D, state);
  map.flyTo({ center: [l.lon, l.lat], zoom: 15, pitch: 55, bearing: -20, speed: 0.9 });
  redraw();
}

async function main() {
  D = await load();
  const { meta, b, e, n, m } = D;
  todayDay = dateToDay(meta, meta.as_of);
  cutoffDay = dateToDay(meta, meta.backtest_cutoff);
  D.allIdx = Array.from({ length: n }, (_, i) => i);
  D.eDayF = Float32Array.from(e.day);
  D.eColor = new Uint8Array(m * 4);
  for (let j = 0; j < m; j++) { const c = KIND_COLOR[e.kind[j]]; D.eColor.set([c[0], c[1], c[2], e.kind[j] === 6 ? 140 : 210], 4 * j); }
  D.expected = b.risk.reduce((a, r) => a + r / 255, 0);
  backtestTop = topIndices(b.risk_backtest, meta.model.network.watch_list);
  computeHits();
  if (D.hawkes && b.mu) {
    sim = new Worker(new URL('./sim.worker.js', import.meta.url), { type: 'module' });
    sim.onmessage = onSim;
    sim.postMessage({
      type: 'init', today: todayDay, params: D.hawkes.params,
      spill: meta.assumptions.spillover_pct_per_case.value, spillR: meta.assumptions.spillover_radius_m.value,
      b: { n, lon: b.lon.slice(), lat: b.lat.slice(), mu: b.mu.slice(), value: b.value.slice(), class: b.class.slice() },
      e: { m, lon: e.lon.slice(), lat: e.lat.slice(), day: e.day.slice(), kind: e.kind.slice(), b: e.b.slice(), new_case: e.new_case.slice() },
    });
  }

  map = new maplibregl.Map({ container: 'map', style: await pickStyle(), ...HOME_VIEW, antialias: true, attributionControl: { compact: true } });
  overlay = new MapboxOverlay({ interleaved: false, layers: [], pickingRadius: 6, getTooltip: ({ object }) => object?.address &&
    { html: `<b>${state.veil && object.asset_class === 'home' ? veilAddr(object.address) : object.address}</b><br>` +
      `${object.asset_class} · ${(object.risk * 100).toFixed(0)}% · ` + (object.usd
        ? `$${Math.round(object.usd.exposure).toLocaleString()} at stake`
        : `offer $${Math.round(object.offer).toLocaleString()} · ${object.buyers_nearby} buyers nearby`),
      className: 'tip' } });
  map.addControl(overlay);
  // In house mode a click that misses every dot picks the nearest building within 25 px (at least 150 m).
  let picked = 0;
  overlay.setProps({ onClick: info => { if (info.picked) picked = performance.now(); } });
  map.on('click', ev => {
    if (state.mode !== 'house' || performance.now() - picked < 300) return;
    setTimeout(() => {
      if (performance.now() - picked < 300) return;
      const { lng, lat } = ev.lngLat, { b, n } = D;
      // 25 screen pixels, at least 150 m.
      const mPerPx = 156543 * Math.cos(lat * Math.PI / 180) / 2 ** map.getZoom();
      const rad = Math.max(150, 25 * mPerPx);
      let best = -1, bd = rad * rad;
      for (let i = 0; i < n; i++) {
        const dx = (b.lon[i] - lng) * 93600, dy = (b.lat[i] - lat) * 111320, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) pickHouse(best);
    }, 0);
  });
  let zRaf = 0;
  map.on('zoom', () => { cancelAnimationFrame(zRaf); zRaf = requestAnimationFrame(() => overlay.setProps({ layers: layers() })); });

  renderHud(D);
  renderClaim(meta);
  const refreshList = () => renderList(D, state, select);
  refreshList();
  document.getElementById('filters').addEventListener('click', ev => {
    const c = ev.target.dataset.c; if (!c) return;
    state.filter = c;
    document.querySelectorAll('#filters button').forEach(x => x.classList.toggle('on', x.dataset.c === c));
    refreshList(); redraw();
  });
  document.getElementById('modes').addEventListener('click', ev => ev.target.dataset.mode && setMode(ev.target.dataset.mode));
  document.getElementById('slider').addEventListener('input', ev => { state.day = +ev.target.value; redraw(); });
  document.getElementById('play').addEventListener('click', ev => {
    const sl = document.getElementById('slider');
    if (!state.playing && state.day >= +sl.max) state.day = state.mode === 'spread' ? Math.max(0, todayDay - 365) : +sl.min;
    state.playing = !state.playing; ev.target.textContent = state.playing ? '❚❚' : '▶';
    if (state.playing) requestAnimationFrame(tick);
  });
  window.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && state.lead) { state.lead = null; document.getElementById('dossier').hidden = true; map.flyTo({ ...HOME_VIEW, speed: 0.8 }); redraw(); }
    if (ev.key === 'Escape' && state.house) { houseActions().close(); }
    if (ev.key === 'Escape' && state.selected) { state.selected = null; document.getElementById('dossier').hidden = true; map.flyTo({ ...HOME_VIEW, speed: 0.8 }); redraw(); }
    if (ev.key === ' ' && ev.target === document.body) { ev.preventDefault(); document.getElementById('play').click(); }
  });
  if (import.meta.env.DEV) window.__fb = { pickHouse, state, D }; // console hooks for local testing only
  document.getElementById('loading').remove();
  setMode('spread');
}

main().catch(err => {
  document.getElementById('loading').textContent = 'Could not load data: ' + err.message + '. Run the backend build first.';
  console.error(err);
});
