// Firebreak console: Detect -> Predict -> Simulate -> Act -> Evidence.
// The map shows the data; the side panel explains it; every number comes from web/public/data/.
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer, ColumnLayer, ArcLayer, TextLayer, PathLayer } from '@deck.gl/layers';
import { HexagonLayer, HeatmapLayer } from '@deck.gl/aggregation-layers';
import { DataFilterExtension } from '@deck.gl/extensions';
import { load, dayToDate, dateToDay } from './data.js';
import {
  $, esc, pct, kusd, usd, wireHold, fmtDate, CLASS, factorOf, factorWord, KIND_HEX, HEAT, LIST_HEX, DEFAULT_COSTS, store,
  renderDetect, renderPredict, renderSimulateIdle, renderHouse, renderAct, renderEvidence, renderDossier, renderLead, renderLegend,
} from './panels.js';
import { pullLive, replayLive } from './live.js';
import { chain, childrenOf, latestReport, clusterOrigins, KIND_OF } from './rootcause.js';
import { startTour, stopTour, tourActive } from './tour.js';
import { startPlaybook, stopPlaybook, playbookActive } from './playbook.js';
import { renderHome, healthRows, ROLES } from './home.js';
import { listCases, getCase, openCase, advanceCase, removeCase, casesCSV } from './cases.js';
import { startFilm, stopFilm, filmActive } from './film.js';
import './style.css';

const STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
// Where outside tiles are blocked (a sandboxed preview), the 241,000 building dots draw the city on their own.
const BARE = { version: 8, sources: {}, layers: [{ id: 'ground', type: 'background', paint: { 'background-color': '#0b0c0e' } }] };
async function pickStyle() {
  try {
    const r = await Promise.race([fetch(STYLE), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 2500))]);
    return r.ok ? STYLE : BARE;
  } catch { return BARE; }
}
const HOME = { center: [-96.79, 32.80], zoom: 10.6, pitch: 45, bearing: -12 };
const VIEWS = ['home', 'detect', 'predict', 'simulate', 'act', 'evidence'];
const onDetect = v => v === 'detect' || v === 'home'; // Home shows the Detect map: what is happening now
const RUNS = 400, SEED = 20261107;
const M_LON = 111320 * Math.cos(32.78 * Math.PI / 180), M_LAT = 111320;

const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const KIND_RGB = KIND_HEX.map(rgb);
const HEAT_RGB = HEAT.map(rgb);
const CREW_RGB = ['#8ab4ff', '#009e73', '#f0e442', '#cc79a7'].map(h => [...rgb(h), 235]);
const ACCENT = rgb('#8ab4ff'), STAB = rgb('#009e73'), HIT = rgb('#56b4e9'), OPEN = rgb('#e69f00'), PRIORITY = rgb('#fca50a');
const HK_TO_KIND = [0, 1, 2, 4, 5];
function heat(t, a = 255) { // 0..1 on the inferno ramp
  const x = Math.max(0, Math.min(0.9999, t)) * (HEAT_RGB.length - 1), k = Math.floor(x), f = x - k;
  const c0 = HEAT_RGB[k], c1 = HEAT_RGB[k + 1];
  return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f, a];
}

const S = {
  view: 'home', day: 730, role: store('fb-role') || 'city', caseTab: 'open', caseOpen: null, playing: false, speed: 3,
  filter: 'all', predict: 'forecast', act: 'plan', list: 'first_spark',
  selected: null, lead: null, alarm: null, house: null, highlight: null,
  plan: { budget: 500000, costs: { ...DEFAULT_COSTS, ...(store('fb-costs') || {}) }, result: null },
  planApproved: !!store('fb-plan-approved'), portfolio: { owner: null, rows: null, inbound: 0 },
  live: { status: 'off', note: 'connecting', count: 0, jumps: [] }, brief: null, route: null, network: false,
};
let D, map, overlay, todayDay, cutoffDay, backtestTop, hitDay, sim, simReady = false, liveEv = null;

// ---------- helpers ----------

function topIndices(arr, k) {
  const idx = Array.from({ length: arr.length }, (_, i) => i);
  idx.sort((a, b) => arr[b] - arr[a]);
  return idx.slice(0, k);
}
function zf() { return Math.max(0.1, Math.min(1.4, Math.pow(2, (HOME.zoom - (map ? map.getZoom() : HOME.zoom)) * 0.85))); }
function fly(lon, lat, zoom = 15.4) { map.flyTo({ center: [lon, lat], zoom, pitch: map.getPitch() > 5 ? 55 : 0, bearing: map.getPitch() > 5 ? -20 : 0, speed: 0.9 }); }
// Fit a set of points from straight above: a pitched camera hides part of the bounds.
function fitFlat(bounds, opts = {}) {
  map.fitBounds(bounds, { ...opts, pitch: 0, bearing: 0 });
  $('pitch').textContent = '3D';
  setTimeout(() => overlay.setProps({ layers: layers() }), (opts.duration ?? 900) + 50);
}
function home() { map.flyTo({ ...HOME, pitch: map.getPitch() > 5 ? HOME.pitch : 0, bearing: map.getPitch() > 5 ? HOME.bearing : 0, speed: 0.8 }); }

function label(i) {
  const s = D.search;
  if (s?.names?.[i]) return s.names[i];
  if (s && D.b.street) {
    const st = s.streets[D.b.street[i]] || '';
    return D.b.block[i] ? `${D.b.block[i]} block of ${st}` : st;
  }
  return `${CLASS[D.b.class[i]]} #${i}`;
}

// Backtest proof: the first day after the cutoff that a report lands within 30 m of each watched building.
function computeHits() {
  const { b, e, m } = D, cell = 0.0004, grid = new Map();
  backtestTop.forEach((i, r) => {
    const k = Math.floor(b.lon[i] / cell) + ':' + Math.floor(b.lat[i] / cell);
    (grid.get(k) || grid.set(k, []).get(k)).push(r);
  });
  hitDay = new Float32Array(backtestTop.length).fill(1e9);
  for (let j = 0; j < m; j++) {
    const d = e.day[j];
    if (d < cutoffDay || d > cutoffDay + 90 || e.kind[j] === 6) continue;
    const gx = Math.floor(e.lon[j] / cell), gy = Math.floor(e.lat[j] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const list = grid.get((gx + dx) + ':' + (gy + dy)); if (!list) continue;
      for (const r of list) {
        const i = backtestTop[r], ddx = (b.lon[i] - e.lon[j]) * M_LON, ddy = (b.lat[i] - e.lat[j]) * M_LAT;
        if (ddx * ddx + ddy * ddy < 900 && d < hitDay[r]) hitDay[r] = d;
      }
    }
  }
}

function lowerDay(d) { // first event index with day >= d
  let a = 0, b = D.m;
  while (a < b) { const mid = (a + b) >> 1; if (D.e.day[mid] < d) a = mid + 1; else b = mid; }
  return a;
}

// ---------- layers ----------

function layers() {
  const { b, n, m, bPos, ePos, hotspots } = D, v = S.view, out = [];
  const dim = v === 'evidence';
  out.push(new ScatterplotLayer({
    id: 'buildings',
    data: { length: n, attributes: { getPosition: { value: bPos, size: 2 }, getFillColor: { value: dim ? D.bDistrictColor : D.bColor, size: 4, normalized: true } } },
    getRadius: 14, radiusMinPixels: dim ? 1 : 0.6, radiusMaxPixels: 3, pickable: true,
    updateTriggers: { getFillColor: dim },
  }));

  if (onDetect(v)) {
    // Report density, last 60 days: events.bin is sorted by day, so the window is one contiguous slice.
    const lo = lowerDay(S.day - 60), hi = lowerDay(S.day + 1);
    out.push(new HeatmapLayer({
      id: 'density', data: { length: hi - lo, attributes: {
        getPosition: { value: ePos.subarray(2 * lo, 2 * hi), size: 2 }, getWeight: { value: D.eWeight.subarray(lo, hi), size: 1 } } },
      radiusPixels: 30, intensity: 1, threshold: 0.04, opacity: Math.max(0, Math.min(0.85, (14.5 - map.getZoom()) / 2.5)),
      colorRange: [[20, 11, 52], ...HEAT_RGB], aggregation: 'SUM', updateTriggers: { getPosition: [lo, hi], getWeight: [lo, hi] },
    }));
    out.push(new ScatterplotLayer({
      id: 'reports',
      data: { length: m, attributes: { getPosition: { value: ePos, size: 2 }, getFilterValue: { value: D.eDayF, size: 1 }, getFillColor: { value: D.eColor, size: 4, normalized: true } } },
      getRadius: 50, radiusMinPixels: 1.3, radiusMaxPixels: 9,
      extensions: [new DataFilterExtension({ filterSize: 1 })],
      filterRange: [S.day - 60, S.day], filterSoftRange: [S.day - 20, S.day],
      parameters: { depthTest: false }, updateTriggers: { filterRange: S.day },
    }));
    if (S.network && D.b.owner) {
      const net = ownerNetwork();
      out.push(new ArcLayer({ id: 'owner-net', data: net.arcs, getSourcePosition: a => [b.lon[a.s], b.lat[a.s]], getTargetPosition: a => [b.lon[a.t], b.lat[a.t]],
        getSourceColor: [...PRIORITY, 150], getTargetColor: a => [...ACCENT, 40 + 150 * Math.min(1, a.r * 2)], getWidth: 1, widthMinPixels: 0.5, getHeight: 0.25,
        greatCircle: false, parameters: { depthTest: false }, pickable: true }));
    }
    if (D.alarms && S.day >= todayDay - 1) {
      const cells = D.alarms.clusters.flatMap((c, k) => c.cells.map(p => ({ p, k })));
      out.push(new ScatterplotLayer({
        id: 'alarm-cells', data: cells, getPosition: d => d.p, getRadius: 80, stroked: true, filled: true, pickable: true,
        getFillColor: d => d.k === S.alarm ? [252, 255, 164, 40] : [252, 255, 164, 12],
        getLineColor: d => d.k === S.alarm ? [252, 255, 164, 255] : [252, 255, 164, 150], lineWidthMinPixels: 1,
        updateTriggers: { getFillColor: S.alarm, getLineColor: S.alarm }, parameters: { depthTest: false },
        onClick: ({ object }) => object && pickAlarm(object.k),
      }));
      out.push(new TextLayer({
        id: 'alarm-labels', data: D.alarms.clusters.map((c, k) => ({ p: c.cells[0], k })), getPosition: d => d.p,
        getText: d => String(d.k + 1), getSize: 12, getColor: [252, 255, 164, 255], getPixelOffset: [0, -16],
        fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 600, outlineWidth: 2, outlineColor: [11, 12, 14, 255],
        fontSettings: { sdf: true }, parameters: { depthTest: false },
      }));
    }
  }

  if (v === 'predict') {
    if (S.predict === 'forecast') {
      const frac = Math.max(0.04, Math.min(1, (S.day - todayDay) / D.meta.horizon_days));
      out.push(new HexagonLayer({
        id: 'terrain', data: D.allIdx, getPosition: i => [b.lon[i], b.lat[i]],
        getElevationWeight: i => b.risk[i] / 255, getColorWeight: i => b.risk[i] / 255,
        elevationAggregation: 'SUM', colorAggregation: 'SUM', radius: 260, coverage: 0.88, extruded: map.getPitch() > 5,
        elevationRange: [0, 1100], elevationScale: frac * Math.max(0.3, zf()), upperPercentile: 99.5, opacity: 0.85,
        colorRange: [[20, 11, 52], ...HEAT_RGB], material: { ambient: 0.6, diffuse: 0.5, shininess: 8 },
        transitions: { elevationScale: 250 }, pickable: true,
      }));
    }
    if (S.predict === 'proof') {
      out.push(new ColumnLayer({
        id: 'watch', data: backtestTop.map((i, r) => ({ i, r })), getPosition: d => [b.lon[d.i], b.lat[d.i]],
        getElevation: d => b.risk_backtest[d.i] / 255, elevationScale: 1400 * zf(), radius: 32, diskResolution: 6,
        extruded: map.getPitch() > 5,
        getFillColor: d => hitDay[d.r] <= S.day ? [...HIT, 235] : [...OPEN, 170], updateTriggers: { getFillColor: S.day },
        material: { ambient: 0.65, diffuse: 0.45, shininess: 8 },
      }));
    }
    if (S.predict === 'certified') {
      out.push(new ScatterplotLayer({
        id: 'certified', data: D.certifiedIdx, getPosition: i => [b.lon[i], b.lat[i]], getRadius: 40, radiusMinPixels: 3,
        radiusMaxPixels: 9, getFillColor: [...ACCENT, 230], stroked: true, getLineColor: [11, 12, 14, 255], lineWidthMinPixels: 1,
        pickable: true, parameters: { depthTest: false },
      }));
    }
    if (S.predict === 'neural' && D.falcon) {
      const F = D.falcon, half = F.cell_m * 0.62;
      out.push(new ColumnLayer({
        id: 'neural-field', data: F.top, getPosition: k => F.center(k), getElevation: k => F.rate[k],
        elevationScale: 60 * Math.max(0.3, zf()), radius: half, diskResolution: 4, angle: 45, extruded: map.getPitch() > 5,
        getFillColor: k => { const t = Math.min(1, Math.log1p(F.rate[k]) / Math.log1p(F.rateHi)); return heat(t, 70 + 185 * t); },
        material: { ambient: 0.6, diffuse: 0.5, shininess: 8 }, pickable: true,
      }));
      out.push(new ScatterplotLayer({
        id: 'neural-blind', data: F.blindTop, getPosition: k => F.center(k), getRadius: F.cell_m * 0.75, radiusMinPixels: 5,
        filled: false, stroked: true, getLineColor: [255, 255, 255, 200], lineWidthMinPixels: 1.25, parameters: { depthTest: false }, pickable: true,
      }));
      if (S.crews) out.push(new PathLayer({ id: 'crews', data: S.crews.paths, getPath: p => p, getColor: (p, { index }) => CREW_RGB[index % 4],
        getWidth: 3, widthMinPixels: 2, jointRounded: true, capRounded: true, parameters: { depthTest: false } }));
      out.push(new ScatterplotLayer({
        id: 'neural-ignite', data: F.igniteTop, getPosition: k => F.center(k), getRadius: F.cell_m * 0.9, radiusMinPixels: 6,
        filled: true, stroked: true, getFillColor: [...ACCENT, 40], getLineColor: [...ACCENT, 255], lineWidthMinPixels: 1.75, parameters: { depthTest: false }, pickable: true,
      }));
    }
    if (S.predict !== 'proof' && S.predict !== 'neural') {
      const shown = hotspots.filter(h => S.filter === 'all' || h.asset_class === S.filter);
      out.push(new ColumnLayer({
        id: 'hotspots', data: shown, pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 255],
        getPosition: h => [h.lon, h.lat], getElevation: h => Math.log10(1 + h.usd.exposure),
        elevationScale: 220 * zf(), radius: 40, diskResolution: 4, angle: 45, extruded: map.getPitch() > 5,
        getFillColor: h => h === S.selected ? [255, 255, 255, 255] : [...PRIORITY, 240], updateTriggers: { getFillColor: S.selected },
        onClick: ({ object }) => object && pickHotspot(object),
      }));
    }
    if (S.selected) out.push(ring('sel-ring', [S.selected.lon, S.selected.lat], 200));
  }

  if (v === 'simulate') out.push(...houseLayers());

  if (v === 'act') {
    if (S.act === 'plan' && S.plan.result) {
      const rows = S.plan.result.rows, vmax = Math.max(...rows.slice(0, 50).map(r => r.protected), 1);
      out.push(new ScatterplotLayer({
        id: 'plan', data: rows, getPosition: r => [b.lon[r.i], b.lat[r.i]], pickable: true,
        getRadius: r => 40 + 120 * Math.sqrt(Math.min(1, r.protected / vmax)), radiusMinPixels: 4, radiusMaxPixels: 18,
        getFillColor: r => r.cls === 0 ? [...PRIORITY, 220] : [...ACCENT, 220], stroked: true, getLineColor: [11, 12, 14, 255], lineWidthMinPixels: 1,
        updateTriggers: { getRadius: S.plan.result, getFillColor: S.plan.result }, parameters: { depthTest: false },
      }));
    }
    if (S.act === 'brief' && S.brief) {
      out.push(new ScatterplotLayer({
        id: 'plan', data: S.brief.B.rows, getPosition: r => [b.lon[r.i], b.lat[r.i]], pickable: true,
        getRadius: 90, radiusMinPixels: 9, radiusMaxPixels: 16, getFillColor: [...PRIORITY, 245], stroked: true,
        getLineColor: [11, 12, 14, 255], lineWidthMinPixels: 1.5, parameters: { depthTest: false }, updateTriggers: { getPosition: S.brief.d },
      }));
      out.push(new TextLayer({
        id: 'brief-rank', data: S.brief.B.rows.map((r, k) => ({ p: [b.lon[r.i], b.lat[r.i]], t: String(k + 1) })), getPosition: d => d.p,
        getText: d => d.t, getSize: 11, getColor: [11, 12, 14, 255], fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 600,
        parameters: { depthTest: false }, updateTriggers: { getPosition: S.brief.d },
      }));
    }
    if (S.act === 'portfolio' && S.portfolio.rows) {
      out.push(new ScatterplotLayer({
        id: 'portfolio', data: S.portfolio.rows, getPosition: r => [b.lon[r.i], b.lat[r.i]], pickable: true,
        getRadius: r => 40 + 160 * b.risk[r.i] / 255, radiusMinPixels: 3, radiusMaxPixels: 18,
        getFillColor: r => heat(0.25 + 0.75 * r.share, 230), stroked: true, getLineColor: [...ACCENT, 255], lineWidthMinPixels: 1,
        updateTriggers: { getFillColor: S.portfolio.owner }, parameters: { depthTest: false },
      }));
    }
    if (S.act === 'investor' && D.lists) {
      const L = D.lists.lists.find(l => l.id === S.list) || D.lists.lists[0], col = rgb(LIST_HEX[L.id] || '#e69f00');
      out.push(new ScatterplotLayer({
        id: 'leads', data: L.leads, pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 255],
        getPosition: l => [l.lon, l.lat], getRadius: 60, radiusMinPixels: 3.5, radiusMaxPixels: 10, stroked: true, lineWidthMinPixels: 1,
        getFillColor: l => l === S.lead ? [255, 255, 255, 255] : [...col, 235], getLineColor: [11, 12, 14, 255],
        updateTriggers: { getFillColor: S.lead }, parameters: { depthTest: false }, onClick: ({ object }) => object && pickLead(object),
      }));
      if (S.lead) out.push(ring('lead-ring', [S.lead.lon, S.lead.lat], 250));
    }
  }

  if (S.route && (S.route.kind === 'case' || (v === 'act' && ((S.act === 'brief' && S.route.kind === 'inspect') || (S.act === 'investor' && S.route.kind === 'd4d'))))) {
    const path = S.route.order.map(i => [b.lon[i], b.lat[i]]);
    out.push(new PathLayer({ id: 'route-under', data: [path], getPath: d => d, getColor: [11, 12, 14, 255], getWidth: 7, widthUnits: 'pixels', parameters: { depthTest: false } }));
    out.push(new PathLayer({ id: 'route', data: [path], getPath: d => d, getColor: [...ACCENT, 255], getWidth: 3, widthUnits: 'pixels', jointRounded: true, capRounded: true, parameters: { depthTest: false } }));
    out.push(new ScatterplotLayer({ id: 'route-stops', data: S.route.order, getPosition: i => [b.lon[i], b.lat[i]], getRadius: 60, radiusMinPixels: 9, radiusMaxPixels: 12,
      getFillColor: [231, 231, 233, 255], stroked: true, getLineColor: [...ACCENT, 255], lineWidthMinPixels: 2, pickable: true, parameters: { depthTest: false } }));
    out.push(new TextLayer({ id: 'route-n', data: S.route.order.map((i, k) => ({ p: [b.lon[i], b.lat[i]], t: String(k + 1) })), getPosition: d => d.p, getText: d => d.t,
      getSize: 10, getColor: [11, 12, 14, 255], fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 600, parameters: { depthTest: false } }));
  }
  if (v === 'act' && S.act === 'portfolio' && S.portfolio.pushers?.length) {
    const arcs = S.portfolio.pushers.slice(0, 8).flatMap(x => x.targets.map(t => ({ s: x.i, t, v: x.v })));
    out.push(new ArcLayer({ id: 'pushers', data: arcs, getSourcePosition: a => [b.lon[a.s], b.lat[a.s]], getTargetPosition: a => [b.lon[a.t], b.lat[a.t]],
      getSourceColor: [...PRIORITY, 255], getTargetColor: [...ACCENT, 200], getWidth: 2, getHeight: 0.5 }));
    out.push(new ScatterplotLayer({ id: 'pusher-dots', data: S.portfolio.pushers.slice(0, 8), getPosition: x => [b.lon[x.i], b.lat[x.i]], getRadius: 30, radiusMinPixels: 5,
      getFillColor: [...PRIORITY, 255], stroked: true, getLineColor: [11, 12, 14, 255], lineWidthMinPixels: 1, pickable: true, parameters: { depthTest: false } }));
  }
  if (v === 'evidence' && D.districtLabels) {
    out.push(new TextLayer({
      id: 'district-labels', data: D.districtLabels, getPosition: d => d.p, getText: d => d.t, getSize: 12,
      getColor: [231, 231, 233, 255], fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 600,
      outlineWidth: 2, outlineColor: [11, 12, 14, 255], fontSettings: { sdf: true }, parameters: { depthTest: false },
    }));
  }

  if (liveEv && (onDetect(v) || v === 'simulate')) {
    out.push(new ScatterplotLayer({
      id: 'live', data: liveEv, getPosition: d => [d.lon, d.lat], getRadius: 60, radiusMinPixels: 4, radiusMaxPixels: 10,
      getFillColor: d => [...KIND_RGB[d.kind], 255], stroked: true, getLineColor: [255, 255, 255, 255], lineWidthMinPixels: 1.5,
      parameters: { depthTest: false }, pickable: true,
    }));
  }
  const fw = D.n ? watched().map(x => x.i) : [];
  if (fw.length) {
    out.push(new ScatterplotLayer({
      id: 'watch', data: fw, getPosition: i => [b.lon[i], b.lat[i]], getRadius: 34, radiusMinPixels: 6, radiusMaxPixels: 14,
      filled: false, stroked: true, getLineColor: [255, 255, 255, 220], lineWidthMinPixels: 1.25, parameters: { depthTest: false }, pickable: true,
    }));
  }
  if (S.highlight?.length) {
    out.push(new ScatterplotLayer({
      id: 'highlight', data: S.highlight, getPosition: i => [b.lon[i], b.lat[i]], getRadius: 18, radiusMinPixels: 3, radiusMaxPixels: 8,
      filled: false, stroked: true, getLineColor: [...ACCENT, 255], lineWidthMinPixels: 1.5, parameters: { depthTest: false },
    }));
  }
  return out;
}

function ring(id, p, r) {
  return new ScatterplotLayer({ id, data: [p], getPosition: d => d, getRadius: r, stroked: true, filled: true,
    getFillColor: [...ACCENT, 14], getLineColor: [...ACCENT, 200], lineWidthMinPixels: 1, parameters: { depthTest: false } });
}

function houseLayers() {
  const { b, hawkes } = D, out = [], H = S.house, r = H?.res;
  if (hawkes?.arcs?.length) {
    out.push(new ArcLayer({
      id: 'trigger-arcs', data: hawkes.arcs,
      getSourcePosition: a => [a[0], a[1]], getTargetPosition: a => [a[2], a[3]],
      getSourceColor: a => [...KIND_RGB[HK_TO_KIND[a[6]]], r ? 40 : Math.round(80 + 150 * a[4])],
      getTargetColor: a => [252, 255, 164, r ? 30 : Math.round(60 + 150 * a[4])],
      getWidth: a => 0.5 + 1.8 * a[4], getHeight: 1.4, widthMinPixels: 0.5,
      updateTriggers: { getSourceColor: !!r, getTargetColor: !!r },
    }));
  }
  if (!H) return out;
  const fx = [b.lon[H.i], b.lat[H.i]];
  const rc = H.rc?.steps;
  if (rc?.length > 1) {
    out.push(new PathLayer({ id: 'root-path', data: [rc.map(s => [s.lon, s.lat])], getPath: d => d, getColor: [...PRIORITY, 230],
      getWidth: 3, widthMinPixels: 2.5, capRounded: true, jointRounded: true, parameters: { depthTest: false } }));
    out.push(new ScatterplotLayer({ id: 'root-steps', data: rc, getPosition: s => [s.lon, s.lat], pickable: true,
      getRadius: (s, { index }) => index === 0 ? 16 : 9, radiusMinPixels: 4, stroked: true, filled: true,
      getFillColor: (s, { index }) => index === 0 ? [...PRIORITY, 255] : [20, 22, 26, 255], getLineColor: [...PRIORITY, 255], lineWidthMinPixels: 1.5,
      parameters: { depthTest: false } }));
  }
  out.push(new ScatterplotLayer({
    id: 'house-rings', data: [{ r: 700, a: 70 }, { r: 250, a: 170 }], getPosition: () => fx, getRadius: d => d.r,
    stroked: true, filled: false, getLineColor: d => [...ACCENT, d.a], lineWidthMinPixels: 1,
  }));
  if (!r) return out;
  const t = Math.max(0, Math.min(90, S.day - todayDay)), N = r.N, pBy = (r.withS || r.base).pBy, stab = new Set(H.stab);
  out.push(new ColumnLayer({
    id: 'house-odds', data: Array.from({ length: N }, (_, a) => a), pickable: true,
    getPosition: a => [b.lon[r.glob[a]], b.lat[r.glob[a]]],
    getElevation: a => stab.has(r.glob[a]) ? 0.02 : pBy[t * N + a],
    elevationScale: 900 * Math.min(1, zf() * 2.2), radius: 7, diskResolution: 6, extruded: map.getPitch() > 5,
    getFillColor: a => {
      const g = r.glob[a];
      if (g === H.i) return [255, 255, 255, 255];
      if (stab.has(g)) return [...STAB, 255];
      const p = pBy[t * N + a]; return heat(p / 0.4, 110 + 145 * Math.min(1, p / 0.2));
    },
    updateTriggers: { getElevation: [t, r, H.stab.join()], getFillColor: [t, r, H.stab.join()] },
    onClick: ({ object }) => object !== undefined && pickHouse(r.glob[object]),
    material: { ambient: 0.65, diffuse: 0.45, shininess: 8 },
  }));
  if (H.stab.length) {
    out.push(new ScatterplotLayer({
      id: 'house-stab', data: H.stab, getPosition: g => [b.lon[g], b.lat[g]], getRadius: 26, radiusMinPixels: 6,
      stroked: true, filled: true, getFillColor: [...STAB, 40], getLineColor: [...STAB, 255], lineWidthMinPixels: 1.5,
      parameters: { depthTest: false },
    }));
  }
  if (r.outbound?.length) {
    const omax = Math.max(...r.outbound.map(o => o.v), 1e-9);
    out.push(new ArcLayer({
      id: 'house-outbound', data: r.outbound, getSourcePosition: () => fx, getTargetPosition: o => [b.lon[o.g], b.lat[o.g]],
      getSourceColor: [...ACCENT, 255], getTargetColor: [...ACCENT, 90], getWidth: o => 1 + 3 * o.v / omax, getHeight: 0.6,
    }));
  }
  const top = r.drivers.top.filter(d => !d.self), vmax = Math.max(...top.map(d => d.v), 1e-9);
  out.push(new ArcLayer({
    id: 'house-drivers', data: top, getSourcePosition: d => [d.lon, d.lat], getTargetPosition: () => fx,
    getSourceColor: d => [...KIND_RGB[d.kind], 255], getTargetColor: [255, 255, 255, 255],
    getWidth: d => 1.5 + 4 * d.v / vmax, getHeight: 0.9,
  }));
  return out;
}

// ---------- timebar ----------

function range() {
  const v = S.view;
  if (onDetect(v)) return [0, todayDay];
  if (v === 'predict' && S.predict === 'proof') return [cutoffDay, cutoffDay + 90];
  if (v === 'predict' || v === 'simulate') return [todayDay, todayDay + D.meta.horizon_days];
  return null;
}

function drawTimebar() {
  const rg = range();
  $('timebar').hidden = !rg;
  $('stage').classList.toggle('no-time', !rg);
  if (!rg) return;
  const [lo, hi] = rg, sl = $('slider');
  sl.min = lo; sl.max = hi;
  const parts = [];
  for (let k = 0; k <= 4; k++) parts.push(`<span style="left:${k * 25}%">${fmtDate(dayToDate(D.meta, lo + Math.round((hi - lo) * k / 4)))}</span>`);
  $('ticks').innerHTML = parts.join('');
  drawHist();
}

function histValues() {
  const rg = range(); if (!rg) return null;
  const [lo, hi] = rg, span = hi - lo;
  const bins = Math.min(104, span), w = span / bins, vals = new Float32Array(bins);
  if (onDetect(S.view)) {
    for (let j = 0; j < D.m; j++) { const d = D.e.day[j]; if (D.e.kind[j] === 6 || d < lo || d >= hi) continue; vals[Math.floor((d - lo) / w)]++; }
  } else if (S.view === 'predict' && S.predict === 'proof') {
    for (let r = 0; r < hitDay.length; r++) { const d = hitDay[r]; if (d >= lo && d < hi) vals[Math.floor((d - lo) / w)]++; }
  } else if (S.view === 'simulate' && S.house?.res) {
    const c = (S.house.res.withS || S.house.res.base).cumDaily;
    for (let t = 0; t < span; t++) vals[Math.floor(t / w)] += c[t + 1] - c[t];
  } else {
    // Forecast: expected new reports per day, the sum of every building's 90-day risk spread evenly.
    vals.fill(D.expected / bins);
  }
  return { vals, lo, w };
}
function drawHist() {
  const h = histValues(), svg = $('hist'); if (!h) return;
  const { vals, lo, w } = h, max = Math.max(...vals, 1), n = vals.length;
  svg.setAttribute('viewBox', `0 0 ${n} 24`);
  svg.innerHTML = Array.from(vals, (v, k) => `<rect x="${k + 0.1}" width="0.8" y="${24 - 22 * v / max}" height="${22 * v / max}" class="${lo + (k + 1) * w <= S.day ? 'past' : ''}"/>`).join('');
}

function caption() {
  const v = S.view, { meta } = D;
  if (onDetect(v)) return S.day >= todayDay - 1
    ? `Each dot is a 311 report about a building in the 60 days to this date, coloured by type. Squares: emerging clusters today.`
    : `Replaying reports. Each dot fades out after 60 days.`;
  if (v === 'predict' && S.predict === 'proof') {
    const landed = hitDay.reduce((a, d) => a + (d <= S.day ? 1 : 0), 0);
    return `Model frozen on ${fmtDate(dayToDate(meta, cutoffDay))}. Day ${Math.max(0, S.day - cutoffDay)} of 90: a report has landed at ${landed.toLocaleString()} of the ${backtestTop.length.toLocaleString()} flagged buildings.`;
  }
  if (v === 'predict') {
    const frac = Math.max(0, Math.min(1, (S.day - todayDay) / meta.horizon_days));
    return `${Math.round(D.expected * frac).toLocaleString()} new property reports expected citywide by this date. Hex height and colour: expected reports per 260 m hex.`;
  }
  if (v === 'simulate') {
    const r = S.house?.res, t = Math.max(0, S.day - todayDay);
    if (!S.house) return `Arcs join each report since ${D.hawkes?.arcs_window_start || '—'} to the earlier report that most likely set it off.`;
    if (!r) return S.house.status || 'Simulating…';
    return `Day ${t} of 90: each column is one building's chance of a new report by then, across ${r.runs} simulated futures.`;
  }
  return '';
}

function redraw() {
  const rg = range();
  if (rg) {
    S.day = Math.max(rg[0], Math.min(rg[1], S.day));
    $('date').textContent = fmtDate(dayToDate(D.meta, S.day));
    $('caption').textContent = caption();
    $('slider').value = S.day;
    $('hist').querySelectorAll('rect').forEach((el, k, all) => {
      const w = (rg[1] - rg[0]) / all.length; el.classList.toggle('past', rg[0] + (k + 1) * w <= S.day);
    });
  }
  overlay.setProps({ layers: layers() });
}

let lastT = 0;
function tick(t) {
  if (!S.playing) return;
  if (t - lastT > 60) {
    lastT = t;
    const hi = +$('slider').max;
    S.day += onDetect(S.view) ? S.speed : Math.max(1, Math.round(S.speed / 3));
    if (S.day >= hi) { S.day = hi; setPlaying(false); }
    redraw();
  }
  requestAnimationFrame(tick);
}
function setPlaying(on) {
  S.playing = on;
  $('play').innerHTML = on ? '<svg width="10" height="12" viewBox="0 0 10 12"><path d="M0 0h3v12H0zM7 0h3v12H7z" fill="currentColor"/></svg>'
    : '<svg width="10" height="12" viewBox="0 0 10 12"><path d="M0 0l10 6-10 6z" fill="currentColor"/></svg>';
  if (on) requestAnimationFrame(tick);
}

// ---------- views ----------

// ---------- home ----------

// Where each alarm is, in words: the building nearest the cluster's centre (homes shown at the block).
const alarmWhere = new Map();
function whereOf(k) {
  if (alarmWhere.has(k)) return alarmWhere.get(k);
  const c = D.alarms.clusters[k], gs = clusterBuildings(c);
  const lon = c.cells.reduce((a, p) => a + p[0], 0) / c.cells.length, lat = c.cells.reduce((a, p) => a + p[1], 0) / c.cells.length;
  let best = -1, bd = Infinity;
  for (const g of gs) { const d = Math.hypot((D.b.lon[g] - lon) * M_LON, (D.b.lat[g] - lat) * M_LAT); if (d < bd) { bd = d; best = g; } }
  const w = best >= 0 ? label(best) : `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  alarmWhere.set(k, w);
  return w;
}

function roleMoves(role) {
  const go = (fn, view) => () => { fn(); setView(view); render(); };
  const f = D.meta.audit?.fairness?.districts?.find(x => x.district === worstDistrict());
  const cert = D.evidence?.live?.certified;
  if (role === 'owner') {
    const o = bestOwner(), name = D.search?.owners?.[o - 1]?.label || 'the most exposed portfolio';
    const hot = D.hotspots[0], W = watched().length;
    return [
      { title: `See what the neighbours cost ${name}`, why: 'the share of its 90-day risk that comes from buildings it does not own, and which ones to fix first', run: go(() => { S.act = 'portfolio'; setOwner(o); }, 'act') },
      { title: 'Stress-test one building', why: `400 futures for ${esc(label(hot.i))} and its neighbours, then the three repairs that spare the most`, run: () => openHouse(hot.i) },
      { title: W ? `Check ${W} followed ${W === 1 ? 'building' : 'buildings'}` : 'Follow the buildings you manage', why: 'ringed on the map; new 311 reports at or near them are flagged here first', run: () => ACTIONS.find(a => a.label === 'Detect: my watchlist').run() },
    ];
  }
  if (role === 'buyer') {
    const L = D.lists?.lists || [], n = new Set(L.flatMap(l => l.leads.map(x => x.parcel_id))).size;
    return [
      { title: 'Leads ranked by expected fee per contact', why: `${n.toLocaleString()} distressed, non-owner-occupied leads, scored with the WHOLZR deal desk`, run: go(() => { S.act = 'investor'; S.leadSort = 'efc'; }, 'act') },
      { title: 'Plan a drive-for-dollars loop', why: 'the densest ZIP of the current list, ordered nearest-neighbour plus 2-opt', run: () => { S.act = 'investor'; setView('act'); handlers.d4d(); } },
      ...(D.falcon ? [{ title: 'Quiet blocks the neural field expects to report', why: 'blind spots: built-up cells silent for 12 weeks that the network expects to light up', run: go(() => { S.predict = 'neural'; }, 'predict') }] : []),
    ];
  }
  return [
    { title: `Tomorrow's route for council district ${worstDistrict()}`, why: f ? `${f.cases.toLocaleString()} cases last quarter and under-served by a raw ranking; the brief re-ranks it fairly` : 'one-page brief and an inspection route', run: go(() => { S.act = 'brief'; setBrief(worstDistrict()); }, 'act') },
    ...(cert ? [{ title: `Certified list: ${cert.toLocaleString()} buildings`, why: 'at most 10% expected wrong (conformal selection); it held at 7.1% on the last held-out quarter', run: go(() => { S.predict = 'certified'; }, 'predict') }] : []),
    { title: `Spend ${kusd(S.plan.budget)} where it prevents the most`, why: 'interventions ranked by reports prevented per dollar, exported as work orders', run: go(() => { S.act = 'plan'; computePlan(); }, 'act') },
  ];
}

function homeModel() {
  const W = watchRows();
  const alarms = (D.alarms?.clusters || []).map((c, k) => ({ k, where: whereOf(k), observed: c.observed, expected: c.expected, window: c.window_days, buildings: c.buildings }));
  return {
    alarms, cases: listCases(), moves: roleMoves(S.role), live: S.live, health: healthRows(D, S.live),
    watchHits: W.filter(w => w.liveN || w.live > 0.001).length,
  };
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- film mode: the tour, full screen, with title and end cards, for recording a promo ----------

function film() {
  if (filmActive()) return;
  stopPlaybook(); stopTour();
  const m = D.meta;
  startFilm({
    open: { kicker: 'Firebreak', title: 'Property distress spreads like fire.', sub: `${m.counts.buildings.toLocaleString()} Dallas buildings. ${m.counts.reports.toLocaleString()} city reports. One question: where does it go next?` },
    close: { kicker: 'Firebreak', title: 'Predict it. Trace it. Stop it.', sub: 'Built on public data, tested on a quarter the model never saw. HackUTD 2026 · CBRE' },
    run: onEnd => runTour(onEnd),
    stop: () => stopTour(),
  });
}

const handlers = {
  alarm: k => pickAlarm(k),
  role: r => { S.role = r; store('fb-role', r); render(); },
  homeAlarm: k => { if (S.alarm !== k) pickAlarm(k); else render(); },
  caseTab: t => { S.caseTab = t; render(); },
  caseOpen: id => { S.caseOpen = S.caseOpen === id ? null : id; render(); },
  caseAdvance: (id, note) => { advanceCase(id, note); render(); },
  caseRemove: id => { removeCase(id); if (S.caseOpen === id) S.caseOpen = null; render(); },
  caseMap: id => {
    const c = getCase(id); if (!c?.stopsIdx) return;
    setRoute('case', c.stopsIdx); S.highlight = c.stopsIdx; redraw();
  },
  casesCsv: () => download(`firebreak-cases-${D.meta.as_of}.csv`, casesCSV(), 'text/csv'),
  film: () => film(),
  house: i => openHouse(i),
  crews: () => { if (S.crews) { S.crews = null; render(); redraw(); } else dispatchCrews(); },
  falconCell: k => { const [lon, lat] = D.falcon.center(k); fly(lon, lat, 15.2); },
  sub: k => { if (S.view === 'predict') { S.predict = k; S.day = k === 'proof' ? cutoffDay : todayDay + 45; if (k === 'neural') home(); } else { S.act = k; if (k === 'plan') computePlan(); if (k === 'brief') setBrief(S.brief?.d || worstDistrict()); } render(); },
  filter: c => { S.filter = c; render(); },
  hotspot: x => pickHotspot(x),
  budget: v => { S.plan.budget = v; computePlan(false); render(); },
  cost: (k, v) => { if (v > 0) { S.plan.costs[k] = v; store('fb-costs', S.plan.costs); computePlan(); render(); } },
  csv: () => exportPlan(),
  approve: () => { S.planApproved = true; store('fb-plan-approved', new Date().toISOString()); render(); },
  owner: o => { setOwner(o); render(); },
  district: d => { setBrief(d); render(); },
  copyBrief: async btn => { const t = briefText(S.brief.B); try { await navigator.clipboard.writeText(t); btn.textContent = 'Copied'; } catch { $('brief-text').hidden = false; } },
  tour: () => runTour(),
  unwatch: i => { toggleWatch(i); render(); redraw(); },
  playbook: k => runPlaybook(k),
  leadSort: k => { S.leadSort = k; render(); },
  network: () => { S.network = !S.network; if (S.network) { ownerNetwork(); home(); } render(); },
  route: n => { if (S.act === 'brief') setRoute('inspect', S.brief.B.allRows.slice(0, n).map(x => x.i)); render(); },
  d4d: () => {
    const L = D.lists.lists.find(l => l.id === S.list) || D.lists.lists[0], byZip = new Map();
    for (const l of L.leads.slice(0, 150)) if (l.i >= 0) (byZip.get(l.zip) || byZip.set(l.zip, []).get(l.zip)).push(l.i);
    const best = [...byZip.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (best) { setRoute('d4d', best[1].slice(0, 20)); S.route.zip = best[0]; }
    render();
  },
  clearRoute: () => { S.route = null; render(); },
  geojson: () => exportGeo(),
  buyers: i => naturalBuyers(i),
  pushOn: i => openHouse(i),
  list: id => { S.list = id; S.lead = null; if (S.route?.kind === 'd4d') S.route = null; render(); },
  lead: l => pickLead(l),
};

function render() {
  const v = S.view;
  document.querySelectorAll('#views button').forEach(x => x.classList.toggle('on', x.dataset.view === v));
  if (v === 'home') renderHome(D, S, handlers, homeModel());
  if (v === 'detect') { S.watch = watchRows(); renderDetect(D, S, handlers); }
  if (v === 'predict') renderPredict(D, S, handlers);
  if (v === 'simulate') S.house ? renderHouse(D, S.house, houseActions()) : renderSimulateIdle(D);
  if (v === 'act') {
    if (S.act === 'plan' && !S.plan.result) computePlan();
    if (S.act === 'brief' && !S.brief) setBrief(worstDistrict());
    if (S.brief) S.brief.text = briefText(S.brief.B);
    renderAct(D, S, handlers);
  }
  if (v === 'evidence') renderEvidence(D);
  renderLegend(v, S, D);
  drawTimebar();
  redraw();
}

function setView(v, opts = {}) {
  if (!VIEWS.includes(v)) v = 'home';
  const changed = v !== S.view;
  S.view = v; setPlaying(false);
  if (changed) {
    S.selected = null; S.lead = null; S.alarm = null;
    $('detail').hidden = true;
    if (onDetect(v)) S.day = todayDay;
    if (v === 'predict') S.day = S.predict === 'proof' ? cutoffDay : todayDay + 45;
    if (v === 'simulate') S.day = todayDay + 90;
    if (v !== 'simulate' && map.getZoom() > 12.5) home();
  }
  render();
  if (!opts.keepHash) setHash();
  $('side').scrollTop = 0;
}

// ---------- hash routing: #detect, #simulate-b123 ----------

let ownHash = '';
function setHash() {
  const h = S.view === 'simulate' && S.house ? `simulate-b${S.house.i}` : S.view;
  if (location.hash.slice(1) === h) return;
  ownHash = h; location.hash = h;
}
function readHash() {
  const h = location.hash.slice(1);
  if (h === ownHash) return;
  if (h === 'film') { setView('home', { keepHash: true }); film(); return; }
  const m = h.match(/^(home|detect|predict|simulate|act|evidence)(?:-b(\d+))?$/);
  if (!m) return setView('home', { keepHash: true });
  if (m[2] && +m[2] < D.n) { openHouse(+m[2], { keepHash: true }); return; }
  setView(m[1], { keepHash: true });
}

// ---------- detect ----------

function pickAlarm(k) {
  S.alarm = S.alarm === k ? null : k;
  if (S.alarm !== null) {
    const c = D.alarms.clusters[k], lon = c.cells.reduce((a, p) => a + p[0], 0) / c.cells.length, lat = c.cells.reduce((a, p) => a + p[1], 0) / c.cells.length;
    fly(lon, lat, 14.6);
  }
  render();
}

// ---------- predict ----------

function pickHotspot(x) {
  S.selected = x;
  renderDossier(x, D, i => { S.selected = null; if (i !== undefined) openHouse(i); else redraw(); });
  fly(x.lon, x.lat, 15);
  redraw();
}

// ---------- simulate (worker) ----------

function houseActions() {
  return {
    close: () => { S.house = null; S.highlight = null; home(); render(); setHash(); },
    toggle: () => {
      const H = S.house, k = H.stab.indexOf(H.i);
      if (k >= 0) H.stab.splice(k, 1); else H.stab.push(H.i);
      H.fb = null; runSim();
    },
    clear: () => { S.house.stab = []; S.house.fb = null; runSim(); },
    watching: i => isWatched(i),
    watch: i => { toggleWatch(i); renderHouse(D, S.house, houseActions()); redraw(); },
    shock: n => { S.house.shock = n; runSim(); },
    firebreaks: () => {
      const H = S.house; H.busy = true; H.status = 'Searching for firebreaks…';
      renderHouse(D, H, houseActions());
      sim.postMessage({ type: 'firebreaks', i: H.i, k: 3, stab: H.stab.filter(g => g !== H.i) });
    },
    fly: g => fly(D.b.lon[g], D.b.lat[g], 16.4),
    open: g => openHouse(g),
  };
}
function runSim() {
  const H = S.house;
  H.busy = true; H.status = simReady ? `Simulating ${RUNS} futures…` : 'Indexing 241,588 buildings for the simulator…';
  renderHouse(D, H, houseActions());
  sim.postMessage({ type: 'focus', i: H.i, stab: H.stab, runs: RUNS, seed: SEED, shock: H.shock || 0 });
}
function onSim({ data: msg }) {
  const H = S.house;
  if (msg.type === 'ready') { simReady = true; if (H && !H.res) { H.status = `Simulating ${RUNS} futures…`; if (S.view === 'simulate') renderHouse(D, H, houseActions()); } return; }
  if (!H) return;
  if (msg.type === 'progress') { H.status = msg.text; const el = $('h-status'); if (el) el.textContent = msg.text; return; }
  if (msg.type === 'firebreaks') { H.fb = msg; H.stab = [...new Set([...H.stab.filter(g => g !== H.i), ...msg.picks.map(p => p.g)])]; return runSim(); }
  if (msg.type === 'result' && msg.i === H.i) {
    H.res = msg; H.busy = false; H.status = '';
    if (S.view === 'simulate') { renderHouse(D, H, houseActions()); drawHist(); redraw(); }
  }
}
function pickHouse(i) {
  const prev = S.house;
  S.house = { i, stab: prev ? prev.stab : [], res: null, fb: null, busy: true, status: '', shock: 0, rc: rootOf(i) };
  if (!prev || Math.hypot((D.b.lon[prev.i] - D.b.lon[i]) * M_LON, (D.b.lat[prev.i] - D.b.lat[i]) * M_LAT) > 400) {
    S.house.stab = []; fly(D.b.lon[i], D.b.lat[i], 15.6);
  }
  if (!sim) { S.house.status = 'Simulator needs hawkes.json and the mu column.'; renderHouse(D, S.house, houseActions()); return; }
  runSim(); drawHist(); redraw();
}
// Root cause of a building's latest report: the chain of earlier reports that most likely set it off.
function stepInfo(j, p) {
  const e = D.e, g = e.b[j];
  return { j, g, p, lon: e.lon[j], lat: e.lat[j], date: fmtDate(dayToDate(D.meta, e.day[j])), kind: KIND_OF(e.kind[j]) };
}
function rootOf(i) {
  if (!D.hawkes?.params || !D.e.new_case) return null;
  const j = latestReport(D, i, todayDay);
  if (j < 0) return { none: true };
  const c = chain(D, j);
  // Repeat reports at one building are one link in the story: merge consecutive steps at the same building.
  const steps = [];
  for (const x of c.steps.map(t => stepInfo(t.j, t.p))) {
    const last = steps[steps.length - 1];
    if (last && last.g === x.g && x.g >= 0) { last.n++; last.p = x.p; last.lastDate = x.date; } else steps.push({ ...x, n: 1, lastDate: x.date });
  }
  return { steps, prob: c.prob, originBg: c.originBg, kids: childrenOf(D, c.origin, 120).length };
}
function openHouse(i, opts = {}) {
  $('detail').hidden = true;
  if (S.view !== 'simulate') { S.view = 'simulate'; S.selected = null; S.lead = null; S.alarm = null; S.day = todayDay + 90; setPlaying(false); }
  document.querySelectorAll('#views button').forEach(x => x.classList.toggle('on', x.dataset.view === 'simulate'));
  renderLegend('simulate', S, D);
  drawTimebar();
  pickHouse(i);
  if (!opts.keepHash) setHash();
  $('side').scrollTop = 0;
}

// ---------- act: budget plan, portfolio, leads ----------

let resVal = null, planOrder = null;
// Home value within 200 m of each candidate building (the spillover base), computed once.
function computeResVal(cands) {
  const { b, n } = D, R = D.meta.assumptions.spillover_radius_m.value, cell = 0.0025, grid = new Map();
  for (let i = 0; i < n; i++) {
    if (b.class[i] !== 0) continue; // single-family homes only, the population the 0.9% estimate comes from
    const k = Math.floor(b.lon[i] / cell) * 100000 + Math.floor(b.lat[i] / cell);
    (grid.get(k) || grid.set(k, []).get(k)).push(i);
  }
  const out = new Map();
  for (const i of cands) {
    const gx = Math.floor(b.lon[i] / cell), gy = Math.floor(b.lat[i] / cell);
    let s = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const list = grid.get((gx + dx) * 100000 + gy + dy); if (!list) continue;
      for (const j of list) {
        if (j === i) continue;
        const ddx = (b.lon[j] - b.lon[i]) * M_LON, ddy = (b.lat[j] - b.lat[i]) * M_LAT;
        if (ddx * ddx + ddy * ddy <= R * R) s += b.value[j];
      }
    }
    out.set(i, s);
  }
  return out;
}
function computePlan(resort = true) {
  const { b, n } = D;
  if (!b.spare) { S.plan.result = { n: 0, spent: 0, reports: 0, spared: 0, protected: 0, rows: [] }; return; }
  const spill = D.meta.assumptions.spillover_pct_per_case.value;
  if (!resVal) {
    const score = new Float32Array(n);
    for (let i = 0; i < n; i++) score[i] = b.risk[i] / 255 + b.spare[i];
    resVal = computeResVal(topIndices(score, 20000));
  }
  if (resort || !planOrder) {
    const costOf = c => c === 0 ? S.plan.costs.home : c === 1 ? S.plan.costs.multifamily : S.plan.costs.commercial;
    planOrder = [...resVal.entries()].map(([i, rv]) => {
      const own = b.risk[i] / 255, spare = b.spare[i], cost = costOf(b.class[i]);
      const prot = (own + spare) * spill * rv;
      return { i, cls: b.class[i], own, spare, cost, protected: prot, ratio: (own + spare) / cost };
    }).sort((x, y) => y.ratio - x.ratio);
  }
  let spent = 0; const rows = [];
  for (const r of planOrder) { if (spent + r.cost > S.plan.budget) continue; rows.push(r); spent += r.cost; if (spent >= S.plan.budget) break; }
  // Efficient frontier: reports prevented as the budget grows, along the same ranking.
  if (resort || !S.plan.frontier) {
    const fr = [[0, 0]]; let c = 0, r = 0, next = 50000;
    for (const x of planOrder) { c += x.cost; r += x.own + x.spare; if (c >= next) { fr.push([c, r]); next += 50000; } if (c > 3e6) break; }
    S.plan.frontier = fr;
  }
  S.plan.result = {
    n: rows.length, spent, rows,
    reports: rows.reduce((a, r) => a + r.own + r.spare, 0), spared: rows.reduce((a, r) => a + r.spare, 0),
    protected: rows.reduce((a, r) => a + r.protected, 0),
  };
}
function exportGeo() {
  const rows = S.act === 'brief' && S.brief ? S.brief.B.allRows.slice(0, 50) : S.plan.result.rows, b = D.b;
  const fc = { type: 'FeatureCollection', features: rows.map((r, k) => ({ type: 'Feature',
    geometry: { type: 'Point', coordinates: [+b.lon[r.i].toFixed(6), +b.lat[r.i].toFixed(6)] },
    properties: { rank: k + 1, building: label(r.i), class: CLASS[r.cls], council_district: b.district[r.i], cost_usd: r.cost,
      own_risk_90d: +r.own.toFixed(4), reports_spared_nearby: +r.spare.toFixed(4), distress_factor: factorOf(r.own) } })) };
  const blob = new Blob([JSON.stringify(fc)], { type: 'application/geo+json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `firebreak-${D.meta.as_of}.geojson`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportPlan() {
  const rows = S.plan.result.rows, b = D.b;
  const head = 'rank,building,class,council_district,cost_usd,own_risk_90d,reports_spared_nearby,value_protected_usd,lon,lat';
  const lines = rows.map((r, k) => [k + 1, `"${label(r.i).replace(/"/g, '""')}"`, CLASS[r.cls], b.district?.[r.i] || '', r.cost,
    r.own.toFixed(3), r.spare.toFixed(3), Math.round(r.protected), b.lon[r.i].toFixed(5), b.lat[r.i].toFixed(5)].join(','));
  const blob = new Blob([[head, ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `firebreak-work-orders-${D.meta.as_of}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function setOwner(o) {
  const P = S.portfolio, b = D.b;
  P.owner = o; P.rows = null; P.inbound = 0;
  if (!o || !b.owner) { S.highlight = null; redraw(); return; }
  let tot = 0, nb = 0; const rows = [];
  for (let i = 0; i < D.n; i++) {
    if (b.owner[i] !== o) continue;
    const share = b.push_share[i] / 255, t = share > 0 ? b.push_nb[i] / share : b.mu[i] * 90;
    rows.push({ i, nb: b.push_nb[i], share });
    tot += t; nb += b.push_nb[i];
  }
  rows.sort((x, y) => b.risk[y.i] - b.risk[x.i]);
  P.rows = rows; P.inbound = tot > 0 ? nb / tot : 0;
  P.pushers = D.hawkes ? pushersOn(rows.map(r => r.i)).slice(0, 12) : [];
  if (rows.length) {
    const lons = rows.map(r => b.lon[r.i]), lats = rows.map(r => b.lat[r.i]);
    fitFlat([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 80, maxZoom: 15, duration: 900 });
  }
}
function pickLead(l) {
  S.lead = l;
  renderLead(l, D, () => { S.lead = null; redraw(); }, i => (D.search && D.b.owner ? naturalBuyers(i) : []));
  fly(l.lon, l.lat, 15);
  redraw();
}

// ---------- routes: tomorrow's inspection run, or a drive-for-dollars loop ----------
// Placeholders, labelled in the panel: city driving speed, a road-network detour factor over straight
// lines, and minutes spent at each stop.
export const ROUTE = { kmh: 30, detour: 1.3, minPerStop: 12 };
function metres(i, j) { const dx = (D.b.lon[i] - D.b.lon[j]) * M_LON, dy = (D.b.lat[i] - D.b.lat[j]) * M_LAT; return Math.sqrt(dx * dx + dy * dy); }
function planRoute(stops) {
  const n = stops.length; if (n < 2) return { order: stops, km: 0, minutes: n * ROUTE.minPerStop };
  // Nearest neighbour from the westernmost stop, then 2-opt until no swap helps.
  let start = 0; for (let k = 1; k < n; k++) if (D.b.lon[stops[k]] < D.b.lon[stops[start]]) start = k;
  const left = new Set(stops.map((_, k) => k)); left.delete(start);
  const ord = [start];
  while (left.size) { const last = stops[ord[ord.length - 1]]; let best = -1, bd = Infinity; for (const k of left) { const d = metres(last, stops[k]); if (d < bd) { bd = d; best = k; } } ord.push(best); left.delete(best); }
  const dist = (a, b) => metres(stops[ord[a]], stops[ord[b]]);
  let improved = true, guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let a = 0; a < n - 2; a++) for (let c = a + 2; c < n - 1; c++) {
      if (dist(a, a + 1) + dist(c, c + 1) > dist(a, c) + dist(a + 1, c + 1) + 1e-6) { ord.splice(a + 1, c - a, ...ord.slice(a + 1, c + 1).reverse()); improved = true; }
    }
  }
  const order = ord.map(k => stops[k]);
  let m = 0; for (let k = 1; k < n; k++) m += metres(order[k - 1], order[k]);
  const km = m / 1000 * ROUTE.detour;
  return { order, km, minutes: km / ROUTE.kmh * 60 + n * ROUTE.minPerStop };
}
function mapsLink(order) {
  const pts = order.slice(0, 10).map(i => `${D.b.lat[i].toFixed(5)},${D.b.lon[i].toFixed(5)}`);
  return `https://www.google.com/maps/dir/${pts.join('/')}`;
}
function setRoute(kind, stops) {
  S.route = stops?.length ? { kind, ...planRoute(stops) } : null;
  if (S.route) {
    const lons = S.route.order.map(i => D.b.lon[i]), lats = S.route.order.map(i => D.b.lat[i]);
    fitFlat([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 90, maxZoom: 15.5, duration: 900 });
    S.route.link = mapsLink(S.route.order);
  }
}

// ---------- hidden dependencies between owners ----------

let recentGrid = null;
const HK_OF = [0, 1, 2, -1, 3, 4, -1], HK_KEYS = ['code', 'rental', 'tenant', 'vacancy', 'nuisance'];
function recentEvents() {
  if (recentGrid) return recentGrid;
  const e = D.e, p = D.hawkes.params, lo = todayDay - p.window_days, g = new Map();
  for (let j = lowerDay(lo); j < D.m; j++) {
    if (!e.new_case[j] || HK_OF[e.kind[j]] < 0 || e.b[j] < 0 || e.day[j] > todayDay) continue;
    const k = Math.floor(e.lon[j] / 0.003) * 100000 + Math.floor(e.lat[j] / 0.003);
    (g.get(k) || g.set(k, []).get(k)).push(j);
  }
  return (recentGrid = g);
}
// Expected reports over 90 days that outside buildings' recent reports set off at a set of owned
// buildings (the Hawkes neighbour kernel), summed by the outside building they come from.
function pushersOn(owned) {
  const p = D.hawkes.params, e = D.e, g = recentEvents(), mine = new Set(owned);
  const keep = (1 - p.fast_share) * (1 - Math.exp(-p.beta_slow * 90)), R = p.radius_m;
  const by = new Map();
  for (const t of owned) {
    const gx = Math.floor(D.b.lon[t] / 0.003), gy = Math.floor(D.b.lat[t] / 0.003);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const j of g.get((gx + dx) * 100000 + gy + dy) || []) {
        const src = e.b[j]; if (mine.has(src)) continue;
        const ddx = (e.lon[j] - D.b.lon[t]) * M_LON, ddy = (e.lat[j] - D.b.lat[t]) * M_LAT, d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d > R) continue;
        const v = p.a_nb[HK_KEYS[HK_OF[e.kind[j]]]] * Math.exp(-d / p.sigma_m) * keep * Math.exp(-p.beta_slow * (todayDay - e.day[j]));
        const o = by.get(src) || by.set(src, { i: src, v: 0, targets: new Set() }).get(src);
        o.v += v; o.targets.add(t);
      }
    }
  }
  return [...by.values()].map(o => ({ i: o.i, v: o.v, n: o.targets.size, targets: [...o.targets] })).sort((x, y) => y.v - x.v);
}
// Natural buyers for a house: company portfolios with buildings inside its spread radius, weighted by
// the same distance kernel. The owner next door has the most to lose if this house tips.
function naturalBuyers(i) {
  const b = D.b, p = D.hawkes?.params, R = p?.radius_m || 250, sig = p?.sigma_m || 50, by = new Map();
  const cell = 0.003, gx = Math.floor(b.lon[i] / cell), gy = Math.floor(b.lat[i] / cell);
  if (!D.bGrid) { D.bGrid = new Map(); for (let k = 0; k < D.n; k++) { const key = Math.floor(b.lon[k] / cell) * 100000 + Math.floor(b.lat[k] / cell); (D.bGrid.get(key) || D.bGrid.set(key, []).get(key)).push(k); } }
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const k of D.bGrid.get((gx + dx) * 100000 + gy + dy) || []) {
    const o = b.owner[k]; if (!o || k === i || o === b.owner[i]) continue;
    const d = metres(i, k); if (d > R) continue;
    const x = by.get(o) || by.set(o, { o, w: 0, n: 0, value: 0 }).get(o);
    x.w += Math.exp(-d / sig); x.n++; x.value += b.value[k];
  }
  return [...by.values()].sort((x, y) => y.w - x.w).slice(0, 3).map(x => ({ ...x, label: D.search.owners[x.o - 1].label, total: D.search.owners[x.o - 1].buildings }));
}

// ---------- the hidden network: same-owner links ----------
// For every company portfolio with a property report in the last year, an arc from the building that had
// the report to each of the owner's other buildings: the "same owner" dependency measured at 1.20x.
function ownerNetwork() {
  if (D.ownerNet) return D.ownerNet;
  const b = D.b, e = D.e, src = new Map(), members = new Map();
  for (let i = 0; i < D.n; i++) { const o = b.owner[i]; if (o) (members.get(o) || members.set(o, []).get(o)).push(i); }
  for (let j = lowerDay(todayDay - 365); j < D.m; j++) {
    const g = e.b[j]; if (g < 0 || e.kind[j] === 6) continue;
    const o = b.owner[g]; if (o) src.set(o, g);
  }
  const arcs = [];
  for (const [o, g] of src) {
    const others = members.get(o).filter(i => i !== g);
    others.sort((x, y) => b.risk[y] - b.risk[x]);
    for (const t of others.slice(0, 6)) arcs.push({ s: g, t, o, r: b.risk[t] / 255 });
  }
  arcs.sort((x, y) => y.r - x.r);
  const links = [...src.keys()].reduce((n, o) => n + members.get(o).length - 1, 0);
  return (D.ownerNet = { arcs: arcs.slice(0, 900), owners: src.size, links });
}

// ---------- watchlist ----------
// Followed buildings are kept in this browser only (localStorage). Every number on a row is recomputed from the
// data files and the live feed each time; nothing about a followed building is stored except when it was followed.
const WATCH = 'fb-watch';
function watched() {
  const w = store(WATCH) || {};
  return Object.entries(w).map(([i, x]) => ({ i: +i, ...x })).filter(x => x.i < D.n && label(x.i) === x.label);
}
const isWatched = i => !!(store(WATCH) || {})[i];
function toggleWatch(i) {
  const w = store(WATCH) || {};
  if (w[i]) delete w[i]; else w[i] = { label: label(i), at: dayToDate(D.meta, todayDay).toISOString().slice(0, 10) };
  store(WATCH, w);
}
function watchRows() {
  const list = watched(); if (!list.length) return [];
  const rows = new Map(list.map(x => [x.i, { ...x, n30: 0, last: -1, live: 0, liveN: 0 }]));
  const e = D.e;
  for (let j = lowerDay(todayDay - 365); j < D.m; j++) {
    if (e.kind[j] === 6) continue;
    const r = rows.get(e.b[j]); if (!r) continue;
    if (todayDay - e.day[j] < 30) r.n30++;
    r.last = e.day[j];
  }
  const L = S.live;
  if (L.status === 'on') {
    for (const [i, d] of L.jumps.all || []) { const r = rows.get(i); if (r) r.live = d; }
    for (const ev of L.events || []) { const r = rows.get(ev.b); if (r) r.liveN++; }
  }
  for (const r of rows.values()) r.lastDate = r.last >= 0 ? fmtDate(dayToDate(D.meta, r.last)) : null;
  return [...rows.values()].sort((x, y) => (y.liveN - x.liveN) || (y.live - x.live) || (y.n30 - x.n30) || (D.b.risk[y.i] - D.b.risk[x.i]));
}

// ---------- FALCON crew search ----------
// FALCON's agents hunt for a signal's source using the predictor's belief. Here 4 crews walk the grid one
// cell (about 150 m) per step for 150 steps, each moving to the neighbour with the most unvisited belief
// nearby; a visited cell's belief drops to zero, so crews fan out. Same greedy policy as the backtest in
// backend/firebreak/falcon/net.py, run on today's field.
function dispatchCrews(crews = 4, steps = 150, look = 4) {
  const F = D.falcon, G = F.grid, V = new Float64Array(G * G);
  for (let k = 0; k < G * G; k++) V[k] = F.ignite[k] + 1e-3 * F.rate[k];
  const st = F.backtest?.crew_search?.starts || (() => {
    let sy = [], sx = [];
    for (let k = 0; k < G * G; k++) if (F.rate[k] > 0) { sy.push(Math.floor(k / G)); sx.push(k % G); }
    const med = a => a.sort((x, y) => x - y)[a.length >> 1], cy = med(sy), cx = med(sx);
    return [[cy - 40, cx - 40], [cy - 40, cx + 40], [cy + 40, cx - 40], [cy + 40, cx + 40]];
  })();
  const pos = st.slice(0, crews).map(([r, c]) => [r, c]), paths = pos.map(p => [p.slice()]);
  let ign = 0, rate = 0, cells = 0;
  const take = (r, c) => { const k = r * G + c; if (V[k] >= 0) { cells++; ign += F.ignite[k]; rate += F.rate[k]; } V[k] = -1; };
  pos.forEach(([r, c]) => take(r, c));
  const DISC = [1, 0.6, 0.36, 0.216, 0.13, 0.078];
  const near = (r, c) => {
    let m = 0;
    for (let y = Math.max(0, r - look); y <= Math.min(G - 1, r + look); y++) for (let x = Math.max(0, c - look); x <= Math.min(G - 1, c + look); x++) {
      const d = Math.max(Math.abs(y - r), Math.abs(x - c)); if (!d) continue;
      const v = V[y * G + x] * DISC[d]; if (v > m) m = v;
    }
    return m;
  };
  for (let t = 0; t < steps; t++) {
    for (const p of pos) {
      let best = null, bv = -Infinity;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const r = p[0] + dr, c = p[1] + dc; if (r < 0 || c < 0 || r >= G || c >= G) continue;
        const v = Math.max(0, V[r * G + c]) + near(r, c);
        if (v > bv) { bv = v; best = [r, c]; }
      }
      if (bv < 1e-6) {             // nothing within sight: head for the best remaining cell
        let bk = 0; for (let k = 1; k < G * G; k++) if (V[k] > V[bk]) bk = k;
        best = [p[0] + Math.sign(Math.floor(bk / G) - p[0]), p[1] + Math.sign((bk % G) - p[1])];
      }
      p[0] = best[0]; p[1] = best[1]; take(p[0], p[1]);
    }
    pos.forEach((p, a) => paths[a].push(p.slice()));
  }
  const toLL = ([r, c]) => [F.west + (c + 0.5) * F.dlon, F.north - (r + 0.5) * F.dlat];
  S.crews = { paths: paths.map(pp => pp.map(toLL)), ign, rate, cells, km: crews * steps * F.cell_m / 1000 };
  render(); redraw();
}

// ---------- resolution playbook ----------
// Turns an alarm into a case: trace the cluster to its origin, simulate the origin, find firebreaks, cost
// them, route a crew, and stop at a human approval. Each step calls the same code a person would click.
const pause = ms => new Promise(r => setTimeout(r, ms));
const waitFor = (f, ms = 30000) => new Promise((res, rej) => {
  const t0 = performance.now();
  const tick = () => {
    if (!playbookActive()) return rej(new Error('stopped'));
    const v = f(); if (v) return res(v);
    if (performance.now() - t0 > ms) return rej(new Error('timed out waiting for the simulator'));
    setTimeout(tick, 250);
  };
  tick();
});
function clusterBuildings(c) {
  const half = (D.alarms.cell_m || 150) / 2, e = D.e, out = new Set();
  for (let j = lowerDay(todayDay - c.window_days + 1); j < D.m; j++) {
    if (e.kind[j] === 6 || e.b[j] < 0 || !e.new_case[j]) continue;
    for (const [lon, lat] of c.cells) {
      if (Math.abs((e.lon[j] - lon) * M_LON) <= half && Math.abs((e.lat[j] - lat) * M_LAT) <= half) { out.add(e.b[j]); break; }
    }
  }
  return [...out];
}
function runPlaybook(k) {
  if (k === null || k === undefined || !D.alarms?.clusters?.[k]) return;
  stopTour();
  const c = D.alarms.clusters[k];
  const costOf = g => { const cl = D.b.class[g]; return cl === 0 ? S.plan.costs.home : cl === 1 ? S.plan.costs.multifamily : S.plan.costs.commercial; };
  const steps = [
    { name: 'Read the alarm', tool: 'scan.cluster', run: async x => {
      setView('detect'); if (S.alarm !== k) pickAlarm(k); await pause(800);
      x.gs = clusterBuildings(c);
      return `${c.observed} houses with a new case in ${c.window_days} days, where ${c.expected.toFixed(1)} were expected. ${x.gs.length} of them placed on buildings for tracing.`;
    } },
    { name: 'Trace the root cause', tool: 'hawkes.branching', run: async x => {
      const st = clusterOrigins(D, x.gs, todayDay), top = st.roots[0];
      if (!top) throw new Error('No report in this cluster traces to a placed building.');
      x.story = st; x.origin = top.g;
      S.highlight = st.roots.slice(0, 6).map(r => r.g); redraw(); await pause(900);
      return `${st.roots.length} origin${st.roots.length === 1 ? '' : 's'}. ${top.n} of ${st.traced} cases trace back to ${esc(label(top.g))} (${pct(top.n / st.traced)}).`;
    } },
    { name: 'Simulate the origin', tool: 'sim.monteCarlo', run: async x => {
      openHouse(x.origin);
      const r = await waitFor(() => S.house?.i === x.origin && !S.house.busy && S.house.res);
      x.area = r.base.cumDaily[90];
      return `${x.area.toFixed(1)} expected reports within 700 m over 90 days, from ${RUNS} simulated futures.`;
    } },
    { name: 'Find firebreaks', tool: 'sim.celf', run: async x => {
      houseActions().firebreaks();
      let H = await waitFor(() => S.house?.fb && S.house.res?.withS && !S.house.busy && S.house, 90000);
      x.picks = H.fb.picks.map(p => p.g);
      // Fix the origin as well, so the case's benefit covers every work order it pays for.
      if (!H.stab.includes(H.i)) {
        const fb = H.fb; H.res = null; houseActions().toggle();
        H = await waitFor(() => S.house?.res?.withS && !S.house.busy && S.house, 60000);
        H.fb = fb; if (S.view === 'simulate') renderHouse(D, H, houseActions());
      }
      x.prevented = H.res.prevented; x.protectedUsd = H.res.protectedUsd;
      return `Origin plus ${x.picks.length} firebreaks: ${x.prevented.toFixed(1)} fewer reports within 700 m over 90 days, ${kusd(x.protectedUsd)} of neighbour value protected.`;
    } },
    { name: 'Cost the case', tool: 'plan.cost', run: async x => {
      x.actions = [...new Set([x.origin, ...x.picks])];
      x.cost = x.actions.reduce((a, g) => a + costOf(g), 0);
      return `${x.actions.length} work orders, ${kusd(x.cost)} at your repair costs (placeholders, editable in Act): ${kusd(x.cost / Math.max(x.prevented, 0.1))} per report prevented.`;
    } },
    { name: 'Route a crew', tool: 'route.twoOpt', run: async x => {
      const extra = x.gs.filter(g => !x.actions.includes(g)).sort((a, b) => D.b.risk[b] - D.b.risk[a]).slice(0, Math.max(0, 12 - x.actions.length));
      setRoute('case', [...x.actions, ...extra]); x.route = S.route; redraw(); await pause(900);
      return `${x.route.order.length} stops (work orders plus the cluster's riskiest buildings): ${x.route.km.toFixed(1)} km, about ${(x.route.minutes / 60).toFixed(1)} h. Drive speed and stop time are placeholders.`;
    } },
  ];
  const id = `FB-${D.meta.as_of.replace(/-/g, '')}-C${k + 1}`;
  startPlaybook(`Cluster ${k + 1}`, steps, {
    onClose: () => { S.highlight = null; if (S.route?.kind === 'case') S.route = null; redraw(); },
    onDone: x => {
      const text = caseText(id, c, x);
      const prev = getCase(id), signed = prev ? prev.opened : null;
      return {
        html: `<div class="pb-case"><div class="pb-id">${id}</div>
          <div class="pb-kpis"><div><b>${x.actions.length}</b><small>work orders</small></div><div><b>${kusd(x.cost)}</b><small>cost</small></div>
          <div><b>${x.prevented.toFixed(1)}</b><small>reports prevented</small></div><div><b>${x.route.km.toFixed(1)} km</b><small>crew route</small></div></div>
          <div class="inline"><button class="btn" data-a="copy-case">Copy case</button><a class="btn" href="${x.route.link}" target="_blank" rel="noopener">Open route</a>
          <button class="hold ${signed ? 'signed' : ''}" id="pb-hold"><span class="fill" style="${signed ? 'width:100%' : ''}"></span><span>${signed ? 'Approved ' + signed.slice(0, 10) : 'Hold to approve'}</span></button></div>
          <p class="note">Nothing is sent. Approval records the case in this browser, for a person to hand to the crew.</p></div>`,
        wire: el => {
          el.querySelector('[data-a=copy-case]').onclick = async ev => { try { await navigator.clipboard.writeText(text); ev.target.textContent = 'Copied'; } catch { ev.target.textContent = 'Copy blocked'; } };
          wireHold(el.querySelector('#pb-hold'), () => {
            const c2 = openCase({ id, title: `Cluster around ${whereOf(k)}`, origin: label(x.origin), workOrders: x.actions.length, cost: x.cost,
              prevented: x.prevented, km: x.route.km, stops: x.route.order.length, stopsIdx: x.route.order.slice(), link: x.route.link, text });
            const h = el.querySelector('#pb-hold'); h.classList.add('signed'); h.querySelector('span:last-child').textContent = 'Approved ' + c2.opened.slice(0, 10);
            const n = el.querySelector('.pb-case .note'); if (n) n.innerHTML = 'Case opened. Track it under <b>Home &gt; Cases</b> (press 0). Nothing is sent: the inbox is kept in this browser.';
          });
        },
      };
    },
  });
}
function caseText(id, c, x) {
  const L = g => label(g);
  return [`# Case ${id}`, '',
    `Alarm: ${x.gs.length} buildings with a new case in ${c.window_days} days, ${c.expected.toFixed(1)} expected.`,
    `Root cause: ${x.story.roots[0].n} of ${x.story.traced} cases trace back to ${L(x.origin)}.`,
    `Without action: ${x.area.toFixed(1)} expected reports within 700 m over 90 days.`,
    `Fixing the origin and the firebreaks: ${x.prevented.toFixed(1)} fewer, ${kusd(x.protectedUsd)} of neighbour value protected.`, '',
    '## Work orders', ...x.actions.map((g, n) => `${n + 1}. ${L(g)} (${CLASS[D.b.class[g]]})${g === x.origin ? ', origin' : ''}`), '',
    `Cost: ${kusd(x.cost)} at placeholder repair costs.`,
    `Crew route: ${x.route.order.length} stops, ${x.route.km.toFixed(1)} km. ${x.route.link}`, '',
    'Generated by Firebreak from Dallas 311 and the DCAD roll. Nothing has been sent.'].join('\n');
}

// ---------- council district brief ----------

function districtBounds(d) {
  const b = D.b, lons = [], lats = [];
  for (let i = 0; i < D.n; i += 3) if (b.district[i] === d) { lons.push(b.lon[i]); lats.push(b.lat[i]); }
  lons.sort((x, y) => x - y); lats.sort((x, y) => x - y);
  const q = (a, f) => a[Math.floor(f * (a.length - 1))];
  return [[q(lons, 0.02), q(lats, 0.02)], [q(lons, 0.98), q(lats, 0.98)]];
}
function computeBrief(d) {
  const b = D.b, e = D.e;
  if (!planOrder) computePlan();
  let n = 0, exp = 0, cert = 0, homes = 0;
  for (let i = 0; i < D.n; i++) if (b.district[i] === d) { n++; exp += b.risk[i] / 255; cert += b.certified ? b.certified[i] : 0; homes += b.class[i] === 0; }
  let r30 = 0, r30city = 0;
  for (let j = lowerDay(todayDay - 29); j < D.m; j++) {
    if (e.kind[j] === 6 || e.day[j] > todayDay) continue;
    r30city++; if (e.b[j] >= 0 && b.district[e.b[j]] === d) r30++;
  }
  const fair = D.meta.audit?.fairness?.districts.find(x => x.district === d);
  const fairAfter = D.meta.audit?.fairness_after_rerank?.districts.find(x => x.district === d);
  const rep = D.hawkes?.reproduction;
  let r = null;
  if (rep?.districts?.[d]) {
    for (let k = rep.months.length - 1; k >= 0; k--) if (!rep.city[k]?.provisional && rep.districts[d][k] != null) { r = { month: rep.months[k], v: rep.districts[d][k] }; break; }
  }
  const clusters = (D.alarms?.clusters || []).map((c, k) => ({ c, k })).filter(({ c }) => {
    const [lon, lat] = c.cells[0]; let best = -1, bd = 1e18;
    for (let i = 0; i < D.n; i += 2) { const dx = b.lon[i] - lon, dy = b.lat[i] - lat, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = i; } }
    return b.district[best] === d;
  });
  const allRows = planOrder.filter(x => b.district[x.i] === d), rows = allRows.slice(0, 10);
  return { d, n, homes, exp, cert, r30, r30city, fair, fairAfter, r, clusters, rows, allRows,
    cost: rows.reduce((a, x) => a + x.cost, 0), prevented: rows.reduce((a, x) => a + x.own + x.spare, 0) };
}
function briefText(B) {
  const m = D.meta, lines = [
    `# Council District ${B.d}: Firebreak brief, ${m.as_of}`, '',
    `- Buildings: ${B.n.toLocaleString()} (${B.homes.toLocaleString()} homes)`,
    `- Property reports, last 30 days: ${B.r30.toLocaleString()} of ${B.r30city.toLocaleString()} citywide`,
    `- Expected new reports, next 90 days: ${Math.round(B.exp).toLocaleString()}`,
    B.r ? `- Spread rate R (${B.r.month}): ${B.r.v.toFixed(2)}` : '',
    `- Certified high-risk buildings (at most 10% expected wrong): ${B.cert}`,
    B.fair ? `- Model recall here vs city: ${B.fair.recall_ratio.toFixed(2)}x${B.fair.under_served ? ' (under-served before re-ranking)' : ''}` : '',
    `- Emerging clusters: ${B.clusters.length ? B.clusters.map(({ c, k }) => `#${k + 1} (${c.observed} houses vs ${c.expected.toFixed(1)} expected, ${c.window_days} d)`).join('; ') : 'none'}`,
    '', '## Next 10 actions (ranked by reports prevented per dollar)', '',
    '| # | Building | Class | Cost | Own risk | Reports spared nearby |', '|---|---|---|---|---|---|',
    ...B.rows.map((x, k) => `| ${k + 1} | ${label(x.i)} | ${CLASS[x.cls]} | $${x.cost.toLocaleString()} | ${(x.own * 100).toFixed(0)}% | ${x.spare.toFixed(2)} |`),
    '', `Total: $${B.cost.toLocaleString()} for about ${B.prevented.toFixed(1)} reports prevented in 90 days. Costs are placeholders.`,
    'Source: Firebreak pipeline (DCAD 2026, Dallas 311). Nothing has been sent; a human approves each action.',
  ];
  return lines.filter(x => x !== '').join('\n').replace('\n## ', '\n\n## ').replace('\n| # |', '\n\n| # |');
}
function setBrief(d) {
  S.brief = { d, B: computeBrief(d) };
  if (S.route?.kind === 'inspect') S.route = null;
  fitFlat(districtBounds(d), { padding: 60, duration: 900 });
}

// ---------- guided tour ----------

function runTour(onEnd) {
  stopPlaybook();
  const m = D.meta, net = m.model.network, num = v => Math.round(v).toLocaleString();
  const top = D.alarms?.clusters?.[0], hot = D.hotspots[0];
  const steps = [
    { title: 'Every building in Dallas', ms: 9000, run: () => { setView('detect'); home(); S.day = Math.max(0, todayDay - 365); S.speed = 7; setPlaying(true); },
      text: () => `${num(m.counts.buildings)} buildings from the appraisal roll and ${num(m.counts.reports)} property reports from 311. The two systems share no IDs; Firebreak joins them by address. The heat is report density over the last 60 days.` },
    { title: 'Distress clusters, and spreads', ms: 9000, run: () => { setPlaying(false); S.day = todayDay; if (top) pickAlarm(0); else render(); },
      text: () => top ? `Cluster 1: ${top.observed} houses with a new case in ${top.window_days} days where ${top.expected.toFixed(1)} were expected. A report next door raises a building's odds ${m.edges.block.ratio.toFixed(2)}×; one at another building with the same owner, ${m.edges.owner.ratio.toFixed(2)}×.` : '' },
    { title: 'Trace it to the origin', ms: 9000, run: () => {
        if (!top) return;
        const st = clusterOrigins(D, clusterBuildings(top), todayDay); D.tourOrigins = st;
        S.highlight = st.roots.slice(0, 6).map(r => r.g); redraw();
      },
      text: () => { const st = D.tourOrigins, r = st?.roots?.[0]; return r ? `Like an incident tool tracing an outage to the service where it began: ${r.n} of the cluster's ${st.traced} cases trace back, report by report, to ${esc(label(r.g))} (blue rings). Press R and an agent turns that into a costed, routed case.` : ''; } },
    { title: 'The hidden network', ms: 9000, run: () => { S.alarm = null; S.highlight = null; S.network = true; ownerNetwork(); home(); render(); },
      text: () => `${num(D.ownerNet.links)} buildings share an owner with a building that had a report this year, across ${num(D.ownerNet.owners)} company portfolios. A report at one raises the others' odds ${m.edges.owner.ratio.toFixed(2)}× (pooled over 4 test quarters). These are the dependencies CBRE's brief calls undetectable.` },
    { title: 'The next 90 days', ms: 8000, run: () => { S.network = false; S.predict = 'forecast'; setView('predict'); S.day = todayDay + m.horizon_days; home(); render(); },
      text: () => `${num(D.expected)} new property reports expected citywide. Height and heat: expected reports per 260 m hex.` },
    { title: 'Proof on data it never saw', ms: 10000, run: () => { S.predict = 'proof'; setView('predict'); S.day = cutoffDay; render(); S.speed = 3; setPlaying(true); },
      text: () => `Frozen on ${fmtDate(new Date(m.backtest_cutoff))}. ${pct(net.watch_precision)} of its top ${num(net.watch_list)} got a report within 90 days, against a ${pct(net.base_rate, 1)} base rate. Blue: the report landed.` },
    ...(D.falcon ? [{ title: 'A neural network that sees blind spots', ms: 10000, run: () => { setPlaying(false); S.predict = 'neural'; setView('predict'); S.day = todayDay + 45; home(); render(); },
      text: () => `FALCON, our sparse-sensor research model, retrained on Dallas: buildings are sensors that only report when someone calls. It forecasts all ${num(D.falcon.backtest.cells_with_buildings)} built-up cells, and rings the quiet ones most likely to ignite next (blue).` }] : []),
    { title: 'One building, 400 futures', ms: 15000, run: () => {
        setPlaying(false); openHouse(hot.i);
        const t0 = performance.now(), wait = () => { if (!tourActive()) return; if (S.house?.res && !S.house.fb && !S.house.busy) houseActions().firebreaks(); else if (performance.now() - t0 < 9000) setTimeout(wait, 400); };
        setTimeout(wait, 1500);
      },
      text: () => `${esc(hot.name || label(hot.i))}: Firebreak simulates the next 90 days for it and every building within 700 m, then searches for the 3 repairs that spare the most reports at other houses (green).` },
    { title: 'Budget to work orders', ms: 9000, run: () => { S.act = 'plan'; setView('act'); computePlan(); render(); },
      text: () => `A ${kusd(S.plan.budget)} budget becomes ${S.plan.result.n} ranked interventions, about ${S.plan.result.reports.toFixed(0)} reports prevented. Ranked by reports per dollar, never by property value. A person approves; nothing is sent.` },
    { title: 'A brief for every council office', ms: 11000, run: () => { S.act = 'brief'; setView('act'); setBrief(worstDistrict()); setRoute('inspect', S.brief.B.allRows.slice(0, 15).map(x => x.i)); render(); },
      text: () => `District ${S.brief.d}: its own forecast, fairness check and next actions, plus tomorrow's crew route through the top ${S.route.order.length}: ${S.route.km.toFixed(1)} km, about ${(S.route.minutes / 60).toFixed(1)} hours. One click copies the brief.` },
    { title: 'Who owns the problem next door', ms: 10000, run: () => { S.act = 'portfolio'; setView('act'); const o = bestOwner(); setOwner(o); render(); },
      text: () => S.portfolio.rows ? `${esc(D.search.owners[S.portfolio.owner - 1].label)}: ${pct(S.portfolio.inbound)} of its buildings' risk comes from neighbours it does not own. Orange: the outside buildings pushing on it. Fixing or buying those protects the portfolio; for a wholesaler, this owner is the natural buyer.` : '' },
    { title: 'Every claim, tested', ms: 9000, run: () => { setView('evidence'); home(); },
      text: () => `Held-out tests, residual checks, a fairness audit by district, and a natural experiment that came back negative, shown rather than hidden. Press T to replay, or explore.` },
  ];
  $('tour-btn')?.classList.add('on');
  startTour(steps, () => { $('tour-btn')?.classList.remove('on'); setPlaying(false); onEnd?.(); });
}
// The tour's portfolio: the company with 8+ buildings whose risk depends most on neighbours.
function bestOwner() {
  const b = D.b, agg = new Map();
  for (let i = 0; i < D.n; i++) { const o = b.owner[i]; if (!o) continue; const x = agg.get(o) || agg.set(o, [0, 0]).get(o); x[0] += b.push_nb[i]; x[1]++; }
  let best = D.ownerOrder[0], bv = -1;
  for (const [o, [nb, n]] of agg) if (n >= 8 && nb > bv) { bv = nb; best = o; }
  return best;
}
function worstDistrict() {
  const f = D.meta.audit?.fairness?.districts || [];
  const u = f.filter(x => x.under_served).sort((a, b) => b.cases - a.cases)[0];
  return u ? u.district : 7;
}

// ---------- search ----------

let streetIdx = null;
const ACTIONS = [
  { label: 'Home: today, next moves and cases', key: '0', run: () => setView('home') },
  { label: 'Detect: what is happening now', key: '1', run: () => setView('detect') },
  { label: 'Predict: the next 90 days', key: '2', run: () => setView('predict') },
  { label: 'Simulate: house by house', key: '3', run: () => setView('simulate') },
  { label: 'Act: budget plan and work orders', key: '4', run: () => { S.act = 'plan'; setView('act'); } },
  { label: 'Act: council district brief', run: () => { S.act = 'brief'; setView('act'); } },
  { label: 'Act: portfolio exposure', run: () => { S.act = 'portfolio'; setView('act'); } },
  { label: 'Evidence: model card', key: '5', run: () => setView('evidence') },
  { label: 'Predict: replay the backtest', run: () => { S.predict = 'proof'; setView('predict'); S.day = cutoffDay; render(); setPlaying(true); } },
  { label: 'Detect: show the hidden owner network', key: 'N', run: () => { setView('detect'); handlers.network(); } },
  { label: 'Detect: my watchlist', run: () => { setView('detect'); requestAnimationFrame(() => [...document.querySelectorAll('#panel .pane')].find(p => p.innerText.startsWith('Watchlist'))?.scrollIntoView({ behavior: 'smooth' })); } },
  { label: 'Run the resolution playbook on the strongest cluster', key: 'R', run: () => runPlaybook(S.alarm ?? 0) },
  { label: 'Start the guided tour', key: 'T', run: () => runTour() },
  { label: 'Film mode: full-screen tour for recording a promo', key: 'F', run: () => film() },
  { label: 'Export cases (CSV)', run: () => handlers.casesCsv() },
  { label: 'Play or pause time', key: 'Space', run: () => range() && $('play').click() },
  { label: 'Toggle 2D / 3D', key: 'P', run: () => togglePitch() },
  { label: 'Export work orders (CSV)', run: () => { S.act = 'plan'; setView('act'); exportPlan(); } },
  { label: 'Copy link to this view', run: () => $('share').click() },
  { label: 'Fly home', key: 'H', run: () => home() },
];
function search(q) {
  q = q.trim().toLowerCase();
  const acts = ACTIONS.filter(a => !q || a.label.toLowerCase().includes(q)).map(a => ({ kind: 'action', label: a.label, meta: a.key ? a.key : '', a }));
  const out = [];
  if (q.length < 2 || !D.search) return acts.slice(0, q ? 4 : 14);
  out.push(...acts.slice(0, 3));
  const s = D.search, b = D.b;
  if (!streetIdx) {
    streetIdx = new Map();
    for (let i = 0; i < D.n; i++) { const k = b.street[i]; (streetIdx.get(k) || streetIdx.set(k, []).get(k)).push(i); }
  }
  const num = q.match(/^(\d+)\s+(.+)$/), text = num ? num[2] : q, blk = num ? Math.floor(+num[1] / 100) * 100 : null;
  const best = list => list.reduce((a, i) => (b.risk[i] > b.risk[a] ? i : a), list[0]);
  for (let k = 0; k < s.streets.length && out.length < 6; k++) {
    if (!s.streets[k].toLowerCase().includes(text)) continue;
    let list = streetIdx.get(k) || [];
    if (blk !== null) list = list.filter(i => b.block[i] === blk);
    if (!list.length) continue;
    out.push({ kind: 'street', label: blk !== null ? `${blk} block of ${s.streets[k]}` : s.streets[k], meta: `${list.length} buildings`, list, top: best(list) });
  }
  if (!num) {
    for (const [i, name] of Object.entries(s.names || {})) {
      if (out.length >= 10) break;
      if (name.toLowerCase().includes(q)) out.push({ kind: 'name', label: name, meta: CLASS[b.class[+i]], i: +i });
    }
    let c = 0;
    s.owners.forEach((o, k) => { if (c < 4 && o.label.toLowerCase().includes(q)) { c++; out.push({ kind: 'owner', label: o.label, meta: `${o.buildings} buildings`, o: k + 1 }); } });
  }
  return out;
}
function choose(r) {
  $('q-results').hidden = true; $('q').blur();
  if (r.kind === 'action') { r.a.run(); return; }
  if (r.kind === 'owner') { S.act = 'portfolio'; setView('act'); setOwner(r.o); render(); return; }
  if (r.kind === 'name') { S.highlight = null; openHouse(r.i); return; }
  S.highlight = r.list.length > 1 ? r.list : null;
  openHouse(r.top);
  if (r.list.length > 1) {
    const lons = r.list.map(i => D.b.lon[i]), lats = r.list.map(i => D.b.lat[i]);
    fitFlat([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 100, maxZoom: 16, duration: 900 });
  }
}
function wireSearch() {
  const q = $('q'), box = $('q-results');
  let results = [], on = 0;
  const show = () => {
    box.hidden = !results.length;
    box.innerHTML = results.map((r, k) => `<button class="${k === on ? 'on' : ''} ${r.kind}" data-k="${k}"><span><i class="ico ${r.kind}"></i>${esc(r.label)}</span>${r.kind === 'action' ? (r.meta ? `<kbd>${esc(r.meta)}</kbd>` : '') : `<small>${r.kind === 'owner' ? 'portfolio · ' : ''}${esc(r.meta)}</small>`}</button>`).join('');
  };
  q.addEventListener('input', () => { results = search(q.value); on = 0; show(); });
  q.addEventListener('focus', () => { results = search(q.value); on = 0; show(); });
  q.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown') { on = Math.min(results.length - 1, on + 1); show(); ev.preventDefault(); }
    if (ev.key === 'ArrowUp') { on = Math.max(0, on - 1); show(); ev.preventDefault(); }
    if (ev.key === 'Enter' && results[on]) choose(results[on]);
    if (ev.key === 'Escape') { box.hidden = true; q.blur(); }
  });
  box.addEventListener('mousedown', ev => { const k = ev.target.closest('button')?.dataset.k; if (k !== undefined) { ev.preventDefault(); choose(results[+k]); } });
  q.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 120));
}

// ---------- live feed ----------

function setLive(L) {
  S.live = L;
  const el = $('live');
  el.classList.toggle('on', L.status === 'on' && L.mode === 'live');
  el.querySelector('span').textContent = L.status !== 'on' ? 'snapshot' : L.mode === 'live' ? `live · ${L.count} new` : 'replay · 48 h';
  el.title = L.status === 'on' ? (L.mode === 'live' ? `Dallas 311, pulled ${L.at}` : 'Live feed unreachable here: replaying the last 48 hours of the snapshot') : (L.note || '');
  if (L.mode === 'live' && L.events.length) {
    liveEv = L.events;
    if (sim) sim.postMessage({ type: 'add', ev: L.events.filter(x => x.b >= 0 && x.kind !== 6) });
  }
  if (S.view === 'detect') { S.watch = watchRows(); renderDetect(D, S, handlers); }
  if (S.view === 'home') render();
  redraw();
}

// ---------- boot ----------

async function main() {
  D = await load('./data', (f, what) => { $('load-bar').style.width = `${Math.round(f * 100)}%`; $('load-text').textContent = `Loading ${what.replace('.json', '')}…`; });
  const { meta, b, e, n, m } = D;
  todayDay = dateToDay(meta, meta.as_of);
  cutoffDay = dateToDay(meta, meta.backtest_cutoff);
  D.label = label;
  D.ROUTE = ROUTE;
  D.factorCounts = new Array(10).fill(0);
  for (let i = 0; i < n; i++) D.factorCounts[factorOf(b.risk[i] / 255) - 1]++;
  D.allIdx = Array.from({ length: n }, (_, i) => i);
  D.eDayF = Float32Array.from(e.day);
  D.eColor = new Uint8Array(m * 4);
  for (let j = 0; j < m; j++) { const c = KIND_RGB[e.kind[j]]; D.eColor.set([c[0], c[1], c[2], e.kind[j] === 6 ? 120 : 220], 4 * j); }
  D.eWeight = Float32Array.from(e.kind, k => (k === 6 ? 0 : 1));
  D.bColor = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) D.bColor.set(b.class[i] === 0 ? [92, 97, 108, 80] : [140, 146, 158, 130], 4 * i);
  D.expected = b.risk.reduce((a, r) => a + r / 255, 0);
  if (D.falcon) {
    const F = D.falcon, G = F.grid, idx = Array.from({ length: G * G }, (_, k) => k);
    F.top = idx.filter(k => F.rate[k] >= 0.25).sort((x, y) => F.rate[y] - F.rate[x]).slice(0, 8000);
    F.rateHi = F.rate[F.top[Math.floor(F.top.length * 0.02)]] || 1;
    F.igniteTop = idx.filter(k => F.ignite[k] > 0).sort((x, y) => F.ignite[y] - F.ignite[x]).slice(0, 40);
    F.blindTop = idx.filter(k => F.blind[k]).sort((x, y) => F.rate[y] - F.rate[x]).slice(0, 40);
    // Name each listed cell after the nearest building, so the tables read as places.
    F.near = {};
    for (const k of [...F.igniteTop, ...F.blindTop]) {
      const [lon, lat] = F.center(k); let best = -1, bd = 1e18;
      for (let i = 0; i < D.n; i++) { const dx = (b.lon[i] - lon) * M_LON, dy = (b.lat[i] - lat) * M_LAT, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
      if (best >= 0 && bd < (F.cell_m * 1.5) ** 2) F.near[k] = label(best);
    }
  }
  D.recent7 = 0; D.recent7prev = 0;
  for (let j = 0; j < m; j++) { if (e.kind[j] === 6) continue; const d = todayDay - e.day[j]; if (d >= 0 && d < 7) D.recent7++; else if (d >= 7 && d < 14) D.recent7prev++; }
  D.certifiedIdx = D.evidence?.live?.certified_idx || (b.certified ? D.allIdx.filter(i => b.certified[i]) : []);
  D.ownerOrder = D.search ? D.search.owners.map((o, k) => k + 1).sort((x, y) => D.search.owners[y - 1].buildings - D.search.owners[x - 1].buildings) : [];
  // Evidence view: buildings coloured by their council district's recall against the city (fairness audit).
  D.bDistrictColor = new Uint8Array(n * 4);
  const fair = meta.audit?.fairness?.districts || [];
  const ratio = Object.fromEntries(fair.map(d => [d.district, d.recall_ratio]));
  const sum = {};
  for (let i = 0; i < n; i++) {
    const d = b.district?.[i] || 0, rr = ratio[d];
    D.bDistrictColor.set(rr === undefined ? [60, 63, 70, 60] : heat(rr / 2, 150), 4 * i);
    if (d) { const s = sum[d] || (sum[d] = [0, 0, 0]); s[0] += b.lon[i]; s[1] += b.lat[i]; s[2]++; }
  }
  D.districtLabels = fair.filter(d => sum[d.district]).map(d => ({ p: [sum[d.district][0] / sum[d.district][2], sum[d.district][1] / sum[d.district][2]], t: `D${d.district} ${d.recall_ratio.toFixed(2)}×` }));
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

  $('asof').textContent = `Dallas · data through ${fmtDate(new Date(meta.as_of))}`;
  map = new maplibregl.Map({ container: 'map', style: await pickStyle(), ...HOME, antialias: true, attributionControl: { compact: true } });
  map.on('style.load', () => restyle(map));
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-right');
  overlay = new MapboxOverlay({ interleaved: false, layers: [], pickingRadius: 6, getTooltip: tooltip });
  map.addControl(overlay);

  // A click on a building (or within 25 px of one, at least 150 m) opens it in Simulate.
  let picked = 0;
  overlay.setProps({ onClick: info => {
    if (!info.picked) return;
    picked = performance.now();
    if (info.layer?.id === 'buildings' && info.index >= 0) openHouse(info.index);
    else if ((info.layer?.id === 'plan' || info.layer?.id === 'portfolio') && info.object) openHouse(info.object.i);
    else if (info.layer?.id === 'certified' && info.object !== undefined) openHouse(info.object);
    else if (info.layer?.id === 'route-stops' && info.object !== undefined) openHouse(info.object);
    else if (info.layer?.id === 'pusher-dots' && info.object) openHouse(info.object.i);
  } });
  map.on('click', ev => {
    setTimeout(() => {
      if (performance.now() - picked < 300 || S.view !== 'simulate') return;
      const { lng, lat } = ev.lngLat, mPerPx = 156543 * Math.cos(lat * Math.PI / 180) / 2 ** map.getZoom();
      const rad = Math.max(150, 25 * mPerPx);
      let best = -1, bd = rad * rad;
      for (let i = 0; i < n; i++) { const dx = (b.lon[i] - lng) * M_LON, dy = (b.lat[i] - lat) * M_LAT, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
      if (best >= 0) openHouse(best);
    }, 0);
  });
  let zRaf = 0;
  map.on('zoom', () => { cancelAnimationFrame(zRaf); zRaf = requestAnimationFrame(() => overlay.setProps({ layers: layers() })); });
  map.on('mousemove', ev => { const r = $('readout'); r.hidden = false; r.textContent = `${ev.lngLat.lat.toFixed(4)}° N  ${Math.abs(ev.lngLat.lng).toFixed(4)}° W  ·  zoom ${map.getZoom().toFixed(1)}`; });
  map.on('mouseout', () => { $('readout').hidden = true; });

  $('views').addEventListener('click', ev => { const v = ev.target.closest('button')?.dataset.view; if (v) setView(v); });
  $('slider').addEventListener('input', ev => { S.day = +ev.target.value; redraw(); });
  $('speed').addEventListener('change', ev => { S.speed = +ev.target.value; });
  $('play').addEventListener('click', () => {
    const sl = $('slider');
    if (!S.playing && S.day >= +sl.max) S.day = onDetect(S.view) ? Math.max(0, todayDay - 365) : +sl.min;
    setPlaying(!S.playing);
  });
  $('pitch').addEventListener('click', togglePitch);
  $('tour-btn').addEventListener('click', () => (tourActive() ? stopTour() : runTour()));
  $('share').addEventListener('click', async () => {
    const btn = $('share');
    try { await navigator.clipboard.writeText(location.href); btn.textContent = 'Copied'; } catch { btn.textContent = location.hash || '#detect'; }
    setTimeout(() => { btn.textContent = 'Copy link'; }, 1600);
  });
  wireSearch();
  window.addEventListener('keydown', ev => {
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(ev.target.tagName);
    if ((ev.key === '/' && !typing) || (ev.key === 'k' && (ev.metaKey || ev.ctrlKey))) { ev.preventDefault(); $('q').focus(); return; }
    if (typing) return;
    if (ev.key === ' ') { ev.preventDefault(); if (range()) $('play').click(); }
    if (ev.key >= '0' && ev.key <= '5') setView(VIEWS[+ev.key]);
    if (ev.key === 'f' || ev.key === 'F') film();
    if (ev.key === 'p' || ev.key === 'P') togglePitch();
    if (ev.key === 'n' || ev.key === 'N') { if (S.view !== 'detect') setView('detect'); handlers.network(); }
    if (ev.key === 't' || ev.key === 'T') runTour();
    if (ev.key === 'r' || ev.key === 'R') runPlaybook(S.alarm ?? 0);
    if (ev.key === 'h' || ev.key === 'H') home();
    if (ev.key === 'Escape') {
      if (filmActive()) { stopFilm(); return; }
      if (tourActive()) { stopTour(); return; }
      if (playbookActive()) { stopPlaybook(); return; }
      if (!$('detail').hidden) { $('detail').hidden = true; S.selected = null; S.lead = null; redraw(); }
      else if (S.house) houseActions().close();
      else if (S.alarm !== null) { S.alarm = null; render(); }
    }
  });
  window.addEventListener('hashchange', readHash);
  if (import.meta.env.DEV) window.__fb = { S, D, openHouse, setView, map: () => map }; // console hooks for local testing only

  $('loading').remove();
  // A hand-off from the product site: an address typed there opens here as a search.
  let handoff = null; try { handoff = sessionStorage.getItem('fb-q'); sessionStorage.removeItem('fb-q'); } catch { /* storage blocked */ }
  if (location.hash.length > 1) readHash();
  else setView('home', { keepHash: true });
  if (handoff) { const r = search(handoff).find(x => x.kind !== 'action'); if (r) choose(r); else { $('q').value = handoff; $('q').focus(); $('q').dispatchEvent(new Event('input')); } }

  // Live 311: reports filed since the snapshot. Falls back to replaying the snapshot's last 48 hours.
  pullLive(D, todayDay).then(L => setLive(L)).catch(err => setLive(replayLive(D, todayDay, err.message)));
}

// Quiet the basemap so the data carries the colour: near-black land, ink-blue water, hairline roads,
// grey labels. Applied to whatever layers the CARTO style has; unknown layers are left alone.
function restyle(m) {
  const set = (id, prop, v) => { try { m.setPaintProperty(id, prop, v); } catch { /* layer missing */ } };
  for (const l of m.getStyle().layers || []) {
    if (l.type === 'background') set(l.id, 'background-color', '#0a0b0d');
    else if (l.type === 'fill' && /water/.test(l.id)) set(l.id, 'fill-color', '#0c1219');
    else if (l.type === 'fill' && /building/.test(l.id)) { set(l.id, 'fill-color', '#121317'); set(l.id, 'fill-opacity', 0.6); }
    else if (l.type === 'fill' && /park|landcover|landuse/.test(l.id)) set(l.id, 'fill-color', '#0d0f11');
    else if (l.type === 'line' && /road|bridge|tunnel/.test(l.id)) set(l.id, 'line-color', /case/.test(l.id) ? '#0a0b0d' : /mot|trunk|pri/.test(l.id) ? '#24272d' : '#191b20');
    else if (l.type === 'line' && /waterway/.test(l.id)) set(l.id, 'line-color', '#0f1820');
    else if (l.type === 'line' && /boundary/.test(l.id)) set(l.id, 'line-color', '#2a2d33');
    else if (l.type === 'symbol') { set(l.id, 'text-color', /place/.test(l.id) ? '#8a8f99' : '#5d626c'); set(l.id, 'text-halo-color', '#0a0b0d'); set(l.id, 'text-halo-width', 1.2); }
  }
}

function togglePitch() {
  const flat = map.getPitch() > 5;
  map.easeTo({ pitch: flat ? 0 : HOME.pitch, bearing: flat ? 0 : HOME.bearing, duration: 600 });
  $('pitch').textContent = flat ? '3D' : '2D';
  setTimeout(() => overlay.setProps({ layers: layers() }), 620);
}

function tooltip(info) {
  const { object, layer, index } = info;
  if (!layer) return null;
  const b = D.b, box = html => ({ html, className: 'tip' });
  const id = layer.id;
  if (id === 'buildings' && index >= 0) {
    const f = factorOf(b.risk[index] / 255);
    return box(`<b>${esc(label(index))}</b><br>Distress Factor <b>${f}/10</b> · ${factorWord(f)}<br>${CLASS[b.class[index]]} · ${pct(b.risk[index] / 255)} chance of a report in 90 days<br><span class="muted">Click to open</span>`);
  }
  if (id === 'hotspots' && object) return box(`<b>${esc(object.name || label(object.i))}</b><br>${object.asset_class} · ${pct(object.risk)} · ${kusd(object.usd.exposure)} at stake`);
  if (id === 'leads' && object) return box(`<b>${esc(label(object.i ?? 0))}</b><br>${pct(object.risk)} · offer ${kusd(object.offer)} · ${object.buyers_nearby} buyers nearby`);
  if (id === 'terrain' && object) return box(`<b>${(object.elevationValue ?? object.colorValue ?? 0).toFixed(2)} expected reports</b><br>${object.count ?? object.points?.length ?? ''} buildings in this hex, next 90 days`);
  if (id === 'alarm-cells' && object) { const c = D.alarms.clusters[object.k]; return box(`<b>Cluster ${object.k + 1}</b><br>${c.observed} houses with a new case in ${c.window_days} days vs ${c.expected.toFixed(1)} expected`); }
  if (id === 'house-odds' && object !== undefined && S.house?.res) {
    const r = S.house.res, t = Math.max(0, Math.min(90, S.day - todayDay)), g = r.glob[object];
    return box(`<b>${esc(label(g))}</b><br>${pct((r.withS || r.base).pBy[t * r.N + object])} chance of a report by day ${t}`);
  }
  if ((id === 'route-stops') && object !== undefined) { const k = S.route.order.indexOf(object); return box(`<b>Stop ${k + 1}</b><br>${esc(label(object))}`); }
  if (id === 'root-steps' && object) return box(`<b>${object.g === S.house?.i ? 'This building' : esc(label(object.g))}</b><br>${esc(object.kind)} report, ${esc(object.date)}`);
  if (id === 'neural-field' && object !== undefined) return box(`<b>${D.falcon.rate[object].toFixed(1)} expected reports</b><br>next 90 days, this ${Math.round(D.falcon.cell_m)} m cell (FALCON)`);
  if (id === 'neural-ignite' && object !== undefined) return box(`<b>Possible ignition · ${pct(D.falcon.ignite[object])}</b><br>no report here in 90 days; the network expects 2 or more next`);
  if (id === 'neural-blind' && object !== undefined) return box(`<b>Blind spot</b><br>${D.falcon.rate[object].toFixed(1)} reports expected, none in 12 weeks`);
  if (id === 'watch') return box(`<b>Following</b><br>${esc(label(object))}`);
  if (id === 'owner-net' && object) return box(`<b>${esc(D.search.owners[object.o - 1].label)}</b><br>report at ${esc(label(object.s))}<br>→ ${esc(label(object.t))}, ${pct(object.r)} risk`);
  if (id === 'pusher-dots' && object) return box(`<b>${esc(label(object.i))}</b><br>pushes on ${object.n} of this portfolio's buildings · +${object.v.toFixed(3)} expected reports`);
  if ((id === 'plan' || id === 'portfolio') && object) return box(`<b>${esc(label(object.i))}</b><br>${CLASS[b.class[object.i]]} · ${pct(b.risk[object.i] / 255)} risk`);
  if (id === 'certified' && object !== undefined) return box(`<b>${esc(label(object))}</b><br>certified · calibrated ${pct(b.risk_lo[object] / 255)}–${pct(b.risk_hi[object] / 255)}`);
  if (id === 'live' && object) return box(`<b>New since snapshot</b><br>${esc(object.type)}<br>${esc(object.when)}`);
  return null;
}

main().catch(err => {
  const el = $('load-text'); if (el) el.textContent = 'Could not load data: ' + err.message + '. Run the backend build first.';
  console.error(err);
});
