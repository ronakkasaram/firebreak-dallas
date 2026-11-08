// Side panel for each step of the workflow. Every number comes from the pipeline's files
// (meta.json, hotspots.json, lists.json, hawkes.json, alarms.json, evidence.json); the panel only
// formats them. The one exception is the Act plan, which re-ranks pipeline numbers against the
// costs the user types in.

export const $ = id => document.getElementById(id);
export const usd = v => '$' + Math.round(v).toLocaleString();
export const kusd = v => Math.abs(v) >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e4 ? '$' + Math.round(v / 1e3) + 'K' : usd(v);
export const pct = (v, d = 0) => (v * 100).toFixed(d) + '%';
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmtDate = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const num = (v, d = 0) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const CLASS = ['home', 'multifamily', 'commercial', 'industrial'];
export const KIND_NAME = ['code violation', 'unregistered rental', 'tenant complaint', 'construction', 'vacancy', 'nuisance', 'pipe, street or signal'];
export const KIND_HEX = ['#e69f00', '#56b4e9', '#009e73', '#999999', '#cc79a7', '#d55e00', '#0072b2'];
export const HEAT = ['#420a68', '#932667', '#dd513a', '#fca50a', '#fcffa4'];
const HK = ['code', 'rental', 'tenant', 'vacancy', 'nuisance'];

export function veilAddr(a) { return String(a).replace(/^\d+/, m => (Math.floor(+m / 100) * 100) + ' block of'); }
function shownAddr(h) { return h.asset_class === 'home' ? veilAddr(h.address) : h.address; }

export function store(key, val) {
  try {
    if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
    localStorage.setItem(key, JSON.stringify(val));
  } catch { return null; }
}

function kpi(v, label, caption = '') {
  return `<div class="kpi"><div class="v">${v}</div><div class="l">${label}</div>${caption ? `<div class="c">${caption}</div>` : ''}</div>`;
}
function header(title, meta = '') { return `<div class="ph"><h2>${title}</h2>${meta ? `<span class="meta">${meta}</span>` : ''}</div>`; }

// ---------- small charts (inline SVG, no library) ----------

function lineChart(series, { h = 120, yMin = null, yMax = null, labels = [], fmt = v => v.toFixed(2), ref = null } = {}) {
  const W = 368, pad = { l: 34, r: 8, t: 8, b: 18 };
  const all = series.flatMap(s => s.values.filter(v => v != null));
  const lo = yMin ?? Math.min(...all), hi = yMax ?? Math.max(...all);
  const n = Math.max(...series.map(s => s.values.length));
  const x = i => pad.l + (W - pad.l - pad.r) * (n === 1 ? 0 : i / (n - 1));
  const y = v => pad.t + (h - pad.t - pad.b) * (1 - (v - lo) / ((hi - lo) || 1));
  const ticks = [lo, (lo + hi) / 2, hi];
  const paths = series.map(s => {
    let d = '', pen = false;
    s.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.5" ${s.dash ? 'stroke-dasharray="3 3"' : ''}/>`;
  }).join('');
  const lab = labels.length ? [0, Math.floor((labels.length - 1) / 2), labels.length - 1]
    .map((i, k) => `<text x="${x(i)}" y="${h - 4}" text-anchor="${['start', 'middle', 'end'][k]}">${esc(labels[i])}</text>`).join('') : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" height="${h}" role="img">
    ${ticks.map(t => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('')}
    ${ref != null ? `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(ref)}" y2="${y(ref)}" stroke="#747983" stroke-dasharray="2 3"/>` : ''}
    ${paths}${lab}</svg>`;
}

function calibrationChart(deciles) {
  const W = 368, H = 160, pad = { l: 34, r: 8, t: 8, b: 22 };
  const hi = Math.max(...deciles.map(d => Math.max(d.predicted, d.observed))) * 1.05;
  const x = v => pad.l + (W - pad.l - pad.r) * v / hi, y = v => pad.t + (H - pad.t - pad.b) * (1 - v / hi);
  const ticks = [0, hi / 2, hi];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Calibration">
    ${ticks.map(t => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${pct(t)}</text>`).join('')}
    <line x1="${x(0)}" y1="${y(0)}" x2="${x(hi)}" y2="${y(hi)}" stroke="#747983" stroke-dasharray="2 3"/>
    ${deciles.map(d => `<line x1="${x(d.lo)}" x2="${x(d.hi)}" y1="${y(d.observed)}" y2="${y(d.observed)}" stroke="#8ab4ff" stroke-width="3"/>
      <circle cx="${x(d.predicted)}" cy="${y(d.observed)}" r="3" fill="#8ab4ff"/>`).join('')}
    <text x="${W - pad.r}" y="${H - 4}" text-anchor="end">predicted →</text><text x="${pad.l}" y="${H - 4}">observed ↑ (held-out)</text></svg>`;
}

function heatStrip(rows, months) {
  const color = v => {
    if (v == null) return 'transparent';
    const t = Math.max(0, Math.min(1, (v - 0.15) / 0.25));
    return HEAT[Math.min(4, Math.floor(t * 4.999))];
  };
  return `<div class="strip">${rows.map(([name, vals]) => `<div class="r"><span>${name}</span><span class="cells"
    style="grid-template-columns:repeat(${months.length},1fr)">${vals.map((v, i) => `<i title="${months[i]}: ${v == null ? 'n/a' : v.toFixed(2)}"
    style="background:${color(v)}"></i>`).join('')}</span></div>`).join('')}</div>`;
}

// ---------- 1. Detect ----------

export function renderDetect(D, S, h) {
  const { meta, alarms, hawkes } = D;
  const rep = hawkes?.reproduction;
  const city = rep?.city || [];
  const last = city.filter(c => !c.provisional).slice(-1)[0];
  const edges = Object.entries(meta.edges);
  const lt = alarms?.backtest || {};
  const live = S.live;
  $('panel').innerHTML = `
    <div class="pane">
      ${header('Detect', `311 through ${fmtDate(new Date(meta.as_of))}`)}
      <p>What is happening now: where distress is clustering faster than each place's own history, and whether it is
        growing or fading.</p>
      <div class="kpis">
        ${kpi(num(D.recent7), 'property reports, last 7 days', `${num(D.recent7prev)} the week before`)}
        ${kpi(alarms ? num(alarms.clusters.length) : '—', 'clusters being watched', 'expectation-based subset scan')}
        ${last ? kpi(last.r.toFixed(2), `spread rate R, ${last.month}`, `each problem becomes ${last.amplifier.toFixed(2)} reports`) : ''}
        ${live.status !== 'on' ? kpi('—', 'live 311 feed', esc(live.note || 'connecting')) : live.mode === 'live'
          ? kpi(num(live.count), 'new reports since the snapshot', `Dallas Open Data, pulled ${live.at}`)
          : kpi(num(live.count), 'reports in the last 48 h', 'replay: live feed unreachable here')}
      </div>
    </div>
    ${live.status === 'on' && live.jumps.length ? `<div class="pane">
      <div class="sec-h"><h3>${live.mode === 'live' ? 'Outlook raised by new reports' : 'Outlook raised by the last 48 hours'}</h3><small>expected extra reports, 90 days</small></div>
      <div class="tw"><table class="t"><thead><tr><th>Building</th><th class="r">+ reports</th></tr></thead><tbody>
      ${live.jumps.slice(0, 8).map(j => `<tr class="pick" data-b="${j.i}"><td>${esc(j.label)}<small>${esc(j.why)}</small></td><td class="r">+${j.d.toFixed(3)}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}
    <div class="pane">
      <div class="sec-h"><h3>Emerging clusters</h3><small>${alarms ? `windows ${alarms.windows.join(' / ')} days` : ''}</small></div>
      ${alarms ? `<div class="tw"><table class="t"><thead><tr><th>#</th><th>Window</th><th class="r">Houses hit</th><th class="r">Expected</th><th class="r">Rarity</th></tr></thead><tbody>
        ${alarms.clusters.map((c, k) => `<tr class="pick ${S.alarm === k ? 'on' : ''}" data-a="${k}"><td>${k + 1}</td><td>${c.window_days} d</td>
          <td class="r">${num(c.observed)}</td><td class="r">${c.expected.toFixed(1)}</td>
          <td class="r">${c.recurrence_weeks >= 2 ? `1 in ${c.recurrence_weeks.toFixed(0)} wk` : 'routine'}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="note">Counts are distinct houses with a new case, against the same cells' history scaled to the city's
        current pace. Rarity compares each score with the strongest cluster of every week in the past year.
        Backtest over ${lt.weeks || '—'} weeks: the top 3 clusters kept reporting at <b>${lt.pooled_obs_over_exp_after ?? '—'}×</b> their
        baseline over the next ${lt.follow_days || 60} days (the busiest cells by raw count: ${lt.control_pooled_obs_over_exp_after ?? '—'}×).</p>`
      : '<div class="empty">Run the backend build to make alarms.json.</div>'}
    </div>
    ${rep ? `<div class="pane">
      <div class="sec-h"><h3>Spread rate by month</h3><small>realised R, Wallinga–Teunis on the Hawkes fit</small></div>
      ${lineChart([{ values: city.map(c => c.r), color: '#fca50a' }], { labels: city.map(c => c.month), fmt: v => v.toFixed(2) })}
      ${heatStrip(Object.entries(rep.districts).map(([d, v]) => [`D${d}`, v]), rep.months)}
      <p class="note">R is new reports each report sets off at the same or nearby houses. Below 1 the spread dies out
        on its own, but it multiplies every new problem by 1 / (1 − R). Lighter cells: faster spread. The last two months
        are provisional.</p>
    </div>` : ''}
    <div class="pane">
      <div class="sec-h"><h3>The claim we tested</h3><small>CBRE brief</small></div>
      <div class="claim">"Commercial property networks are too fragmented to detect hidden dependencies."</div>
      <div>${edges.map(([k, e]) => `<div class="edge"><span>${k === 'block' ? 'Next door' : k === 'owner' ? 'Same owner' : 'Pipes and streets'}</span>
        <b class="${e.ratio >= 1.1 ? 'yes' : 'no'}">${e.ratio.toFixed(2)}×</b><small>${esc(e.edge)}. ${num(e.exposed_buildings)} buildings with no prior report, 4 test periods.</small></div>`).join('')}</div>
      <p class="note">Two of three hidden links are real and measurable on buildings that had never had a report. Pipes
        and streets are not, and saying so is part of the answer.</p>
    </div>`;
  $('panel').querySelectorAll('tr[data-a]').forEach(tr => { tr.onclick = () => h.alarm(+tr.dataset.a); });
  $('panel').querySelectorAll('tr[data-b]').forEach(tr => { tr.onclick = () => h.house(+tr.dataset.b); });
}

// ---------- 2. Predict ----------

export function renderPredict(D, S, h) {
  const { meta, evidence } = D;
  const net = meta.model.network, base = meta.model.base;
  const cal = evidence?.calibration, live = evidence?.live;
  const q10 = cal?.selection?.city_q10, q20 = cal?.selection?.city_q20;
  const rows = D.hotspots.filter(x => S.filter === 'all' || x.asset_class === S.filter).slice(0, 30);
  $('panel').innerHTML = `
    <div class="pane">
      ${header('Predict', `next ${meta.horizon_days} days`)}
      <p>Which buildings get a new distress report in the next 90 days, how sure we are, and how often we were right
        on a period the model never saw.</p>
      <div class="chips" id="sub">${[['forecast', 'Forecast'], ['proof', 'Backtest'], ['certified', 'Certified list']].map(([k, t]) =>
        `<button class="chip ${S.predict === k ? 'on' : ''}" data-k="${k}">${t}</button>`).join('')}</div>
      <div class="kpis">
        ${kpi(pct(net.watch_precision), `of top ${num(net.watch_list)} got a report`, `held-out ${meta.backtest_cutoff} · base rate ${pct(net.base_rate, 1)}`)}
        ${kpi(net.watch_lift.toFixed(1) + '<small>×</small>', 'lift over base rate', `AUC ${net.auc.toFixed(3)} (own history only ${base.auc.toFixed(3)})`)}
        ${live ? kpi(num(live.certified), 'certified buildings today', `at most ${pct(live.q)} expected wrong`) : ''}
        ${q10 ? kpi(pct(q10.realised_fdr, 1), 'wrong on the certified list', `promised ≤ ${pct(q10.q)} · held-out ${evidence.calibration.test_on}`) : ''}
      </div>
    </div>
    ${cal ? `<div class="pane">
      <div class="sec-h"><h3>Calibration</h3><small>Venn–Abers, ten risk deciles</small></div>
      ${calibrationChart(cal.deciles)}
      <p class="note">Each bar is a decile of houses: its [p0, p1] interval against what happened. On the held-out
        quarter the model ran about one fifth hot, because summer 2026 was quieter than spring. The certified list
        (Jin & Candès conformal selection) kept its promise at 10% (${q10 ? pct(q10.realised_fdr, 1) : '—'} wrong); at 20% it did not
        (${q20 ? pct(q20.realised_fdr, 1) : '—'}), so we only certify at 10%.</p>
    </div>` : ''}
    <div class="pane">
      <div class="sec-h"><h3>Priority interventions</h3><small>ranked by value at stake</small></div>
      <div class="chips" id="filters">${['all', 'home', 'multifamily', 'commercial'].map(c =>
        `<button class="chip ${S.filter === c ? 'on' : ''}" data-c="${c}">${c === 'all' ? 'All' : c[0].toUpperCase() + c.slice(1)}</button>`).join('')}</div>
      <div class="tw"><table class="t"><thead><tr><th>Building</th><th class="r">Risk</th><th class="r">At stake</th></tr></thead><tbody>
      ${rows.map((x, k) => `<tr class="pick" data-k="${k}"><td>${esc(x.name || shownAddr(x))}<small>${x.asset_class}${x.tenants ? ` · ${x.tenants} tenants` : ''} · ${x.zip}</small></td>
        <td class="r">${pct(x.risk)}</td><td class="r">${kusd(x.usd.exposure)}</td></tr>`).join('')}
      </tbody></table></div>
    </div>`;
  $('sub').onclick = ev => { const k = ev.target.closest('button')?.dataset.k; if (k) h.sub(k); };
  $('filters').onclick = ev => { const c = ev.target.closest('button')?.dataset.c; if (c) h.filter(c); };
  $('panel').querySelectorAll('tr[data-k]').forEach(tr => { tr.onclick = () => h.hotspot(rows[+tr.dataset.k]); });
}

// ---------- 3. Simulate ----------

function sparkline(base, withS) {
  return lineChart([{ values: Array.from(base), color: '#fca50a' }, ...(withS ? [{ values: Array.from(withS), color: '#009e73', dash: true }] : [])],
    { h: 90, yMin: 0, fmt: v => v.toFixed(0) });
}

export function renderSimulateIdle(D) {
  const hk = D.hawkes;
  if (!hk) { $('panel').innerHTML = '<div class="pane"><div class="empty">Run the backend build to make hawkes.json.</div></div>'; return; }
  const f = hk.fit, p = hk.params;
  const maxB = Math.max(...HK.map(k => hk.branching[k].same_house + hk.branching[k].neighbours));
  $('panel').innerHTML = `
    <div class="pane">
      ${header('Simulate', 'house by house')}
      <p>Pick any building. Firebreak runs 400 possible futures for it and every building within 700 m, using a
        self-exciting point process fitted to every Dallas property report: each report raises the rate of its own
        house and of houses within ${p.radius_m} m, fading with distance (${p.sigma_m} m) and time (${p.slow_delay_days} days).</p>
      <div class="kpis">
        ${kpi(pct(f.spread_share), 'of reports set off by a nearby earlier report', `plus ${pct(f.triggered_share - f.spread_share)} same-hour echoes`)}
        ${kpi('+' + f.test_gain_nats_per_report.toFixed(2), 'nats per report vs no spread', `held-out ${f.test.replace(' to ', '–')}`)}
      </div>
    </div>
    <div class="pane">
      <div class="sec-h"><h3>New reports each report sets off</h3><small>same house · neighbours</small></div>
      <div class="sec">${HK.map(k => { const b = hk.branching[k]; return `<div class="inline" style="font-size:12px">
        <span style="width:64px;color:var(--text-2)">${k}</span>
        <span class="bar" style="flex:1"><i style="width:${b.same_house / maxB * 100}%;background:#dd513a"></i><i style="width:${b.neighbours / maxB * 100}%;background:#fca50a"></i></span>
        <span style="width:36px;text-align:right">${(b.same_house + b.neighbours).toFixed(2)}</span></div>`; }).join('')}</div>
      <p class="note">As a ranker this model hits ${pct(hk.as_ranker.watch_precision)} on the top 2,000 against
        ${pct(hk.as_ranker.gbm_watch_precision)} for the boosted model, so Predict ranks with the boosted model and Simulate
        uses this one for what-ifs.</p>
      <p class="note">Click any building on the map, or search for a street.</p>
    </div>`;
}

export function renderHouse(D, H, a) {
  const { b } = D, r = H.res, i = H.i, end = 90;
  const N = r?.N, f = r?.focus;
  const pBase = r ? r.base.pBy[end * N + f] : null;
  const pWith = r?.withS ? r.withS.pBy[end * N + f] : null;
  const stab = H.stab.includes(i);
  const dr = r?.drivers, drTot = dr ? dr.background + dr.self + dr.neighbours : 1;
  const area = r ? r.base.cumDaily[end] : 0, areaWith = r?.withS ? r.withS.cumDaily[end] : null;
  const hot = D.hotspots.find(x => x.i === i);
  const title = hot ? (hot.name || shownAddr(hot)) : D.label(i);
  $('panel').innerHTML = `
    <div class="pane">
      <div class="ph"><h2>${esc(title)}</h2><button class="close" id="h-close">Back to overview (Esc)</button></div>
      <p class="t2">${CLASS[b.class[i]]} · council district ${b.district?.[i] || '—'} · DCAD value ${kusd(b.value[i])} ·
        ${b.reports_365[i]} reports in the last year</p>
      <div class="kpis">
        ${kpi(pct(b.risk[i] / 255), 'boosted-model 90-day risk', b.risk_lo ? `calibrated ${pct(b.risk_lo[i] / 255)}–${pct(b.risk_hi[i] / 255)}${b.certified?.[i] ? ' · certified' : ''}` : '')}
        ${r ? kpi(stab ? '0%' : pct(pWith ?? pBase), 'simulated chance of a report', pWith !== null && !stab ? `${pct(pBase)} with no firebreaks` : r.base.medianDay ? `median first day ${r.base.medianDay}` : '') : kpi('<span class="skel" style="display:block;width:60px"></span>', 'simulating', '')}
      </div>
    </div>
    ${!r ? `<div class="pane"><p class="note">${esc(H.status || 'Simulating 400 futures…')}</p></div>` : `
    <div class="pane">
      <div class="sec-h"><h3>Expected reports within 700 m</h3><small>${(areaWith ?? area).toFixed(1)}${areaWith !== null ? ` (was ${area.toFixed(1)})` : ''} · 80% of futures ${(r.withS || r.base).p10}–${(r.withS || r.base).p90}</small></div>
      ${sparkline(r.base.cumDaily, r.withS?.cumDaily)}
    </div>
    <div class="pane">
      <div class="sec-h"><h3>What drives this house</h3><small>expected reports, 90 days</small></div>
      <div class="bar" style="height:8px"><i style="width:${dr.background / drTot * 100}%;background:#4b4f58"></i><i style="width:${dr.self / drTot * 100}%;background:#dd513a"></i><i style="width:${dr.neighbours / drTot * 100}%;background:#fca50a"></i></div>
      <ul class="rows">
        <li><span>Its own record (DCAD, last year's reports)</span><b>${dr.background.toFixed(2)}</b></li>
        <li><span>Its recent reports</span><b>${dr.self.toFixed(2)}</b></li>
        <li><span>Neighbours' recent reports</span><b>${dr.neighbours.toFixed(2)}</b></li>
      </ul>
      ${dr.top.length ? `<table class="t"><thead><tr><th>Recent report</th><th>Where</th><th class="r">Push</th></tr></thead><tbody>
        ${dr.top.slice(0, 5).map(t => `<tr><td>${KIND_NAME[t.kind]}</td><td>${t.self ? 'this house' : t.d + ' m away'}, ${t.age} d ago</td><td class="r">+${t.v.toFixed(3)}</td></tr>`).join('')}
      </tbody></table>` : '<p class="note">No reports within 250 m in the last 180 days.</p>'}
    </div>
    <div class="pane">
      <div class="sec-h"><h3>Intervene</h3><small>same random seeds in every scenario</small></div>
      <div class="inline">
        <button class="btn ${stab ? 'primary' : ''}" id="stab">${stab ? 'Stabilized · undo' : 'Stabilize this house'}</button>
        <button class="btn" id="fb" ${H.busy ? 'disabled' : ''}>Find 3 firebreaks</button>
        ${H.stab.length ? '<button class="btn" id="clear">Clear</button>' : ''}
      </div>
      ${H.status ? `<p class="note" id="h-status">${esc(H.status)}</p>` : ''}
      ${H.fb ? `<table class="t"><thead><tr><th>Firebreak</th><th class="r">Own</th><th class="r">Spared</th></tr></thead><tbody>
        ${H.fb.picks.map(p => `<tr class="pick" data-g="${p.g}"><td>${esc(D.label(p.g))}<small>${CLASS[b.class[p.g]]}</small></td><td class="r">${p.own.toFixed(2)}</td><td class="r">${p.spread.toFixed(2)}</td></tr>`).join('')}
      </tbody></table>
      <p class="note">Lazy greedy (CELF) over the ${H.fb.candidates} most active houses, ${H.fb.evals} scenarios scored with exact
        expected counts. Spared means reports prevented at other houses.</p>` : ''}
      ${r.withS ? `<div class="kpis">${kpi(r.prevented.toFixed(1), 'fewer reports in 700 m', 'simulated, 90 days')}${kpi(kusd(r.protectedUsd), 'neighbour value protected', '0.9% per distressed house within 200 m')}</div>` : ''}
      <p class="note">Stabilize means the house stops producing reports and its past reports stop pushing on neighbours:
        repairs, a code fix, or a purchase and rehab. Homesteads get repair help first.</p>
    </div>`}`;
  $('h-close').onclick = a.close;
  if (!r) return;
  $('stab').onclick = a.toggle;
  $('fb').onclick = a.firebreaks;
  if ($('clear')) $('clear').onclick = a.clear;
  $('panel').querySelectorAll('tr[data-g]').forEach(tr => { tr.onclick = () => a.fly(+tr.dataset.g); });
}

// ---------- 4. Act ----------

export const DEFAULT_COSTS = { home: 15000, multifamily: 20000, commercial: 20000 };

export function renderAct(D, S, h) {
  const sub = S.act;
  const tabs = `<div class="chips" id="act-sub">${[['plan', 'Budget plan'], ['brief', 'District brief'], ['portfolio', 'Portfolio'], ['investor', 'Acquisition leads']]
    .map(([k, t]) => `<button class="chip ${sub === k ? 'on' : ''}" data-k="${k}">${t}</button>`).join('')}</div>`;
  let body = '';
  if (sub === 'plan') {
    const P = S.plan;
    body = `
      <div class="pane">
        <div class="sec-h"><h3>Budget</h3><small>${kusd(P.budget)}</small></div>
        <div class="field"><input id="budget" type="range" min="50000" max="3000000" step="50000" value="${P.budget}" aria-label="Budget" /></div>
        <div class="sec"><div class="sec-h"><h3>Cost per intervention</h3><small>placeholders, edit to match your program</small></div>
          ${Object.entries(P.costs).map(([k, v]) => `<label class="inline" style="justify-content:space-between;font-size:12px">
            <span class="t2">${k === 'home' ? 'Home: repair grant (city range $10K–$20K)' : k === 'multifamily' ? 'Multifamily: common-area repair order' : 'Commercial: repair order and owner outreach'}</span>
            <input class="num-in" data-cost="${k}" type="number" min="100" step="100" value="${v}" /></label>`).join('')}</div>
        <div class="kpis">
          ${kpi(num(P.result.n), 'buildings in the plan', `${kusd(P.result.spent)} of ${kusd(P.budget)}`)}
          ${kpi(P.result.reports.toFixed(0), 'reports prevented, 90 days', `${P.result.spared.toFixed(0)} of them at neighbours`)}
          ${kpi(kusd(P.result.protected), 'home value protected nearby', '0.9% of homes within 200 m per case avoided')}
          ${kpi(kusd(P.result.spent / Math.max(P.result.reports, 1e-9)), 'cost per report prevented', 'first order, before cascades')}
        </div>
        <div class="tw"><table class="t"><thead><tr><th>Building</th><th class="r">Own</th><th class="r">Spared</th><th class="r">Per $100K</th></tr></thead><tbody>
          ${P.result.rows.slice(0, 25).map(r => `<tr class="pick" data-b="${r.i}"><td>${esc(D.label(r.i))}<small>${CLASS[r.cls]} · ${kusd(r.cost)} · district ${D.b.district?.[r.i] || '—'}</small></td>
            <td class="r">${r.own.toFixed(2)}</td><td class="r">${r.spare.toFixed(2)}</td><td class="r">${(r.ratio * 1e5).toFixed(1)}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="inline"><button class="btn" id="plan-csv">Export work orders (CSV)</button></div>
        ${holdHtml(S.planApproved ? 'Plan approved · queued for a human to send' : 'Hold to approve this plan', S.planApproved)}
        <p class="note">Ranked by reports prevented per dollar: the building's own chance of a report plus the reports it
          would set off at other houses (Hawkes, first order), divided by its cost. Ranking by property value would send
          the budget to the richest blocks, so value is reported, not optimised: 0.9% of single-family home value within
          200 m per case avoided (Immergluck & Smith 2006). Per $100K: reports prevented for every $100,000 spent.
          Nothing is sent from here.</p>
      </div>`;
  } else if (sub === 'brief' && S.brief) {
    const B = S.brief.B, f = B.fair;
    const districts = (D.meta.audit?.fairness?.districts || []).map(x => x.district);
    body = `
      <div class="pane">
        <p>The same engine cut to one council office: what is happening in its district, what comes next, and the ten
          actions that prevent the most reports per dollar. Generated from the pipeline; copy it into an email or a
          council memo.</p>
        <div class="inline"><select id="district" class="btn" aria-label="Council district">${districts.map(d => `<option value="${d}" ${d === B.d ? 'selected' : ''}>Council District ${d}</option>`).join('')}</select>
          <button class="btn primary" id="brief-copy">Copy brief</button></div>
        <div class="kpis">
          ${kpi(num(B.r30), 'property reports, last 30 days', `${pct(B.r30 / Math.max(B.r30city, 1), 1)} of the city · ${num(B.n)} buildings`)}
          ${kpi(num(Math.round(B.exp)), 'new reports expected, 90 days', 'sum of each building\'s risk')}
          ${kpi(B.r ? B.r.v.toFixed(2) : '—', `spread rate R${B.r ? ', ' + B.r.month : ''}`, B.r ? `each problem becomes ${(1 / (1 - B.r.v)).toFixed(2)} reports` : '')}
          ${kpi(f ? f.recall_ratio.toFixed(2) + '<small>×</small>' : '—', 'model recall here vs city', f ? (f.under_served ? `under-served; ${B.fairAfter ? B.fairAfter.recall_ratio.toFixed(2) + '× after re-ranking' : ''}` : 'within the four-fifths rule') : '')}
        </div>
        <ul class="rows">
          <li><span>Certified high-risk buildings</span><b>${num(B.cert)}</b></li>
          <li><span>Emerging clusters in the district</span><b>${B.clusters.length ? B.clusters.map(({ k }) => '#' + (k + 1)).join(', ') : 'none'}</b></li>
          <li class="total"><span>Next 10 actions</span><b>${kusd(B.cost)} · ${B.prevented.toFixed(1)} reports prevented</b></li>
        </ul>
        <div class="tw"><table class="t"><thead><tr><th>#</th><th>Building</th><th class="r">Own</th><th class="r">Spared</th><th class="r">Cost</th></tr></thead><tbody>
          ${B.rows.map((r, k) => `<tr class="pick" data-b="${r.i}"><td>${k + 1}</td><td>${esc(D.label(r.i))}<small>${CLASS[r.cls]}</small></td>
            <td class="r">${pct(r.own)}</td><td class="r">${r.spare.toFixed(2)}</td><td class="r">${kusd(r.cost)}</td></tr>`).join('')}
        </tbody></table></div>
        <textarea id="brief-text" class="brief-text" readonly hidden>${esc(S.brief.text || '')}</textarea>
        <p class="note">Costs are the placeholders from the budget plan. Rankings use reports prevented per dollar, so a
          district's list does not depend on its property values.</p>
      </div>`;
  } else if (sub === 'portfolio') {
    const owners = D.search?.owners || [];
    const P = S.portfolio;
    body = `
      <div class="pane">
        <p>Pick a company portfolio. For each of its buildings: its own outlook and how much of it is pressure coming
          from neighbours it does not own. That pressure is the part a property manager cannot see from their own
          work orders.</p>
        <select id="owner" class="btn" style="width:100%;text-align:left">
          <option value="">Choose a portfolio (largest first)</option>
          ${D.ownerOrder.slice(0, 200).map(o => `<option value="${o}" ${P.owner === o ? 'selected' : ''}>${esc(owners[o - 1].label)} · ${owners[o - 1].buildings} buildings</option>`).join('')}
        </select>
        ${P.rows ? `<div class="kpis">
          ${kpi(num(P.rows.length), 'buildings in Dallas', '')}
          ${kpi(pct(P.inbound), 'of its 90-day risk comes from neighbours', 'Hawkes decomposition')}
        </div>
        <div class="tw"><table class="t"><thead><tr><th>Building</th><th class="r">Risk</th><th class="r">From neighbours</th></tr></thead><tbody>
          ${P.rows.slice(0, 40).map(r => `<tr class="pick" data-b="${r.i}"><td>${esc(D.label(r.i))}<small>${CLASS[D.b.class[r.i]]}</small></td>
            <td class="r">${pct(D.b.risk[r.i] / 255)}</td><td class="r">${r.nb.toFixed(2)} <small style="display:inline">(${pct(r.share)})</small></td></tr>`).join('')}
        </tbody></table></div>
        <p class="note">Open a building to see which outside houses push on it, and which firebreak would protect it.</p>` : ''}
      </div>`;
  } else {
    body = `<div class="pane" id="investor"></div>`;
  }
  $('panel').innerHTML = `
    <div class="pane">
      ${header('Act', 'plan, approve, export')}
      <p>Turn the forecast into a ranked list of next actions with a cost and an expected return, then approve it.</p>
      ${tabs}
    </div>${body}`;
  $('act-sub').onclick = ev => { const k = ev.target.closest('button')?.dataset.k; if (k) h.sub(k); };
  $('panel').querySelectorAll('tr[data-b]').forEach(tr => { tr.onclick = () => h.house(+tr.dataset.b); });
  if (sub === 'plan') {
    $('budget').oninput = ev => h.budget(+ev.target.value);
    $('panel').querySelectorAll('[data-cost]').forEach(el => { el.onchange = () => h.cost(el.dataset.cost, +el.value); });
    $('plan-csv').onclick = h.csv;
    wireHold($('panel').querySelector('.hold'), h.approve);
  } else if (sub === 'brief') {
    if ($('district')) $('district').onchange = ev => h.district(+ev.target.value);
    if ($('brief-copy')) $('brief-copy').onclick = ev => h.copyBrief(ev.currentTarget);
  } else if (sub === 'portfolio') {
    $('owner').onchange = ev => h.owner(+ev.target.value || null);
  } else {
    renderInvestor(D, S, h);
  }
}

function holdHtml(label, signed) {
  return `<button class="hold ${signed ? 'signed' : ''}"><span class="fill" style="width:${signed ? 100 : 0}%"></span><span class="label">${esc(label)}</span></button>`;
}
function wireHold(el, done, ms = 900) {
  if (!el || el.classList.contains('signed')) return;
  let t0 = 0, raf = 0;
  const fill = el.querySelector('.fill');
  const step = t => { const f = Math.min(1, (t - t0) / ms); fill.style.width = f * 100 + '%'; if (f >= 1) { done(); return; } raf = requestAnimationFrame(step); };
  el.addEventListener('pointerdown', ev => { ev.preventDefault(); t0 = performance.now(); raf = requestAnimationFrame(step); });
  const stop = () => { cancelAnimationFrame(raf); if (!el.classList.contains('signed')) fill.style.width = '0'; };
  el.addEventListener('pointerup', stop); el.addEventListener('pointerleave', stop);
  el.addEventListener('keydown', ev => { if (ev.key === 'Enter') done(); });
}

export const LIST_HEX = { first_spark: '#e69f00', code_stack: '#d55e00', tired_landlord: '#56b4e9', block_fire: '#cc79a7' };

function renderInvestor(D, S, h) {
  const el = $('investor');
  if (!D.lists) { el.innerHTML = '<div class="empty">No lists.json yet.</div>'; return; }
  const L = D.lists.lists.find(l => l.id === S.list) || D.lists.lists[0];
  const bt = L.backtest || {};
  el.innerHTML = `
    <p>For buyers who repair and resell: owners likely to sell before the block tips, ranked by the same spread
      signal. Owner-occupied homes are never listed; owner names stay in a private export.</p>
    <div class="chips" id="lists">${D.lists.lists.map(l => `<button class="chip ${l.id === L.id ? 'on' : ''}" data-l="${l.id}">${esc(l.title)}</button>`).join('')}</div>
    <p class="t2">${esc(L.pitch)} <span class="muted">${esc(L.rule)}</span></p>
    <div class="kpis">
      ${kpi(pct(bt.hit_rate || 0), `of top ${bt.top} got a report in 90 days`, `held-out ${D.lists.backtest_cutoff}`)}
      ${kpi((bt.rank_lift || 0).toFixed(1) + '<small>×</small>', 'better than the rule alone', `rule alone ${pct(bt.pool_rate || 0, 1)}`)}
    </div>
    <div class="tw"><table class="t"><thead><tr><th>House</th><th class="r">Risk</th><th class="r">Offer</th></tr></thead><tbody>
      ${L.leads.slice(0, 40).map((l, k) => `<tr class="pick" data-k="${k}"><td>${esc(shownAddr(l))}<small>${l.zip} · ${l.reports_365} reports · ${l.buyers_nearby} buyers nearby</small></td>
        <td class="r">${pct(l.risk)}</td><td class="r">${l.viable ? kusd(l.offer) : '—'}</td></tr>`).join('')}
    </tbody></table></div>`;
  $('lists').onclick = ev => { const id = ev.target.closest('button')?.dataset.l; if (id) h.list(id); };
  el.querySelectorAll('tr[data-k]').forEach(tr => { tr.onclick = () => h.lead(L.leads[+tr.dataset.k]); });
}

// ---------- 5. Evidence ----------

export function renderEvidence(D) {
  const { meta, hawkes: hk, evidence: ev, alarms } = D;
  const a = meta.audit, cl = ev?.closure;
  const lt = a?.lead_time?.rankings;
  const fb = a?.fairness, fa = a?.fairness_after_rerank;
  const under = r => r.districts.filter(d => d.under_served).map(d => d.district);
  const effRow = (name, e) => `<tr><td>${name}</td><td class="r">${e.effect_pct > 0 ? '+' : ''}${e.effect_pct}%</td><td class="r">${e.ci95_pct[0]}% to ${e.ci95_pct[1]}%</td></tr>`;
  $('panel').innerHTML = `
    <div class="pane">
      ${header('Evidence', 'model card')}
      <p>Every claim in the console, how it was tested, and where it fell short.</p>
    </div>
    <div class="pane">
      <h3>Data and joins</h3>
      <ul class="rows">
        <li><span>Buildings, owners, tenants</span><b>DCAD 2026 certified roll</b></li>
        <li><span>Distress and infrastructure reports</span><b>Dallas 311, ${num(meta.counts.reports)} property · ${num(meta.counts.infra_failures)} infra</b></li>
        <li><span>Buildings placed on the map</span><b>${num(meta.counts.buildings)}</b></li>
        <li><span>Business tenants linked</span><b>${num(meta.counts.tenants)}</b></li>
      </ul>
      <p class="note">No shared IDs across these systems: buildings are matched by normalised address, then by
        house-number interpolation along the street.</p>
    </div>
    <div class="pane">
      <h3>Prediction (held-out ${meta.backtest_cutoff})</h3>
      <ul class="rows">
        <li><span>Top 2,000 precision</span><b>${pct(meta.model.network.watch_precision, 1)} vs ${pct(meta.model.network.base_rate, 1)} base</b></li>
        <li><span>AUC, network vs own history</span><b>${meta.model.network.auc.toFixed(3)} vs ${meta.model.base.auc.toFixed(3)}</b></li>
        ${lt ? `<li><span>Cases reached before the first call (50 visits/day)</span><b>${num(lt.network.cases_reached_early)}, median ${lt.network.median_days_ahead} d early</b></li>
        <li><span>Same, ranking by last year's complaints</span><b>${num(lt.last_year_count.cases_reached_early)}</b></li>` : ''}
        ${ev ? `<li><span>Certified list, promised ≤10% wrong</span><b>${pct(ev.calibration.selection.city_q10.realised_fdr, 1)} wrong</b></li>` : ''}
      </ul>
    </div>
    ${hk ? `<div class="pane">
      <h3>Spread model (Hawkes, EM with stochastic declustering)</h3>
      <ul class="rows">
        <li><span>Held-out log-likelihood vs no-spread model</span><b>+${hk.fit.test_gain_nats_per_report.toFixed(2)} nats / report</b></li>
        ${hk.fit.residuals ? `<li><span>Time-rescaling residuals, KS distance (0 = perfect)</span><b>${hk.fit.residuals.ks_hawkes} vs ${hk.fit.residuals.ks_poisson} no-spread</b></li>` : ''}
        <li><span>Reports set off by a nearby earlier report</span><b>${pct(hk.fit.spread_share)}</b></li>
        <li><span>Distance scale · mean delay</span><b>${hk.params.sigma_m} m · ${hk.params.slow_delay_days} d</b></li>
        <li><span>Recovers planted parameters in a synthetic test</span><b>yes (tests/test_core.py)</b></li>
      </ul>
    </div>` : ''}
    ${fb ? `<div class="pane">
      <h3>Fairness by council district</h3>
      <ul class="rows">
        <li><span>Districts under 0.8× city recall (four-fifths rule)</span><b>${under(fb).length ? 'D' + under(fb).join(', D') : 'none'}</b></li>
        <li><span>After district-proportional re-ranking</span><b>${under(fa).length ? 'D' + under(fa).join(', D') : 'none'}</b></li>
        <li><span>Precision cost</span><b>${pct(fb.city_precision, 1)} → ${pct(fa.city_precision, 1)}</b></li>
      </ul>
      <p class="note">Dallas's camera program drew 68% of its citations in three districts. Firebreak audits itself
        by district before anyone acts on it, and the re-ranking uses no outcome labels, so it can run on the live list.</p>
    </div>` : ''}
    ${cl ? `<div class="pane">
      <h3>Does closing a case fast protect the neighbours?</h3>
      <p class="note">Natural experiment on ${num(cl.cases)} code cases: ${num(cl.fast_cases)} closed in 1–7 days vs ${num(cl.slow_cases)} open 30+ days.
        Outcome: new reports at other houses within 150 m, days 31–180, minus the 250–500 m ring. Inspector sweeps removed.</p>
      <table class="t"><thead><tr><th>Estimate</th><th class="r">Effect</th><th class="r">95% CI</th></tr></thead><tbody>
        ${effRow('Main', cl.main)}${effRow('Placebo: the 180 days before', cl.placebo_before_case)}${effRow('Placebo: pipe and street failures', cl.placebo_infrastructure)}
      </tbody></table>
      <p class="note"><b>Result: no effect beyond what was already there.</b> The before-period placebo shows the same gap, so
        fast-closed neighbourhoods differed before the case. Closing a ticket is not the same as fixing a house. That matches
        the Philadelphia trials: real repairs cut nearby gun violence 8–13%, trash clean-up alone did nothing. Firebreak's
        plans therefore recommend repairs and purchases, not faster ticket closure.</p>
    </div>` : ''}
    ${alarms ? `<div class="pane">
      <h3>Cluster alarms</h3>
      <ul class="rows">
        <li><span>Method</span><b>expectation-based Poisson, fast subset scan</b></li>
        <li><span>Top-3 clusters, reports over baseline next 60 d</span><b>${alarms.backtest.pooled_obs_over_exp_after}× (busiest cells ${alarms.backtest.control_pooled_obs_over_exp_after}×)</b></li>
      </ul>
    </div>` : ''}
    <div class="pane">
      <h3>Runs on any city</h3>
      <p class="note">The pipeline needs two inputs: a property roll with locations (any county appraisal district) and a
        time-stamped event log with coordinates. Dallas 311 comes from Socrata; more than 30 US cities publish the
        same kind of log through the Open311 GeoReport v2 standard. Swap the two loaders and every view, test and
        audit here reruns unchanged. Inside a single campus, the nodes become assets and the events become work
        orders and alarms.</p>
      <ul class="rows">
        <li><span>Full rebuild, 241,588 buildings, laptop</span><b>about 45 min</b></li>
        <li><span>One building simulated in the browser</span><b>400 futures, about 1 s</b></li>
        <li><span>Data shipped to the browser</span><b>${(D.meta.buildings_layout.reduce((a, c) => Math.max(a, c.offset + c.length * ({ float32: 4, uint32: 4, int32: 4, uint16: 2 }[c.dtype] || 1)), 0) / 1e6).toFixed(1)} MB of buildings</b></li>
      </ul>
    </div>
    <div class="pane">
      <h3>Limits</h3>
      <p class="note">311 measures what people report, not what exists, so quiet neighbourhoods can be under-counted. The
        dollar figures use published rates (Immergluck & Smith 2006; Q3 2026 DFW rents) and placeholder repair costs,
        all listed in meta.json. Guarantees assume the next quarter looks like the last one; we show where that broke.</p>
      <p class="note">Methods: Mohler et al. 2011; Wallinga & Teunis 2004; Neill 2012; Kulldorff 2001; Vovk & Petej 2014;
        Jin & Candès 2023; Kempe, Kleinberg & Tardos 2003; Leskovec et al. 2007; Butts 2023; Ogata 1988; Branas et al. 2018.</p>
    </div>`;
}

// ---------- detail: hotspot dossier and lead ----------

export function renderDossier(x, D, onClose) {
  const el = $('detail');
  const p = x.plan, uw = p.underwrite;
  const approved = store('fb-approved') || {};
  el.hidden = false;
  el.innerHTML = `<div class="pane">
    <div class="ph"><h2>${esc(x.name || shownAddr(x))}</h2><button class="close" id="d-close">Close (Esc)</button></div>
    <p class="t2">${x.asset_class}${x.building_type ? ' · ' + esc(x.building_type.toLowerCase()) : ''} · ${esc(shownAddr(x))}, ${x.zip}${x.year_built ? ` · built ${x.year_built}` : ''}${x.units ? ` · ${x.units} units` : ''}</p>
    <div class="kpis">
      ${kpi(pct(x.risk), 'chance of a new report, 90 days', `own history only ${pct(x.risk_base)}`)}
      ${kpi(kusd(x.usd.exposure), 'at stake if it spreads', `${kusd(x.usd.neighbor_value)} of homes within 200 m`)}
    </div>
    <ul class="rows">
      <li><span>Reports here</span><b>${x.history.last_90} in 90 d · ${x.history.last_365} in a year</b></li>
      <li><span>Next door (50 m, 30 d) · block (250 m, 90 d)</span><b>${x.block.reports_50m_30d} · ${x.block.reports_250m_90d}</b></li>
      <li><span>Owner</span><b>${x.owner.label ? esc(x.owner.label) : 'private owner'} · ${x.owner.buildings} buildings</b></li>
      <li><span>Value lost next door</span><b>${usd(x.usd.spillover)}</b></li>
      <li><span>Rent exposed${x.usd.rent_use ? ` (${x.usd.rent_use})` : ''}, ${x.usd.days_open ?? '—'} d open</span><b>${usd(x.usd.rent_at_risk)}</b></li>
      ${uw ? `<li><span>Rescue math: offer · repairs · ARV</span><b>${kusd(uw.offer)} · ${kusd(uw.repairs)} · ${kusd(uw.arv)}</b></li>` : ''}
    </ul>
    <h3>Response plan</h3>
    <table class="t"><tbody>${p.steps.map(s => `<tr><td style="width:72px" class="t2">${esc(s.crew)}</td><td>${esc(s.do)}</td><td class="r">${s.cost ? usd(s.cost) : ''}</td></tr>`).join('')}</tbody></table>
    <div class="inline"><button class="btn" id="d-sim">Simulate this building</button></div>
    ${holdHtml(approved[x.parcel_id] ? 'Approved · queued for a human to send' : 'Hold to approve the plan', approved[x.parcel_id])}
    <p class="note">Approval is stored in this browser only. Nothing is emailed, mailed or called from Firebreak.</p>
  </div>`;
  $('d-close').onclick = () => { el.hidden = true; onClose(); };
  $('d-sim').onclick = () => onClose(x.i);
  wireHold(el.querySelector('.hold'), () => {
    approved[x.parcel_id] = new Date().toISOString(); store('fb-approved', approved);
    const btn = el.querySelector('.hold'); btn.classList.add('signed'); btn.querySelector('.label').textContent = 'Approved · queued for a human to send';
  });
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function renderLead(l, D, onClose) {
  const el = $('detail');
  const queued = store('fb-queued') || {};
  el.hidden = false;
  el.innerHTML = `<div class="pane">
    <div class="ph"><h2>${esc(shownAddr(l))}</h2><button class="close" id="d-close">Close (Esc)</button></div>
    <p class="t2">${l.asset_class} · Dallas ${l.zip}${l.year_built ? ` · built ${l.year_built}` : ''}</p>
    <div class="kpis">${kpi(pct(l.risk), 'chance of a new report, 90 days', '')}${kpi(pct(l.p_two_buyers), 'chance 2 repeat buyers want it', `${l.buyers_nearby} nearby`)}</div>
    <ul class="rows">
      <li><span>Reports here · next door · block</span><b>${l.reports_365} · ${l.next_door_30d} · ${l.block_90d}</b></li>
      <li><span>Owner</span><b>${l.owner.label ? esc(l.owner.label) : 'private owner'} · ${l.owner.buildings} buildings${l.owner.out_of_state ? ' · out of state' : ''}</b></li>
      <li><span>After-repair value · repairs</span><b>${usd(l.arv)} · ${usd(l.repairs)}</b></li>
      <li><span>Offer at 70% rule</span><b>${usd(l.offer)}</b></li>
      <li class="total"><span>Assignment fee</span><b>${l.viable ? usd(l.fee) : 'does not pencil'}</b></li>
    </ul>
    ${holdHtml(queued[l.parcel_id] ? 'Queued · a human sends' : 'Hold to queue for outreach', queued[l.parcel_id])}
    <p class="note">Owner names and mailing addresses never leave the private export. Nothing is mailed from here.</p>
  </div>`;
  $('d-close').onclick = () => { el.hidden = true; onClose(); };
  wireHold(el.querySelector('.hold'), () => {
    queued[l.parcel_id] = new Date().toISOString(); store('fb-queued', queued);
    const btn = el.querySelector('.hold'); btn.classList.add('signed'); btn.querySelector('.label').textContent = 'Queued · a human sends';
  });
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- legend ----------

export function renderLegend(view, S, D) {
  const ramp = `<div class="ramp" style="background:linear-gradient(90deg,${HEAT.join(',')})"></div>`;
  const src = `<div class="src">Dallas 311 · DCAD 2026 · as of ${D.meta.as_of}</div>`;
  const kinds = [0, 1, 2, 4, 5].map(k => `<div class="row"><i class="sw dot" style="background:${KIND_HEX[k]}"></i>${KIND_NAME[k]}</div>`).join('');
  const html = {
    detect: `<h4>311 property reports, last 60 days</h4>${ramp}<div class="breaks"><span>sparse</span><span>report density</span><span>dense</span></div><div style="height:6px"></div>${kinds}<div class="row"><i class="sw" style="border:1.5px solid #fcffa4"></i>emerging cluster (150 m cells)</div>`,
    predict: S.predict === 'proof'
      ? `<h4>Backtest from ${D.meta.backtest_cutoff}</h4><div class="row"><i class="sw" style="background:var(--open)"></i>flagged, no report yet</div><div class="row"><i class="sw" style="background:var(--hit)"></i>flagged, report landed</div>`
      : S.predict === 'certified'
        ? `<h4>Certified list</h4><div class="row"><i class="sw dot" style="background:#8ab4ff"></i>certified: ≤10% expected wrong</div><div class="row"><i class="sw" style="background:#fca50a"></i>top priority interventions</div>`
        : `<h4>Expected new reports, 90 days</h4>${ramp}<div class="breaks"><span>fewer</span><span>per 260 m hex</span><span>more</span></div><div class="row" style="margin-top:6px"><i class="sw" style="background:#fca50a"></i>priority intervention</div>`,
    simulate: `<h4>Chance of a report by the slider date</h4>${ramp}<div class="breaks"><span>0%</span><span>20%</span><span>40%+</span></div>
      <div class="row" style="margin-top:6px"><i class="sw" style="background:var(--stab)"></i>stabilized</div><div class="row"><i class="sw" style="background:#fca50a;height:2px"></i>trigger arc: earlier report → the report it set off</div>`,
    act: S.act === 'plan'
      ? `<h4>Budget plan</h4><div class="row"><i class="sw dot" style="background:#fca50a"></i>home in the plan</div><div class="row"><i class="sw dot" style="background:#8ab4ff"></i>apartment or commercial building</div><div class="breaks" style="margin-top:4px"><span>size: home value protected nearby</span></div>`
      : S.act === 'brief'
        ? `<h4>District brief</h4><div class="row"><i class="sw dot" style="background:#fca50a"></i>next 10 actions, numbered by rank</div>`
        : S.act === 'portfolio'
          ? `<h4>Portfolio buildings</h4>${ramp}<div class="breaks"><span>own risk</span><span>share from neighbours</span><span>outside risk</span></div><div class="row" style="margin-top:4px">size: 90-day risk</div>`
          : `<h4>Acquisition leads</h4><div class="row"><i class="sw dot" style="background:#e69f00"></i>lead on the selected list</div>`,
    evidence: `<h4>Recall by council district</h4>${ramp}<div class="breaks"><span>under-served</span><span>city</span><span>over-served</span></div>`,
  }[view];
  $('legend').innerHTML = html + src;
}
