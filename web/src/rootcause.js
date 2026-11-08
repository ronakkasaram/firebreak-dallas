// Root cause: which earlier report most likely set this one off, and which report set that one off.
//
// The Hawkes model (backend/firebreak/hawkes.py) says a building's daily rate of new property reports is
//   mu_b + sum over earlier reports i nearby of  a_i * s(d_i) * g(t - t_i)
// where a_i is the triggering strength of report i's kind (a_self at the same building, a_nb elsewhere),
// s(d) = exp(-d / sigma) for another building and 1 for the same one, and g is the two-speed delay
// density: fast_share * beta_fast * e^(-beta_fast t) + (1 - fast_share) * beta_slow * e^(-beta_slow t).
// Divide each term by the total and you get the probability that each earlier report (or nobody, the
// background mu_b) caused report j: the "stochastic declustering" step of the EM fit, run on one report.
// Following the most likely parent back, hop by hop, gives the chain to the origin: the same idea as an
// observability tool tracing an incident back to the service where it started.

const HK = [0, 1, 2, -1, 3, 4, -1];       // events.bin kind -> Hawkes kind
const HK_NAME = ['code', 'rental', 'tenant', 'vacancy', 'nuisance'];
const M_LAT = 110540, M_LON = 111320 * Math.cos(32.78 * Math.PI / 180);
const MIN_P = 0.15;                         // stop following a chain when the best parent is weaker than this
const MAX_HOPS = 8;

function lowerDay(D, d) {
  const day = D.e.day; let lo = 0, hi = D.m;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (day[mid] < d) lo = mid + 1; else hi = mid; }
  return lo;
}

const modelled = (D, j) => D.e.new_case[j] === 1 && HK[D.e.kind[j]] >= 0;

// Probability of each candidate parent of report j, plus the background.
export function parentsOf(D, j) {
  const p = D.hawkes.params, e = D.e, g = e.b[j];
  const bf = p.beta_fast, bs = p.beta_slow, fs = p.fast_share, R = p.radius_m;
  const lon = e.lon[j], lat = e.lat[j], dj = e.day[j];
  const bg = g >= 0 ? D.b.mu[g] : 1e-4;
  const out = [];
  let tot = bg;
  for (let i = lowerDay(D, dj - p.window_days); i < j; i++) {
    if (!modelled(D, i)) continue;
    const dx = (e.lon[i] - lon) * M_LON; if (dx > R || dx < -R) continue;
    const dy = (e.lat[i] - lat) * M_LAT; if (dy > R || dy < -R) continue;
    const d = Math.hypot(dx, dy); if (d > R) continue;
    const same = g >= 0 && e.b[i] === g;
    const k = HK_NAME[HK[e.kind[i]]];
    const t = Math.max(0.5, dj - e.day[i]);       // reports carry a day, not a time: same-day parents count as half a day earlier
    const dens = fs * bf * Math.exp(-bf * t) + (1 - fs) * bs * Math.exp(-bs * t);
    const v = (same ? p.a_self[k] : p.a_nb[k] * Math.exp(-d / p.sigma_m)) * dens;
    if (v <= 0) continue;
    out.push({ j: i, v, d, same });
    tot += v;
  }
  for (const o of out) o.p = o.v / tot;
  out.sort((x, y) => y.p - x.p);
  return { bg: bg / tot, list: out };
}

// The latest modelled report at building g, on or before `day`.
export function latestReport(D, g, day) {
  for (let j = lowerDay(D, day + 1) - 1, stop = lowerDay(D, day - 365); j >= stop; j--) if (D.e.b[j] === g && modelled(D, j)) return j;
  return -1;
}

// Follow the most likely parent back to the origin.
export function chain(D, j) {
  const steps = [{ j, p: 1 }];
  let prob = 1, cur = j, bgEnd = 0;
  for (let h = 0; h < MAX_HOPS; h++) {
    const P = parentsOf(D, cur), top = P.list[0];
    if (!top || top.p < MIN_P || top.p < P.bg) { bgEnd = P.bg; break; }
    prob *= top.p; cur = top.j;
    steps.push({ j: cur, p: top.p, d: top.d, same: top.same });
  }
  return { steps: steps.reverse(), prob, origin: cur, originBg: bgEnd };
}

// Reports that report j most likely set off (its children), up to `days` later.
export function childrenOf(D, j, days = 180) {
  const e = D.e, p = D.hawkes.params, R = p.radius_m, out = [];
  const lon = e.lon[j], lat = e.lat[j];
  let looked = 0;
  for (let c = j + 1, end = lowerDay(D, e.day[j] + days + 1); c < end && looked < 60; c++) {
    if (!modelled(D, c)) continue;
    const dx = (e.lon[c] - lon) * M_LON; if (dx > R || dx < -R) continue;
    const dy = (e.lat[c] - lat) * M_LAT; if (dy > R || dy < -R) continue;
    if (Math.hypot(dx, dy) > R) continue;
    looked++;
    const P = parentsOf(D, c), mine = P.list.find(x => x.j === j);
    if (mine && mine.p >= MIN_P) out.push({ j: c, p: mine.p });
  }
  return out;
}

// For a set of buildings (a cluster), trace each one's latest report to its origin and add up the shares.
export function clusterOrigins(D, buildings, day) {
  const roots = new Map();
  let traced = 0;
  for (const g of buildings) {
    const j = latestReport(D, g, day); if (j < 0) continue;
    const c = chain(D, j); traced++;
    const og = D.e.b[c.origin];
    const r = roots.get(og) || roots.set(og, { g: og, n: 0, w: 0, first: c.origin }).get(og);
    r.n++; r.w += c.prob;
    if (D.e.day[c.origin] < D.e.day[r.first]) r.first = c.origin;
  }
  return { traced, roots: [...roots.values()].filter(r => r.g >= 0).sort((x, y) => y.n - x.n || y.w - x.w) };
}

export const KIND_OF = j => HK_NAME[HK[j]] ?? 'other';
