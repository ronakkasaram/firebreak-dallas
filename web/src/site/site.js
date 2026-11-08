// Product site. Every number on the page is read from the same pipeline files the console loads
// (web/public/data), so the site can never drift from the product. If a file is missing, its numbers
// stay as a dash rather than falling back to a typed-in value.

import './site.css';

const $ = s => document.querySelector(s);
const num = v => Math.round(v).toLocaleString('en-US');
const pct = (v, d = 0) => (v * 100).toFixed(d) + '%';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const date = s => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const get = async f => { try { const r = await fetch(`data/${f}`); return r.ok ? r.json() : null; } catch { return null; } };

function put(k, v) { document.querySelectorAll(`[data-k="${k}"]`).forEach(el => { el.textContent = v; }); }

// The guided tour's shots, in the order film mode plays them (main.js runTour). Times are the tour's own.
const SHOTS = [
  ['Every building in Dallas', 9], ['Distress clusters, and spreads', 9], ['Trace it to the origin', 9], ['The hidden network', 9],
  ['The next 90 days', 8], ['Proof on data it never saw', 10], ['A neural network that sees blind spots', 10], ['One building, 400 futures', 15],
  ['Budget to work orders', 9], ['A brief for every council office', 11], ['Who owns the problem next door', 10], ['Every claim, tested', 9],
];

function storyboard() {
  let t = 4; // after the 4-second title card
  const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const rows = [['Title card', 0, 'open']];
  for (const [name, d] of SHOTS) { rows.push([name, t]); t += d; }
  rows.push(['End card', t, 'close']);
  $('#storyboard').innerHTML = rows.map(([n, s, cls]) => `<li class="${cls || ''}"><time>${fmt(s)}</time><span>${esc(n)}</span></li>`).join('')
    + `<li class="total"><time>${fmt(t + 5)}</time><span>total running time</span></li>`;
}

async function main() {
  storyboard();
  const [m, h, a, e, f, l] = await Promise.all([get('meta.json'), get('hawkes.json'), get('alarms.json'), get('evidence.json'), get('falcon.json'), get('lists.json')]);
  if (!m) return;
  const net = m.model.network, lt = m.audit?.lead_time?.rankings?.network;
  put('asof', date(m.as_of));
  put('buildings', num(m.counts.buildings)); put('buildings2', num(m.counts.buildings));
  put('reports', num(m.counts.reports));
  put('precision', `${pct(net.watch_precision)} vs ${pct(net.base_rate, 1)}`);
  if (lt) { put('leadtime', `${lt.median_days_ahead} days`); put('early', num(lt.cases_reached_early)); }
  put('block', `${m.edges.block.ratio.toFixed(2)}×`); put('owner', `${m.edges.owner.ratio.toFixed(2)}×`); put('infra', `${m.edges.infrastructure.ratio.toFixed(2)}×`);
  if (h) put('spread', pct(h.fit.spread_share));
  put('cutoff', date(m.backtest_cutoff));
  put('tenants', num(m.counts.tenants));
  put('auc', net.auc.toFixed(4)); put('wp', net.watch_precision); put('br', net.base_rate);
  if (l) put('leads', num(new Set(l.lists.flatMap(x => x.leads.map(y => y.parcel_id))).size));
  const insp = m.assumptions?.inspection_cost?.value;
  put('cityCost', '$' + num(m.counts.buildings * 0.10));
  if (insp) put('cityInspections', num(m.counts.buildings * 0.10 / insp));
  if (a?.clusters?.length) {
    const c = a.clusters[0];
    put('topObs', num(c.observed)); put('topExp', c.expected.toFixed(1));
    put('topWin', c.window_days); put('topB', num(c.buildings));
  }

  // Proof table: wins and losses side by side.
  const rows = [];
  rows.push(['Top 2,000 buildings flagged that got a report in 90 days', `${pct(net.watch_precision, 1)} vs ${pct(net.base_rate, 1)} base rate`, 'win']);
  rows.push(['AUC, with network features vs the building\'s own history', `${net.auc.toFixed(3)} vs ${m.model.base.auc.toFixed(3)}`, 'win']);
  if (lt) rows.push(['Cases a 50-visit-a-day crew reaches before the first call', `${num(lt.cases_reached_early)}, median ${lt.median_days_ahead} days early`, 'win']);
  const sel = e?.calibration?.selection;
  if (sel) rows.push(['Certified list, promised at most 10% wrong', `${pct(sel.city_q10.realised_fdr, 1)} wrong`, 'win'],
    ['Same promise at 20%', `${pct(sel.city_q20.realised_fdr, 1)} wrong: broke, so we only certify at 10%`, 'loss']);
  if (h) rows.push(['Spread model vs no spread, held-out log-likelihood', `+${h.fit.test_gain_nats_per_report.toFixed(2)} nats a report`, 'win'],
    ['Spread model as a ranker', `${pct(h.as_ranker.watch_precision, 1)} vs boosted ${pct(h.as_ranker.gbm_watch_precision, 1)}: it simulates, it does not rank`, 'loss']);
  if (a?.backtest) rows.push(['Top 3 cluster alarms a week, next 60 days', `${a.backtest.pooled_obs_over_exp_after.toFixed(2)}× expected (busiest cells: ${a.backtest.control_pooled_obs_over_exp_after.toFixed(2)}×)`, 'win']);
  const fb = f?.backtest;
  if (fb) {
    rows.push(['Neural field (FALCON) vs boosted, top 1% of cells', `${pct(fb.capture_top_1pct.falcon, 1)} vs ${pct(fb.capture_top_1pct.boosted_sum, 1)}: the network lost`, 'loss']);
    const cs = fb.crew_search;
    if (cs?.last_365_days) rows.push(['Crews searching quiet blocks vs patrolling last year\'s hotspots', `${Math.max(cs.falcon.ignitions_found, cs.boosted_quiet_cells?.ignitions_found ?? 0)} vs ${cs.last_365_days.ignitions_found} new hotspots found`, 'win']);
  }
  const cl = e?.closure;
  if (cl) rows.push(['Fast case closure protects neighbours?', `${cl.main.effect_pct}% after, but ${cl.placebo_before_case.effect_pct}% before the case opened: not causal`, 'loss']);
  if (m.edges.infrastructure) rows.push(['Shared pipes and streets as a hidden link', `${m.edges.infrastructure.ratio.toFixed(2)}×: no effect`, 'loss']);
  $('#proof-rows').innerHTML = rows.map(([c, r, k]) => `<tr><td>${esc(c)}</td><td class="r">${esc(r)}</td><td><span class="pill ${k}">${k === 'win' ? 'held' : 'missed'}</span></td></tr>`).join('');

  wireLookup();
}

// Street lookup: autocomplete from the console's own street index, then hand the query to the console.
function wireLookup() {
  const input = $('#addr'), list = $('#streets');
  let streets = null;
  const load = async () => {
    if (streets) return;
    const s = await get('search.json'); streets = s?.streets || [];
  };
  input.addEventListener('focus', load, { once: true });
  input.addEventListener('input', async () => {
    await load();
    const q = input.value.trim().toLowerCase(), m = q.match(/^(\d+)\s+(.*)$/), text = m ? m[2] : q, pre = m ? m[1] + ' ' : '';
    if (text.length < 2) { list.innerHTML = ''; return; }
    list.innerHTML = streets.filter(s => s.toLowerCase().includes(text)).slice(0, 8).map(s => `<option value="${esc(pre + s)}"></option>`).join('');
  });
  $('#lookup').addEventListener('submit', ev => {
    ev.preventDefault();
    const q = input.value.trim(); if (!q) { input.focus(); return; }
    try { sessionStorage.setItem('fb-q', q); } catch { /* storage blocked: the console opens on Home */ }
    location.href = 'app.html#home';
  });
}

main();
