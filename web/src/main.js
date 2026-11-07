import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer, ColumnLayer, ArcLayer } from '@deck.gl/layers';
import { HexagonLayer } from '@deck.gl/aggregation-layers';
import { DataFilterExtension } from '@deck.gl/extensions';
import { load, dayToDate, dateToDay } from './data.js';
import { renderClaim, renderList, renderDossier, renderHud, renderLegend, veilAddr } from './panels.js';
import './style.css';

const STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json';
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
  mode: 'spread', day: 730, playing: false, filter: 'all', selected: null, veil: true,
};
let D, map, overlay, cutoffDay, todayDay, backtestTop, hitDay;

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
  }));

  if (state.mode === 'spread' || state.mode === 'backtest') {
    const lo = state.mode === 'backtest' ? cutoffDay : state.day - 60;
    out.push(new ScatterplotLayer({
      id: 'reports',
      data: { length: m, attributes: { getPosition: { value: ePos, size: 2 }, getFilterValue: { value: D.eDayF, size: 1 },
        getFillColor: { value: D.eColor, size: 4, normalized: true } } },
      getRadius: 55, radiusMinPixels: 1.4, radiusMaxPixels: 10,
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

function caption() {
  const { meta } = D;
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

  map = new maplibregl.Map({ container: 'map', style: STYLE, ...HOME_VIEW, antialias: true, attributionControl: { compact: true } });
  overlay = new MapboxOverlay({ interleaved: false, layers: [], getTooltip: ({ object }) => object?.address &&
    { html: `<b>${state.veil && object.asset_class === 'home' ? veilAddr(object.address) : object.address}</b><br>` +
      `${object.asset_class} · ${(object.risk * 100).toFixed(0)}% · $${Math.round(object.usd.exposure).toLocaleString()} at stake`,
      className: 'tip' } });
  map.addControl(overlay);
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
    if (ev.key === 'Escape' && state.selected) { state.selected = null; document.getElementById('dossier').hidden = true; map.flyTo({ ...HOME_VIEW, speed: 0.8 }); redraw(); }
    if (ev.key === ' ' && ev.target === document.body) { ev.preventDefault(); document.getElementById('play').click(); }
  });
  document.getElementById('loading').remove();
  setMode('spread');
}

main().catch(err => {
  document.getElementById('loading').textContent = 'Could not load data: ' + err.message + '. Run the backend build first.';
  console.error(err);
});
