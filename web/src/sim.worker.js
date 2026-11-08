// House-by-house spread simulator. Runs the Hawkes model fitted by backend/firebreak/hawkes.py
// forward 90 days around one building, off the main thread.
//
// Each building b has a daily rate   mu_b + (charge_b) * (1 - e^-beta)
// where charge_b holds the slow (spread) part of every earlier report that can still trigger b:
//   a_self[kind] * (1 - fast_share)                         for a report at b itself
//   a_nb[kind] * exp(-d / sigma) * (1 - fast_share)         for a report at another building d metres away
// Charge decays by e^-beta per day. A simulated report adds charge the same way, so reports can
// trigger reports that trigger reports (a cascade).
//
// Two engines:
//   monteCarlo  -  random cascades with a seeded generator; the same seeds are reused for every
//                  scenario (common random numbers), so "with" and "without" differ only by the
//                  intervention, not by luck.
//   expected    -  the exact expected number of reports under the same linear model, computed
//                  day by day without randomness. Used by the firebreak search, which needs
//                  hundreds of evaluations.
// Firebreak search: lazy greedy (CELF, Leskovec et al. 2007) on "reports prevented at other
// houses", the influence-maximisation recipe of Kempe, Kleinberg & Tardos (2003) run in reverse.

const KIND_MAP = [0, 1, 2, -1, 3, 4, -1]; // events.bin kind -> Hawkes kind (construction, infra not modelled)
const M_LON = 111320 * Math.cos(32.78 * Math.PI / 180);
const M_LAT = 111320;
const CELL = 0.003; // grid cell in degrees, about 300 m
const REGION_M = 700;
const HORIZON = 90;

let B, E, P, today, bGrid, eGrid;
let R = null; // the current region

const key = (gx, gy) => gx * 100000 + gy;
function gridOf(lon, lat, n, keep) {
  const g = new Map();
  for (let i = 0; i < n; i++) {
    if (keep && !keep(i)) continue;
    const k = key(Math.floor(lon[i] / CELL), Math.floor(lat[i] / CELL));
    let a = g.get(k); if (!a) g.set(k, a = []); a.push(i);
  }
  return g;
}
function near(g, lon, lat, lonC, latC, rM, out) {
  const span = Math.ceil(rM / (CELL * M_LAT)) + 1;
  const gx = Math.floor(lonC / CELL), gy = Math.floor(latC / CELL);
  for (let dx = -span; dx <= span; dx++) for (let dy = -span; dy <= span; dy++) {
    const a = g.get(key(gx + dx, gy + dy)); if (!a) continue;
    for (const i of a) {
      const x = (lon[i] - lonC) * M_LON, y = (lat[i] - latC) * M_LAT, d2 = x * x + y * y;
      if (d2 <= rM * rM) out.push(i, Math.sqrt(d2));
    }
  }
  return out;
}

function rng(seed) { // xorshift32
  let s = (seed ^ 0x9e3779b9) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function init(msg) {
  B = msg.b; E = msg.e; today = msg.today;
  const p = msg.params, kinds = ['code', 'rental', 'tenant', 'vacancy', 'nuisance'];
  P = {
    beta: p.beta_slow, slow: 1 - p.fast_share, sigma: p.sigma_m, R: p.radius_m, window: p.window_days,
    aSelf: kinds.map(k => p.a_self[k]), aNb: kinds.map(k => p.a_nb[k]), share: kinds.map(k => p.kind_share[k]),
    spill: msg.spill, spillR: msg.spillR,
  };
  P.decay = Math.exp(-P.beta); P.q = 1 - P.decay;
  P.aSelfBar = P.aSelf.reduce((a, v, k) => a + v * P.share[k], 0);
  P.aNbBar = P.aNb.reduce((a, v, k) => a + v * P.share[k], 0);
  P.cum = []; let c = 0; for (const s of P.share) P.cum.push(c += s);
  bGrid = gridOf(B.lon, B.lat, B.n);
  const lo = today - P.window;
  eGrid = gridOf(E.lon, E.lat, E.m, j => E.new_case[j] && KIND_MAP[E.kind[j]] >= 0 && E.day[j] >= lo && E.day[j] < today);
  postMessage({ type: 'ready' });
}

// Region around building i: buildings within 700 m, their neighbour lists, and the charge every
// recent real report leaves on them, kept per source building so a firebreak can remove it.
function region(i) {
  const lonC = B.lon[i], latC = B.lat[i];
  const hits = near(bGrid, B.lon, B.lat, lonC, latC, REGION_M, []);
  const N = hits.length / 2, glob = new Int32Array(N), local = new Map();
  for (let a = 0; a < N; a++) { glob[a] = hits[2 * a]; local.set(hits[2 * a], a); }
  const mu = new Float64Array(N), resVal = new Float64Array(N);
  const start = new Int32Array(N + 1), idx = [], w = [];
  for (let a = 0; a < N; a++) {
    const g = glob[a]; mu[a] = B.mu[g];
    start[a] = idx.length;
    const nb = near(bGrid, B.lon, B.lat, B.lon[g], B.lat[g], P.R, []);
    for (let q = 0; q < nb.length; q += 2) {
      const j = nb[q], d = nb[q + 1]; if (j === g) continue;
      if (d <= P.spillR && B.class[j] <= 1) resVal[a] += B.value[j];
      const lj = local.get(j); if (lj === undefined) continue;
      const wt = Math.exp(-d / P.sigma); if (wt < 0.02) continue;
      idx.push(lj); w.push(wt);
    }
  }
  start[N] = idx.length;

  // Charge from real reports, split by the building the report was at.
  const c0 = new Float64Array(N), bySrc = new Map(), events = [];
  const seen = new Set();
  for (let a = 0; a < N; a++) {
    const g = glob[a];
    const ev = near(eGrid, E.lon, E.lat, B.lon[g], B.lat[g], P.R, []);
    for (let q = 0; q < ev.length; q += 2) {
      const j = ev[q], d = ev[q + 1], k = KIND_MAP[E.kind[j]], age = today - E.day[j];
      const self = E.b[j] === g;
      const v = (self ? P.aSelf[k] : P.aNb[k] * Math.exp(-d / P.sigma)) * P.slow * Math.exp(-P.beta * age);
      c0[a] += v;
      const src = E.b[j];
      if (src >= 0) { let m = bySrc.get(src); if (!m) bySrc.set(src, m = []); m.push(a, v); }
      if (g === i) events.push({ j, d, k, age, v, self });
      if (!seen.has(j)) seen.add(j);
    }
  }
  R = { i, N, glob, local, mu, resVal, start, idx: Int32Array.from(idx), w: Float64Array.from(w), c0, bySrc,
    focus: local.get(i), events, reportsNearby: seen.size };
}

function startCharge(stab) {
  const c = Float64Array.from(R.c0);
  for (const g of stab) {
    const m = R.bySrc.get(g); if (!m) continue;
    for (let q = 0; q < m.length; q += 2) c[m[q]] -= m[q + 1];
  }
  for (let a = 0; a < R.N; a++) if (c[a] < 0) c[a] = 0;
  return c;
}

function stabMask(stab) {
  const s = new Uint8Array(R.N);
  for (const g of stab) { const a = R.local.get(g); if (a !== undefined) s[a] = 1; }
  return s;
}

function monteCarlo(stab, runs, seed) {
  const { N, mu, start, idx, w } = R;
  const S = stabMask(stab), c0 = startCharge(stab);
  const firstHist = new Float32Array((HORIZON + 1) * N); // runs whose first report at b is on day t
  const mean = new Float64Array(N), daily = new Float64Array(HORIZON);
  const totals = new Float64Array(runs);
  const c = new Float64Array(N), first = new Int16Array(N), fired = [];
  for (let r = 0; r < runs; r++) {
    const rand = rng(seed + r * 7919), randKind = rng(seed + r * 104729 + 1);
    c.set(c0); first.fill(-1);
    let total = 0;
    for (let t = 0; t < HORIZON; t++) {
      fired.length = 0;
      for (let a = 0; a < N; a++) {
        if (S[a]) { rand(); continue; } // keep the random stream aligned across scenarios
        const lam = mu[a] + c[a] * P.q;
        const u = rand();
        if (u < (lam < 0.02 ? lam : 1 - Math.exp(-lam))) fired.push(a);
      }
      for (let a = 0; a < N; a++) c[a] *= P.decay;
      for (const a of fired) {
        const u = randKind(); let k = 0; while (k < 4 && u > P.cum[k]) k++;
        c[a] += P.aSelf[k] * P.slow;
        const an = P.aNb[k] * P.slow;
        for (let q = start[a]; q < start[a + 1]; q++) c[idx[q]] += an * w[q];
        mean[a] += 1;
        if (first[a] < 0) { first[a] = t + 1; firstHist[(t + 1) * N + a] += 1; }
      }
      total += fired.length; daily[t] += fired.length;
    }
    totals[r] = total;
  }
  // Cumulative share of runs with a first report by day t.
  const pBy = new Float32Array((HORIZON + 1) * N);
  for (let a = 0; a < N; a++) {
    let s = 0;
    for (let t = 0; t <= HORIZON; t++) { s += firstHist[t * N + a]; pBy[t * N + a] = s / runs; }
  }
  for (let a = 0; a < N; a++) mean[a] /= runs;
  const cumDaily = new Float32Array(HORIZON + 1);
  for (let t = 0; t < HORIZON; t++) cumDaily[t + 1] = cumDaily[t] + daily[t] / runs;
  const sorted = Array.from(totals).sort((x, y) => x - y);
  // Median first day at the focus house, among runs where it got a report.
  let medianDay = null;
  const f = R.focus, pf = pBy[HORIZON * N + f];
  if (pf > 0) for (let t = 0; t <= HORIZON; t++) if (pBy[t * N + f] >= pf / 2) { medianDay = t; break; }
  return { pBy, mean, cumDaily, medianDay, p10: sorted[Math.floor(runs * 0.1)], p90: sorted[Math.floor(runs * 0.9)] };
}

// Expected reports per building over the horizon (no randomness).
function expected(stab) {
  const { N, mu, start, idx, w } = R;
  const S = stabMask(stab), c = startCharge(stab);
  const tot = new Float64Array(N), m = new Float64Array(N);
  const self = P.aSelfBar * P.slow, nb = P.aNbBar * P.slow;
  for (let t = 0; t < HORIZON; t++) {
    for (let a = 0; a < N; a++) { m[a] = S[a] ? 0 : mu[a] + c[a] * P.q; tot[a] += m[a]; }
    for (let a = 0; a < N; a++) c[a] *= P.decay;
    for (let a = 0; a < N; a++) {
      const x = m[a]; if (x === 0) continue;
      c[a] += x * self;
      const y = x * nb;
      for (let q = start[a]; q < start[a + 1]; q++) c[idx[q]] += y * w[q];
    }
  }
  return tot;
}

function spreadPrevented(base, stab) {
  const e = expected(stab), S = stabMask(stab);
  let spread = 0, own = 0;
  for (let a = 0; a < R.N; a++) { if (S[a]) own += base[a]; else spread += base[a] - e[a]; }
  return { spread, own };
}

function firebreaks(k, fixed) {
  const base = expected([]);
  const order = Array.from({ length: R.N }, (_, a) => a).sort((x, y) => base[y] - base[x]);
  const cands = order.slice(0, 24).map(a => R.glob[a]).filter(g => !fixed.includes(g));
  let picked = [...fixed], cur = fixed.length ? spreadPrevented(base, fixed).spread : 0, evals = 0;
  // CELF: if gains only shrink as the set grows (submodular), a stale gain is an upper bound and
  // only the top candidate needs re-scoring each round.
  let heap = cands.map(g => ({ g, gain: Infinity, round: -1 }));
  const out = [];
  for (let round = 0; round < k && heap.length; round++) {
    for (;;) {
      heap.sort((x, y) => y.gain - x.gain);
      const top = heap[0];
      if (top.round === round) break;
      top.gain = spreadPrevented(base, [...picked, top.g]).spread - cur; top.round = round; evals++;
      postMessage({ type: 'progress', text: `searching firebreaks · ${evals} scenarios scored` });
    }
    const best = heap.shift();
    picked.push(best.g); cur += best.gain;
    out.push({ g: best.g, spread: best.gain, own: base[R.local.get(best.g)] });
  }
  return { picks: out, evals, candidates: cands.length, spreadTotal: cur };
}

function summary(stab, runs, seed) {
  const base = monteCarlo([], runs, seed);
  const withS = stab.length ? monteCarlo(stab, runs, seed) : null;
  const N = R.N, f = R.focus;
  // Neighbour value protected: each house kept out of distress spares 0.9% of the residential value
  // within 200 m (Immergluck & Smith 2006), weighted by the drop in its chance of a report.
  let protectedUsd = 0, prevented = 0;
  if (withS) for (let a = 0; a < N; a++) {
    const dp = base.pBy[HORIZON * N + a] - withS.pBy[HORIZON * N + a];
    if (dp > 0) protectedUsd += dp * P.spill * R.resVal[a];
    prevented += base.mean[a] - withS.mean[a];
  }
  // What drives the focus house: background vs its own past reports vs neighbours'.
  const keep = 1 - Math.exp(-P.beta * HORIZON);
  const drivers = R.events.map(e => ({ lon: E.lon[e.j], lat: E.lat[e.j], kind: E.kind[e.j], d: Math.round(e.d), age: e.age,
    self: e.self, v: e.v * keep })).sort((x, y) => y.v - x.v);
  const bg = R.mu[f] * HORIZON;
  const selfV = drivers.filter(d => d.self).reduce((a, d) => a + d.v, 0);
  const nbV = drivers.filter(d => !d.self).reduce((a, d) => a + d.v, 0);
  // Outbound: the charge this building's own recent reports put on each neighbour (who it pushes on).
  const outM = R.bySrc.get(R.i) || [], agg = new Map();
  for (let q = 0; q < outM.length; q += 2) if (outM[q] !== f) agg.set(outM[q], (agg.get(outM[q]) || 0) + outM[q + 1] * keep);
  const outbound = [...agg.entries()].map(([a, v]) => ({ g: R.glob[a], v })).sort((x, y) => y.v - x.v);
  return {
    outbound: outbound.slice(0, 40), outboundTotal: outbound.reduce((a, o) => a + o.v, 0),
    type: 'result', i: R.i, N, glob: R.glob, focus: f, runs, stab,
    base: { pBy: base.pBy, cumDaily: base.cumDaily, medianDay: base.medianDay, p10: base.p10, p90: base.p90 },
    withS: withS && { pBy: withS.pBy, cumDaily: withS.cumDaily, medianDay: withS.medianDay, p10: withS.p10, p90: withS.p90 },
    prevented, protectedUsd,
    drivers: { background: bg, self: selfV, neighbours: nbV, top: drivers.slice(0, 8), reportsNearby: R.reportsNearby },
  };
}

// Live reports filed after the snapshot: appended as new cases dated today, so they charge their
// neighbours in every later simulation.
function addEvents(ev) {
  const grow = (a, T, vals) => { const o = new T(a.length + vals.length); o.set(a); o.set(vals, a.length); return o; };
  E = { m: E.m + ev.length,
    lon: grow(E.lon, Float32Array, ev.map(x => x.lon)), lat: grow(E.lat, Float32Array, ev.map(x => x.lat)),
    day: grow(E.day, E.day.constructor, ev.map(() => today)), kind: grow(E.kind, Uint8Array, ev.map(x => x.kind)),
    b: grow(E.b, Int32Array, ev.map(x => x.b)), new_case: grow(E.new_case, Uint8Array, ev.map(() => 1)) };
  const lo = today - P.window;
  eGrid = gridOf(E.lon, E.lat, E.m, j => E.new_case[j] && KIND_MAP[E.kind[j]] >= 0 && E.day[j] >= lo && E.day[j] <= today);
  R = null;
}

onmessage = ({ data: msg }) => {
  if (msg.type === 'init') return init(msg);
  if (msg.type === 'add') return addEvents(msg.ev);
  if (msg.type === 'focus') {
    if (!R || R.i !== msg.i) region(msg.i);
    return postMessage(summary(msg.stab, msg.runs, msg.seed));
  }
  if (msg.type === 'firebreaks') {
    if (!R || R.i !== msg.i) region(msg.i);
    const fb = firebreaks(msg.k, msg.stab);
    postMessage({ type: 'firebreaks', ...fb });
  }
};
