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

// Distress Factor: the 90-day chance of a new property report on a fixed 1-10 scale, read the way a
// First Street Flood Factor is read. The cut points are absolute probabilities, not ranks, so a score
// means the same thing in every district and every month.
export const FACTOR_CUTS = [0.01, 0.02, 0.04, 0.07, 0.11, 0.17, 0.25, 0.40, 0.60];
export const factorOf = p => 1 + FACTOR_CUTS.filter(c => p >= c).length;
export const factorWord = f => (f <= 2 ? 'Minimal' : f <= 4 ? 'Minor' : f <= 6 ? 'Moderate' : f <= 8 ? 'Major' : f === 9 ? 'Severe' : 'Extreme');
export function factorMeter(p, big = true) {
  const f = factorOf(p);
  return `<div class="factor ${big ? 'big' : ''}"><div class="f-num"><b>${f}</b><span>/10</span></div>
    <div class="f-body"><div class="f-word">${factorWord(f)} distress risk</div>
    <div class="f-seg">${Array.from({ length: 10 }, (_, k) => `<i style="${k < f ? `background:${HEAT[Math.min(4, Math.floor(k / 2))]}` : ''}"></i>`).join('')}</div>
    <div class="f-cap">Distress Factor · ${pct(p)} chance of a new report in 90 days</div></div></div>`;
}

// Two years of reports at one building, by week, coloured by the most serious kind that week.
function timeline(D, i) {
  const { e, m, meta } = D, weeks = 105, cells = new Array(weeks).fill(null);
  let n = 0;
  for (let j = 0; j < m; j++) {
    if (e.b[j] !== i || e.kind[j] === 6) continue;
    n++;
    const w = Math.min(weeks - 1, Math.floor(e.day[j] / 7));
    cells[w] = cells[w] === null ? e.kind[j] : cells[w];
  }
  if (!n) return '<p class="note">No property reports at this building in the last two years.</p>';
  return `<div class="tl" style="grid-template-columns:repeat(${weeks},1fr)">${cells.map(k => `<i style="${k === null ? '' : `background:${KIND_HEX[k]}`}"></i>`).join('')}</div>
    <div class="tl-ax"><span>${meta.events_start.slice(0, 7)}</span><span>${n} report${n === 1 ? '' : 's'}, by week</span><span>${meta.as_of.slice(0, 7)}</span></div>`;
}

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
    ${watchPane(D, S, live)}
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
      ${S.alarm !== null ? `<button class="btn primary pb-go" id="pb-run">Run the resolution playbook on cluster ${S.alarm + 1}</button>` : `<p class="note pb-hint">Select a cluster to run the resolution playbook on it (or press <kbd>R</kbd> for the strongest).</p>`}
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
      <div class="net-toggle ${S.network ? 'on' : ''}" id="net-toggle" role="switch" aria-checked="${S.network}" tabindex="0">
        <span class="sw-track"><i></i></span><span><b>Show the hidden network</b><small>${S.network && D.ownerNet ? `${num(D.ownerNet.links)} buildings share an owner with one of this year's reports (${num(D.ownerNet.owners)} portfolios). Showing the ${num(D.ownerNet.arcs.length)} riskiest links.` : 'arcs from every building with a report to the same owner\'s other buildings'}</small></span></div>
      <div class="claim">"Commercial property networks are too fragmented to detect hidden dependencies."</div>
      <div>${edges.map(([k, e]) => `<div class="edge"><span>${k === 'block' ? 'Next door' : k === 'owner' ? 'Same owner' : 'Pipes and streets'}</span>
        <b class="${e.ratio >= 1.1 ? 'yes' : 'no'}">${e.ratio.toFixed(2)}×</b><small>${esc(e.edge)}. ${num(e.exposed_buildings)} buildings with no prior report, 4 test periods.</small></div>`).join('')}</div>
      <p class="note">Two of three hidden links are real and measurable on buildings that had never had a report. Pipes
        and streets are not, and saying so is part of the answer.</p>
    </div>`;
  $('panel').querySelectorAll('tr[data-a]').forEach(tr => { tr.onclick = () => h.alarm(+tr.dataset.a); });
  const pb = $('pb-run'); if (pb) pb.onclick = () => h.playbook(S.alarm);
  const nt = $('net-toggle'); if (nt) { nt.onclick = h.network; nt.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); h.network(); } }; }
  $('panel').querySelectorAll('tr[data-b]').forEach(tr => { tr.onclick = () => h.house(+tr.dataset.b); });
  $('panel').querySelectorAll('tr[data-w]').forEach(tr => { tr.onclick = ev => { const u = ev.target.closest('[data-unw]'); if (u) { ev.stopPropagation(); h.unwatch(+u.dataset.unw); } else h.house(+tr.dataset.w); }; });
}

function watchPane(D, S, live) {
  const W = S.watch || [];
  if (!W.length) return `<div class="pane"><div class="sec-h"><h3>Watchlist</h3><small>kept in this browser</small></div>
    <p class="note">Open any building and press Follow. Followed buildings are ringed on the map, and new 311 reports at or near them show up here first.</p></div>`;
  const hits = W.filter(w => w.liveN || w.live > 0.001).length;
  return `<div class="pane">
    <div class="sec-h"><h3>Watchlist</h3><small>${num(W.length)} followed${live.status === 'on' ? ` · <b class="${hits ? 'hot' : ''}">${num(hits)} touched ${live.mode === 'live' ? 'since the snapshot' : 'in the last 48 h'}</b>` : ''}</small></div>
    <div class="tw"><table class="t watch"><thead><tr><th>Building</th><th class="r">Factor</th><th class="r">30 d</th><th class="r">Live</th><th></th></tr></thead><tbody>
    ${W.map(w => `<tr class="pick ${w.liveN || w.live > 0.001 ? 'flag' : ''}" data-w="${w.i}"><td>${esc(D.label(w.i))}<small>${w.lastDate ? `last report ${w.lastDate}` : 'no report in the last year'} · since ${esc(w.at)}</small></td>
      <td class="r">${factorOf(D.b.risk[w.i] / 255)}</td><td class="r">${w.n30 || '—'}</td>
      <td class="r">${w.liveN ? `${w.liveN} new` : w.live > 0.001 ? `+${w.live.toFixed(3)}` : '—'}</td>
      <td class="r"><button class="x" data-unw="${w.i}" aria-label="Unfollow">×</button></td></tr>`).join('')}
    </tbody></table></div>
    <p class="note">Factor: Distress Factor today. 30 d: reports in the last 30 days. Live: new reports at the building, or expected extra reports over 90 days from new reports nearby.</p></div>`;
}

function rootPane(D, H) {
  const rc = H.rc; if (!rc) return '';
  const head = '<div class="sec-h"><h3>Root cause</h3><small>most likely chain of reports, Hawkes branching</small></div>';
  if (rc.none) return `<div class="pane">${head}<p class="note">No property report here in the last year, so there is nothing to trace.</p></div>`;
  const st = rc.steps, here = st[st.length - 1];
  if (st.length === 1 && st[0].n === 1) return `<div class="pane">${head}<p class="note">Its latest report (${esc(here.kind)}, ${esc(here.date)}) is best explained by the
    building's own background rate (${pct(rc.originBg)}), not by an earlier report nearby. <b>This building is an origin.</b>
    ${rc.kids ? `Since then that report has most likely set off ${rc.kids} more within ${D.hawkes.params.radius_m} m.` : ''}</p></div>`;
  return `<div class="pane">${head}
    <ol class="chain">${st.map((s, k) => `<li class="${k === 0 ? 'origin' : ''} ${s.g === H.i ? 'here' : 'pick'}" ${s.g !== H.i && s.g >= 0 ? `data-g="${s.g}"` : ''}>
      <span class="dot"></span><div><b>${k === 0 ? 'Origin · ' : ''}${s.g === H.i ? 'This building' : esc(s.g >= 0 ? D.label(s.g) : 'unplaced report')}</b>
      <small>${s.n > 1 ? `${s.n} reports, ${esc(s.date)} to ${esc(s.lastDate)}` : `${esc(s.kind)} report, ${esc(s.date)}`}</small></div>
      ${k < st.length - 1 ? `<em>${pct(s.p)}</em>` : ''}</li>`).join('')}</ol>
    <p class="note">Each percentage is the chance that link set off the next one, against every other report within
      ${D.hawkes.params.radius_m} m and the background rate. Whole chain: ${pct(rc.prob)}. The origin has most likely set off
      ${rc.kids} report${rc.kids === 1 ? '' : 's'} so far. Fixing the origin is how you stop the next link.</p></div>`;
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
      <div class="chips" id="sub">${[['forecast', 'Forecast'], ['proof', 'Backtest'], ['certified', 'Certified list'], ...(D.falcon ? [['neural', 'Neural field']] : [])].map(([k, t]) =>
        `<button class="chip ${S.predict === k ? 'on' : ''}" data-k="${k}">${t}</button>`).join('')}</div>
      <div class="kpis">
        ${kpi(pct(net.watch_precision), `of top ${num(net.watch_list)} got a report`, `held-out ${meta.backtest_cutoff} · base rate ${pct(net.base_rate, 1)}`)}
        ${kpi(net.watch_lift.toFixed(1) + '<small>×</small>', 'lift over base rate', `AUC ${net.auc.toFixed(3)} (own history only ${base.auc.toFixed(3)})`)}
        ${live ? kpi(num(live.certified), 'certified buildings today', `at most ${pct(live.q)} expected wrong`) : ''}
        ${q10 ? kpi(pct(q10.realised_fdr, 1), 'wrong on the certified list', `promised ≤ ${pct(q10.q)} · held-out ${evidence.calibration.test_on}`) : ''}
      </div>
    </div>
    ${S.predict === 'neural' && D.falcon ? neuralPane(D, S) : ''}
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
  $('panel').querySelectorAll('tr[data-fc]').forEach(tr => { tr.onclick = () => h.falconCell(+tr.dataset.fc); });
  const cr = $('crews'); if (cr) cr.onclick = h.crews;
}

function crewTable(cs) {
  const name = { falcon: 'FALCON belief, quiet cells', boosted_quiet_cells: 'Boosted model, quiet cells', boosted_sum: 'Boosted model, all cells', last_365_days: "Last year's hotspots", random_walk: 'Random walk' };
  const keys = ['falcon', 'boosted_quiet_cells', 'boosted_sum', 'last_365_days', 'random_walk'].filter(k => cs[k]);
  const best = keys.slice().sort((x, y) => cs[y].ignitions_found - cs[x].ignitions_found)[0];
  const quiet = cs.boosted_quiet_cells ? Math.max(cs.falcon.ignitions_found, cs.boosted_quiet_cells.ignitions_found) : cs.falcon.ignitions_found;
  const patrol = cs.last_365_days?.ignitions_found;
  return `<div class="tw"><table class="t"><thead><tr><th>Crews follow</th><th class="r">Ignitions found</th><th class="r">Reports found</th></tr></thead><tbody>
    ${keys.map(k => `<tr class="${k === best ? 'hl' : ''}"><td>${name[k]}</td><td class="r">${cs[k].ignitions_found}</td><td class="r">${num(cs[k].reports_found)}</td></tr>`).join('')}
  </tbody></table></div>
  <p class="note">Backtest: ${cs.crews} crews, ${cs.steps_per_crew} cells each, on the day after the cutoff. Found means the
    inspected cell went on to ignite (or to get reports) in the next 90 days.${patrol ? ` Aiming the search at quiet cells finds
    ${(quiet / patrol).toFixed(1)}× the new ignitions of patrolling last year's hotspots, which find more reports because they revisit known trouble.` : ''}
    Most ignitions found: <b>${name[best]}</b>.</p>`;
}

function neuralPane(D, S) {
  const F = D.falcon, bt = F.backtest, c1 = bt.capture_top_1pct, c5 = bt.capture_top_5pct, ig = bt.ignition;
  const p1 = ig.precision_top_100, p5 = ig.precision_top_500;
  const name = { falcon: 'FALCON neural field', boosted_sum: 'Boosted model, summed per cell', last_365_days: 'Last year\'s reports', last_90_days: 'Last 90 days', buildings: 'Building count' };
  const row = k => `<tr class="${k === 'falcon' ? 'hl' : ''}"><td>${name[k]}</td><td class="r">${c1[k] !== undefined ? pct(c1[k], 1) : '—'}</td><td class="r">${c5[k] !== undefined ? pct(c5[k], 1) : '—'}</td><td class="r">${p1[k] !== undefined ? pct(p1[k]) : '—'}</td></tr>`;
  const best1 = Object.entries(c1).sort((x, y) => y[1] - x[1])[0][0], bestIg = Object.entries(p1).sort((x, y) => y[1] - x[1])[0][0];
  const curve = F.training_log.map(r => r.val_poisson);
  return `<div class="pane">
      <div class="sec-h"><h3>FALCON neural field</h3><small>ST-MotionNet, retrained on Dallas</small></div>
      <p class="t2">FALCON rebuilds a hidden signal field from sparse, fixed sensors. Here the field is property distress,
        the sensors are buildings, and a reading only arrives when someone calls 311. The network sees ${F.model.frames} weekly
        frames of a ${F.grid} × ${F.grid} grid (${Math.round(F.cell_m)} m cells) and forecasts the next 90 days for every cell,
        including the ones nobody has called about.</p>
      <div class="kpis">
        ${kpi(num(F.expected_reports_90d), 'reports expected, next 90 days', 'sum of the field, today')}
        ${kpi(pct(c1.falcon, 1), 'of next-quarter reports in its top 1% of cells', `held-out ${F.cutoff}`)}
        ${kpi(pct(p1.falcon), 'of its top 100 ignitions came true', `base rate ${pct(ig.base_rate)}`)}
      </div>
      <div class="legend-inline"><span><i class="sq heatsq"></i>expected reports</span><span><i class="ring blue"></i>likely ignition</span><span><i class="ring white"></i>blind spot</span></div>
    </div>
    <div class="pane">
      <div class="sec-h"><h3>Head to head, held-out quarter</h3><small>frozen ${F.cutoff}, scored on the next 90 days</small></div>
      <div class="tw"><table class="t"><thead><tr><th>Ranking</th><th class="r">Top 1%</th><th class="r">Top 5%</th><th class="r">Ignition top 100</th></tr></thead><tbody>
        ${['falcon', 'boosted_sum', 'last_365_days', 'last_90_days'].map(row).join('')}
      </tbody></table></div>
      <p class="note">Top 1% and 5%: share of the next quarter's ${num(bt.reports_next_90)} reports that land in the best-ranked cells (of
        ${num(bt.cells_with_buildings)} with buildings). Ignition: cells with no report in the 90 days before the cutoff that then got 2 or more
        (${num(ig.ignited)} of ${num(ig.candidates)}). Best at finding where reports pile up: <b>${name[best1]}</b>. Best at
        calling new ignitions: <b>${name[bestIg]}</b>. We report it either way.</p>
      ${lineChart([{ values: curve, color: '#8ab4ff' }], { labels: F.training_log.map(r => 'ep ' + r.epoch), fmt: v => v.toFixed(3) })}
      <p class="note">Validation Poisson loss by epoch (8 held-back weeks before the cutoff picked the epoch; the test quarter was never used).</p>
    </div>
    <div class="pane">
      <div class="sec-h"><h3>Where it expects a new hotspot</h3><small>localization head, today; scores rank cells, they are not calibrated chances</small></div>
      <div class="tw"><table class="t"><thead><tr><th>Near</th><th class="r">Score</th><th class="r">90-day field</th></tr></thead><tbody>
        ${F.igniteTop.slice(0, 10).map(k => `<tr class="pick" data-fc="${k}"><td>${esc(F.near[k] || 'unplaced cell')}<small>quiet for 90 days</small></td><td class="r">${pct(F.ignite[k])}</td><td class="r">${F.rate[k].toFixed(1)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="sec-h" style="margin-top:12px"><h3>Blind spots</h3><small>expected to report, silent for 12 weeks</small></div>
      <div class="tw"><table class="t"><thead><tr><th>Near</th><th class="r">Expected</th></tr></thead><tbody>
        ${F.blindTop.slice(0, 8).map(k => `<tr class="pick" data-fc="${k}"><td>${esc(F.near[k] || 'unplaced cell')}</td><td class="r">${F.rate[k].toFixed(1)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="sec-h" style="margin-top:12px"><h3>Send crews to find them</h3><small>FALCON search, greedy policy</small></div>
      <button class="btn ${S.crews ? '' : 'primary'}" id="crews">${S.crews ? 'Clear crew routes' : 'Dispatch 4 crews, 150 cells each'}</button>
      ${S.crews ? `<div class="kpis">${kpi(num(S.crews.cells), 'cells inspected', `${S.crews.km.toFixed(0)} km walked in total`)}${kpi(S.crews.ign.toFixed(0), 'ignition score covered', `uncalibrated focal-loss score · ${S.crews.rate.toFixed(0)} expected reports`)}</div>` : ''}
      ${F.backtest.crew_search ? crewTable(F.backtest.crew_search) : ''}
      <p class="note">FALCON's agents hunt for a source with the predictor's belief; here the hunters are inspection crews. Each
        crew steps to the neighbouring cell with the most unvisited belief nearby, and visited cells drop to zero so crews fan
        out. That is the team reward FALCON's VDN agents learn, chosen greedily here: the agents were not retrained on Dallas.</p>
    </div>`;
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
      <div class="ph"><h2>${esc(title)}</h2><span class="ph-btns"><button class="btn follow ${a.watching(i) ? 'on' : ''}" id="h-watch" aria-pressed="${a.watching(i)}">${a.watching(i) ? 'Following' : 'Follow'}</button><button class="close" id="h-close" title="Back to overview (Esc)">Back</button></span></div>
      <p class="t2">${CLASS[b.class[i]]} · council district ${b.district?.[i] || '—'} · DCAD value ${kusd(b.value[i])} ·
        ${b.reports_365[i]} reports in the last year</p>
      ${factorMeter(b.risk[i] / 255)}
      ${timeline(D, i)}
      <div class="kpis">
        ${kpi(pct(b.risk[i] / 255), 'boosted-model 90-day risk', b.risk_lo ? `calibrated ${pct(b.risk_lo[i] / 255)}–${pct(b.risk_hi[i] / 255)}${b.certified?.[i] ? ' · certified' : ''}` : '')}
        ${r ? kpi(stab ? '0%' : pct(pWith ?? pBase), 'simulated chance of a report', pWith !== null && !stab ? `${pct(pBase)} with no firebreaks` : r.base.medianDay ? `median first day ${r.base.medianDay}` : '') : kpi('<span class="skel" style="display:block;width:60px"></span>', 'simulating', '')}
      </div>
    </div>
    ${rootPane(D, H)}
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
      <div class="sec-h"><h3>Who this building pushes on</h3><small>outbound, expected reports, 90 days</small></div>
      ${r.outbound?.length ? `<p class="note">Its own recent reports raise ${r.outbound.length} neighbours' odds by ${r.outboundTotal.toFixed(2)} expected reports in
        total (blue arcs). This is the part of the problem that is not its owner's alone.</p>
        <table class="t"><tbody>${r.outbound.slice(0, 5).map(o => `<tr class="pick" data-g="${o.g}"><td>${esc(D.label(o.g))}<small>${CLASS[b.class[o.g]]}</small></td><td class="r">+${o.v.toFixed(3)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="note">No recent reports here, so it is not pushing on anyone yet.</p>'}
    </div>
    <div class="pane">
      <div class="sec-h"><h3>Stress test</h3><small>what if this building gets hit today</small></div>
      <div class="inline"><span class="t2" style="font-size:12px">New code reports here today:</span>
        ${[0, 3, 10].map(n => `<button class="btn ${(H.shock || 0) === n ? 'primary' : ''}" data-shock="${n}">${n === 0 ? 'None' : '+' + n}</button>`).join('')}</div>
      ${r.shock ? `<div class="kpis">${kpi('+' + r.shock.extra.toFixed(1), 'extra reports within 700 m', `${r.shock.calmArea.toFixed(1)} expected without the shock`)}${kpi('+' + r.shock.neighbourOdds.toFixed(2), 'neighbours newly expected to get a report', 'sum of the rise in each one\'s 90-day odds')}</div>
        <p class="note">The shock spreads exactly like real reports in the fitted model: through this building first, then
          next door within ${D.hawkes.params.radius_m} m. Same random seeds with and without it, so the gap is the shock alone.</p>`
        : '<p class="note">Inject hypothetical reports and watch the cascade: the columns around it rise.</p>'}
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
  $('h-watch').onclick = () => a.watch(i);
  $('panel').querySelectorAll('.chain li[data-g]').forEach(li => { li.onclick = () => a.open(+li.dataset.g); });
  if (!r) return;
  $('stab').onclick = a.toggle;
  $('panel').querySelectorAll('[data-shock]').forEach(el => { el.onclick = () => a.shock(+el.dataset.shock); });
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
        ${P.frontier ? `<div class="sec"><div class="sec-h"><h3>What more money buys</h3><small>reports prevented, 90 days</small></div>${frontierChart(P.frontier, P.budget)}
          <p class="note">Each extra dollar buys less: the first buildings on the list are the best value. Where the curve flattens, more budget stops paying.</p></div>` : ''}
        <div class="inline"><button class="btn" id="plan-csv">Export work orders (CSV)</button><button class="btn" id="plan-geo">GeoJSON</button></div>
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
        ${S.route?.kind === 'inspect' ? routeHtml(D, S.route, 'Tomorrow\'s inspection route') : `<div class="inline"><span class="t2" style="font-size:12px">Plan a crew route through the top</span>
          ${[10, 20, 30].map(n => `<button class="btn" data-route="${n}">${n} stops</button>`).join('')}</div>`}
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
        ${P.pushers?.length ? `<div class="sec"><div class="sec-h"><h3>Defensive moves: buildings it does not own</h3><small>push on this portfolio, 90 days</small></div>
          <p class="note">These outside buildings' recent reports raise the odds at this owner's buildings (orange arcs). Fixing them, or
            buying them, protects the portfolio more than any repair on its own property. For a wholesaler, this owner is the natural buyer.</p>
          <div class="tw"><table class="t"><thead><tr><th>Outside building</th><th class="r">Hits</th><th class="r">Push</th></tr></thead><tbody>
          ${P.pushers.slice(0, 8).map(x => `<tr class="pick" data-b="${x.i}"><td>${esc(D.label(x.i))}<small>${CLASS[D.b.class[x.i]]} · Distress Factor ${factorOf(D.b.risk[x.i] / 255)}</small></td><td class="r">${x.n}</td><td class="r">+${x.v.toFixed(3)}</td></tr>`).join('')}
          </tbody></table></div></div>` : '<p class="note">No outside building has pushed on this portfolio in the last 180 days.</p>'}
        <div class="tw"><table class="t"><thead><tr><th>Building</th><th class="r">Risk</th><th class="r">From neighbours</th></tr></thead><tbody>
          ${P.rows.slice(0, 15).map(r => `<tr class="pick" data-b="${r.i}"><td>${esc(D.label(r.i))}<small>${CLASS[D.b.class[r.i]]}</small></td>
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
  queueMicrotask(() => {
    if ($('route-clear')) $('route-clear').onclick = h.clearRoute;
    $('panel').querySelectorAll('.stops li[data-b]').forEach(li => { li.onclick = () => h.house(+li.dataset.b); });
  });
  $('panel').querySelectorAll('tr[data-b]').forEach(tr => { tr.onclick = () => h.house(+tr.dataset.b); });
  if (sub === 'plan') {
    $('budget').oninput = ev => h.budget(+ev.target.value);
    $('panel').querySelectorAll('[data-cost]').forEach(el => { el.onchange = () => h.cost(el.dataset.cost, +el.value); });
    $('plan-csv').onclick = h.csv;
    $('plan-geo').onclick = h.geojson;
    wireHold($('panel').querySelector('.hold'), h.approve);
  } else if (sub === 'brief') {
    if ($('district')) $('district').onchange = ev => h.district(+ev.target.value);
    if ($('brief-copy')) $('brief-copy').onclick = ev => h.copyBrief(ev.currentTarget);
    $('panel').querySelectorAll('[data-route]').forEach(el => { el.onclick = () => h.route(+el.dataset.route); });
  } else if (sub === 'portfolio') {
    $('owner').onchange = ev => h.owner(+ev.target.value || null);
  } else {
    renderInvestor(D, S, h);
  }
}

function routeHtml(D, R, what) {
  const P = D.ROUTE;
  return `<div class="route-card">
    <div class="sec-h"><h3>${what}</h3><small>${R.order.length} stops</small></div>
    <div class="kpis">${kpi(R.km.toFixed(1) + '<small>km</small>', 'driving', `straight lines × ${P.detour} for roads`)}${kpi((R.minutes / 60).toFixed(1) + '<small>h</small>', 'on the road and at the door', `${P.kmh} km/h, ${P.minPerStop} min a stop (placeholders)`)}</div>
    <ol class="stops">${R.order.slice(0, 12).map(i => `<li data-b="${i}">${esc(D.label(i))}</li>`).join('')}${R.order.length > 12 ? `<li class="more">and ${R.order.length - 12} more</li>` : ''}</ol>
    <div class="inline"><a class="btn" href="${R.link}" target="_blank" rel="noopener">Open first 10 stops in Google Maps</a><button class="btn" id="route-clear">Clear route</button></div>
    <p class="note">Order: nearest neighbour, then 2-opt until no swap of two legs shortens the loop.</p></div>`;
}

// Budget curve: reports prevented as the budget grows, along the plan's own ranking.
function frontierChart(fr, budget) {
  const W = 368, H = 120, pad = { l: 34, r: 8, t: 8, b: 20 }, xmax = fr[fr.length - 1][0], ymax = fr[fr.length - 1][1];
  const x = v => pad.l + (W - pad.l - pad.r) * v / xmax, y = v => pad.t + (H - pad.t - pad.b) * (1 - v / ymax);
  const d = fr.map(([c, r], k) => `${k ? 'L' : 'M'}${x(c).toFixed(1)},${y(r).toFixed(1)}`).join('');
  let at = fr[0]; for (const pt of fr) if (pt[0] <= budget) at = pt;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Budget curve">
    ${[0, ymax / 2, ymax].map(t => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${t.toFixed(0)}</text>`).join('')}
    <path d="${d} L${x(xmax)},${y(0)} L${x(0)},${y(0)}Z" fill="rgba(252,165,10,.08)"/><path d="${d}" fill="none" stroke="#fca50a" stroke-width="1.5"/>
    <line x1="${x(budget)}" x2="${x(budget)}" y1="${pad.t}" y2="${H - pad.b}" stroke="#e7e7e9" stroke-dasharray="2 3"/>
    <circle cx="${x(at[0])}" cy="${y(at[1])}" r="3" fill="#e7e7e9"/>
    <text x="${pad.l}" y="${H - 4}">$0</text><text x="${W - pad.r}" y="${H - 4}" text-anchor="end">${kusd(xmax)} budget</text></svg>`;
}

function holdHtml(label, signed) {
  return `<button class="hold ${signed ? 'signed' : ''}"><span class="fill" style="width:${signed ? 100 : 0}%"></span><span class="label">${esc(label)}</span></button>`;
}
export function wireHold(el, done, ms = 900) {
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
  const rows = S.leadSort === 'efc' ? [...L.leads].map(l => [l, dealMath(l).efc]).sort((x, y) => y[1] - x[1]).map(x => x[0]) : L.leads;
  el.innerHTML = `
    <p>For buyers who repair and resell: owners likely to sell before the block tips, ranked by the same spread
      signal. Owner-occupied homes are never listed; owner names stay in a private export.</p>
    <div class="chips" id="lists">${D.lists.lists.map(l => `<button class="chip ${l.id === L.id ? 'on' : ''}" data-l="${l.id}">${esc(l.title)}</button>`).join('')}</div>
    <p class="t2">${esc(L.pitch)} <span class="muted">${esc(L.rule)}</span></p>
    <div class="kpis">
      ${kpi(pct(bt.hit_rate || 0), `of top ${bt.top} got a report in 90 days`, `held-out ${D.lists.backtest_cutoff}`)}
      ${kpi((bt.rank_lift || 0).toFixed(1) + '<small>×</small>', 'better than the rule alone', `rule alone ${pct(bt.pool_rate || 0, 1)}`)}
    </div>
    ${S.route?.kind === 'd4d' ? routeHtml(D, S.route, `Drive-for-dollars loop, ${S.route.zip}`) : `<div class="inline"><button class="btn" id="d4d">Plan a drive-for-dollars loop (densest zip)</button></div>`}
    <div class="inline sortby"><span class="t2">Rank by</span>
      <button class="chip ${S.leadSort !== 'efc' ? 'on' : ''}" data-s="risk">Distress signal</button>
      <button class="chip ${S.leadSort === 'efc' ? 'on' : ''}" data-s="efc">Expected fee (WHOLZR)</button></div>
    <div class="tw"><table class="t"><thead><tr><th>House</th><th class="r">Risk</th><th class="r">Offer</th><th class="r">Fee/contact</th></tr></thead><tbody>
      ${rows.slice(0, 40).map((l, k) => `<tr class="pick" data-k="${k}"><td>${esc(shownAddr(l))}<small>${l.zip} · ${l.reports_365} reports · ${l.buyers_nearby} buyers nearby</small></td>
        <td class="r">${pct(l.risk)}</td><td class="r">${l.viable ? kusd(l.offer) : '—'}</td><td class="r">${l.viable ? usd(dealMath(l).efc) : '—'}</td></tr>`).join('')}
    </tbody></table></div>`;
  $('lists').onclick = ev => { const id = ev.target.closest('button')?.dataset.l; if (id) h.list(id); };
  if ($('d4d')) $('d4d').onclick = h.d4d;
  el.querySelectorAll('tr[data-k]').forEach(tr => { tr.onclick = () => h.lead(rows[+tr.dataset.k]); });
  el.querySelectorAll('.sortby [data-s]').forEach(b => { b.onclick = () => h.leadSort(b.dataset.s); });
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
      <h3>How to read a Distress Factor</h3>
      <p class="note">A building's 90-day chance of a new property report, placed on a fixed 1-10 scale, the way a flood or fire
        factor is read. The cut points are absolute probabilities, so a 7 means the same thing in every district and month.</p>
      <div class="tw"><table class="t"><thead><tr><th>Factor</th>${Array.from({ length: 10 }, (_, k) => `<th class="r">${k + 1}</th>`).join('')}</tr></thead><tbody>
        <tr><td>From</td>${[0, ...FACTOR_CUTS].map(c => `<td class="r">${pct(c)}</td>`).join('')}</tr>
        <tr><td>Buildings</td>${D.factorCounts.map(n => `<td class="r">${n >= 1000 ? Math.round(n / 1000) + 'K' : n}</td>`).join('')}</tr>
      </tbody></table></div>
    </div>
    <div class="pane">
      <h3>Methods behind the planning tools</h3>
      <ul class="rows">
        <li><span>Budget plan</span><b>greedy by reports prevented per dollar</b></li>
        <li><span>Crew and drive-for-dollars routes</span><b>nearest neighbour + 2-opt</b></li>
        <li><span>Route time (placeholders)</span><b>${D.ROUTE.kmh} km/h · ×${D.ROUTE.detour} roads · ${D.ROUTE.minPerStop} min a stop</b></li>
        <li><span>Defensive moves, natural buyers</span><b>Hawkes neighbour kernel, ${D.hawkes?.params.sigma_m} m scale</b></li>
        <li><span>Stress test</span><b>shock reports enter the same cascade</b></li>
        <li><span>Root cause</span><b>Hawkes branching posterior, most likely parent, hop by hop (links under 15% stop the chain)</b></li>
        <li><span>Resolution playbook</span><b>fixed plan of the console's own tools, human approval at the end</b></li>
        <li><span>Deal desk (WHOLZR)</span><b>discount bands and accept formula from the WHOLZR engine; motivation weights and reply rate are placeholders</b></li>
        ${D.falcon ? `<li><span>Neural field (FALCON)</span><b>ST-MotionNet: CNN encoder, ${D.falcon.model.layers}-layer ConvLSTM with self-attention, Poisson + focal heads; ${D.falcon.model.train_frames} training weeks, best epoch by ${D.falcon.model.val_frames} validation weeks</b></li>
        <li><span>Crew search</span><b>greedy team search on the belief map (FALCON's agents not retrained)</b></li>` : ''}
      </ul>
    </div>
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
    ${factorMeter(x.risk, false)}
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

export function renderLead(l, D, onClose, buyersOf) {
  const buyers = buyersOf && l.i >= 0 ? buyersOf(l.i) : [];
  const el = $('detail');
  const queued = store('fb-queued') || {};
  el.hidden = false;
  el.innerHTML = `<div class="pane">
    <div class="ph"><h2>${esc(shownAddr(l))}</h2><button class="close" id="d-close">Close (Esc)</button></div>
    <p class="t2">${l.asset_class} · Dallas ${l.zip}${l.year_built ? ` · built ${l.year_built}` : ''}</p>
    ${factorMeter(l.risk, false)}
    <div class="kpis">${kpi(pct(l.risk), 'chance of a new report, 90 days', '')}${kpi(pct(l.p_two_buyers), 'chance 2 repeat buyers want it', `${l.buyers_nearby} nearby`)}</div>
    <ul class="rows">
      <li><span>Reports here · next door · block</span><b>${l.reports_365} · ${l.next_door_30d} · ${l.block_90d}</b></li>
      <li><span>Owner</span><b>${l.owner.label ? esc(l.owner.label) : 'private owner'} · ${l.owner.buildings} buildings${l.owner.out_of_state ? ' · out of state' : ''}</b></li>
    </ul>
    ${dealDesk(l)}
    <div class="sec"><div class="sec-h"><h3>Natural buyers next door</h3><small>portfolios inside its 250 m spread radius</small></div>
      ${buyers.length ? `<table class="t"><tbody>${buyers.map(x => `<tr><td>${esc(x.label)}<small>${x.n} of its ${x.total} buildings within 250 m · ${kusd(x.value)} exposed</small></td><td class="r">${x.w.toFixed(2)}</td></tr>`).join('')}</tbody></table>
        <p class="note">Ranked by the spread kernel (closer buildings count more). If this house tips, these owners lose the most, so they
          are the buyers most likely to pay to stop it. Company owners only.</p>` : '<p class="note">No company portfolio has buildings within 250 m.</p>'}
    </div>
    ${holdHtml(queued[l.parcel_id] ? 'Queued · a human sends' : 'Hold to queue for outreach', queued[l.parcel_id])}
    <p class="note">Owner names and mailing addresses never leave the private export. Nothing is mailed from here.</p>
  </div>`;
  $('d-close').onclick = () => { el.hidden = true; onClose(); };
  const tz = $('teaser-copy');
  if (tz) tz.onclick = async () => { try { await navigator.clipboard.writeText($('teaser').value); tz.textContent = 'Copied'; } catch { $('teaser').hidden = false; $('teaser').select(); } };
  wireHold(el.querySelector('.hold'), () => {
    queued[l.parcel_id] = new Date().toISOString(); store('fb-queued', queued);
    const btn = el.querySelector('.hold'); btn.classList.add('signed'); btn.querySelector('.label').textContent = 'Queued · a human sends';
  });
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- WHOLZR deal desk ----------
// The underwriting the WHOLZR engine runs on every lead (03_build/wholzr: underwriting.py, odds.py, hunt.py),
// applied to a Firebreak lead. Discount bands and the accept formula are WHOLZR's; the motivation weights
// and the reply rate are placeholders and say so.
const DISCOUNT_BANDS = [[0.05, 0.40], [0.12, 0.25], [0.20, 0.12], [0.30, 0.05], [1.0, 0.02]];   // odds.py
const BAND_LABEL = [[0.20, 'live'], [0.08, 'stretch'], [0, 'long shot']];                        // odds.py
const REPLY_RATE = 0.10;   // hunt.py AGENT_REPLY_RATE (listing-agent emails); placeholder for direct-to-owner mail
export function dealMath(l) {
  const margin = Math.max(0, l.arv - l.repairs - l.buyer_price);
  const discount = l.value > 0 ? Math.min(1, Math.max(0, 1 - l.offer / l.value)) : 1;
  const base = DISCOUNT_BANDS.find(([lim]) => discount <= lim)[1];
  const parts = [
    ['reports here, last year', 0.30, Math.min(1, l.reports_365 / 3)],
    ['block reports, 90 days', 0.25, Math.min(1, l.block_90d / 20)],
    ['absentee owner', 0.20, l.owner.absentee ? 1 : 0],
    ['out-of-state owner', 0.10, l.owner.out_of_state ? 1 : 0],
    ['Firebreak 90-day risk', 0.15, Math.min(1, l.risk / 0.4)],
  ];
  const M = parts.reduce((a, [, w, v]) => a + w * v, 0);
  const pAccept = Math.min(0.9, base * (0.6 + 0.8 * M));
  const band = BAND_LABEL.find(([lim]) => pAccept >= lim)[1];
  const efc = l.viable ? pAccept * REPLY_RATE * l.fee * (0.4 + 0.6 * l.p_two_buyers) : 0;
  return { margin, discount, base, parts, M, pAccept, band, efc };
}
function dealDesk(l) {
  const m = dealMath(l), w = v => Math.max(0, Math.min(100, v / l.arv * 100));
  const rows = [
    ['After-repair value', l.arv, 'arv'], ['Buyer margin', -m.margin, 'neg'], ['Repairs (placeholder tiers)', -l.repairs, 'neg'],
    ['Buyer pays (MAO)', l.buyer_price, 'sub'], ['Assignment fee', -l.fee, 'fee'], ['Offer to seller', l.offer, 'sub'],
  ];
  let run = 0;
  const bars = rows.map(([name, v, cls]) => {
    let left, width;
    if (cls === 'arv' || cls === 'sub') { left = 0; width = w(v); run = v; } else { run += v; left = w(run); width = w(-v); }
    return `<div class="wf ${cls}"><span>${name}</span><div class="wf-track"><i style="left:${left}%;width:${width}%"></i></div><b>${v < 0 ? '−' : ''}${usd(Math.abs(v))}</b></div>`;
  }).join('');
  const teaser = [`Off-market ${l.asset_class} in ${l.zip}${l.year_built ? `, built ${l.year_built}` : ''}${l.sqft ? `, ${Math.round(l.sqft).toLocaleString()} sf` : ''}.`,
    `ARV about ${usd(l.arv)}. Repairs about ${usd(l.repairs)} (estimate). Your price ${usd(l.buyer_price)}.`,
    `Address after a signed non-circumvention. Reply if it fits your buy box.`].join('\n');
  return `<div class="sec"><div class="sec-h"><h3>Deal desk</h3><small>WHOLZR underwriting</small></div>
    <div class="waterfall">${bars}</div>
    ${l.viable ? '' : '<p class="note">Does not pencil: the fee would push the offer below what this owner is likely to take.</p>'}
    <div class="kpis">${kpi(pct(m.discount), 'below the DCAD value', 'what the seller must accept')}${kpi(pct(m.pAccept), `seller-side odds · ${m.band}`, `band base ${pct(m.base)} × motivation`)}${kpi(usd(m.efc), 'expected fee per contact', 'odds × reply rate × fee × buyer demand')}</div>
    <ul class="rows mot">${m.parts.map(([n, wt, v]) => `<li><span>${n}</span><i class="mbar"><i style="width:${v * 100}%"></i></i><b>${(wt * v).toFixed(2)}</b></li>`).join('')}
      <li class="total"><span>Motivation M</span><b>${m.M.toFixed(2)}</b></li></ul>
    <p class="note">Discount bands and the accept formula (base × (0.6 + 0.8 M), capped at 90%) come from the WHOLZR engine.
      Motivation weights and the ${pct(REPLY_RATE)} reply rate are placeholders. A deal only pays when two buyers say yes:
      ${pct(l.p_two_buyers)} here, from ${l.buyers_nearby} repeat buyers nearby.</p>
    <div class="sec-h" style="margin-top:10px"><h3>Buyer teaser</h3><small>no address until a non-circumvention</small></div>
    <textarea id="teaser" class="brief-text" readonly hidden>${esc(teaser)}</textarea>
    <pre class="teaser">${esc(teaser)}</pre>
    <button class="btn" id="teaser-copy">Copy teaser</button></div>`;
}

// ---------- legend ----------

export function renderLegend(view, S, D) {
  const ramp = `<div class="ramp" style="background:linear-gradient(90deg,${HEAT.join(',')})"></div>`;
  const src = `<div class="src">Dallas 311 · DCAD 2026 · as of ${D.meta.as_of}</div>`;
  const kinds = [0, 1, 2, 4, 5].map(k => `<div class="row"><i class="sw dot" style="background:${KIND_HEX[k]}"></i>${KIND_NAME[k]}</div>`).join('');
  const html = {
    detect: (S.network ? `<h4>Hidden network</h4><div class="row"><i class="sw" style="background:linear-gradient(90deg,#fca50a,#8ab4ff);height:3px"></i>report → same owner's other building</div><div style="height:8px"></div>` : '') + `<h4>311 property reports, last 60 days</h4>${ramp}<div class="breaks"><span>sparse</span><span>report density</span><span>dense</span></div><div style="height:6px"></div>${kinds}<div class="row"><i class="sw" style="border:1.5px solid #fcffa4"></i>emerging cluster (150 m cells)</div>`,
    predict: S.predict === 'neural' && D.falcon ? `<h4>FALCON neural field, next 90 days</h4>${ramp}<div class="breaks"><span>fewer</span><span>expected reports per ${Math.round(D.falcon.cell_m)} m cell</span><span>more</span></div><div style="height:6px"></div>
      <div class="row"><i class="sw dot" style="background:rgba(138,180,255,.25);border:1.75px solid #8ab4ff"></i>likely ignition (quiet 90 days)</div>
      <div class="row"><i class="sw dot" style="border:1.5px solid #fff"></i>blind spot (expected, silent 12 weeks)</div>
      ${S.crews ? `<div class="row"><i class="sw" style="background:linear-gradient(90deg,#8ab4ff,#009e73,#f0e442,#cc79a7);height:3px"></i>crew routes (greedy search)</div>` : ''}` : S.predict === 'proof'
      ? `<h4>Backtest from ${D.meta.backtest_cutoff}</h4><div class="row"><i class="sw" style="background:var(--open)"></i>flagged, no report yet</div><div class="row"><i class="sw" style="background:var(--hit)"></i>flagged, report landed</div>`
      : S.predict === 'certified'
        ? `<h4>Certified list</h4><div class="row"><i class="sw dot" style="background:#8ab4ff"></i>certified: ≤10% expected wrong</div><div class="row"><i class="sw" style="background:#fca50a"></i>top priority interventions</div>`
        : `<h4>Expected new reports, 90 days</h4>${ramp}<div class="breaks"><span>fewer</span><span>per 260 m hex</span><span>more</span></div><div class="row" style="margin-top:6px"><i class="sw" style="background:#fca50a"></i>priority intervention</div>`,
    simulate: `<h4>Chance of a report by the slider date</h4>${ramp}<div class="breaks"><span>0%</span><span>20%</span><span>40%+</span></div>
      <div class="row" style="margin-top:6px"><i class="sw" style="background:var(--stab)"></i>stabilized</div><div class="row"><i class="sw" style="background:#fca50a;height:2px"></i>trigger arc: earlier report → the report it set off</div>`,
    act: S.act === 'plan'
      ? `<h4>Budget plan</h4><div class="row"><i class="sw dot" style="background:#fca50a"></i>home in the plan</div><div class="row"><i class="sw dot" style="background:#8ab4ff"></i>apartment or commercial building</div><div class="breaks" style="margin-top:4px"><span>size: home value protected nearby</span></div>`
      : S.act === 'brief'
        ? (S.route ? `<h4>Crew route</h4><div class="row"><i class="sw" style="background:#8ab4ff;height:3px"></i>driving order, stops numbered</div>` : `<h4>District brief</h4><div class="row"><i class="sw dot" style="background:#fca50a"></i>next 10 actions, numbered by rank</div>`)
        : S.act === 'portfolio'
          ? `<h4>Portfolio buildings</h4><div class="row"><i class="sw dot" style="background:#fca50a"></i>outside building pushing on it</div>${ramp}<div class="breaks"><span>own risk</span><span>share from neighbours</span><span>outside risk</span></div><div class="row" style="margin-top:4px">size: 90-day risk</div>`
          : `<h4>Acquisition leads</h4><div class="row"><i class="sw dot" style="background:#e69f00"></i>lead on the selected list</div>${S.route ? '<div class="row"><i class="sw" style="background:#8ab4ff;height:3px"></i>drive-for-dollars loop</div>' : ''}`,
    evidence: `<h4>Recall by council district</h4>${ramp}<div class="breaks"><span>under-served</span><span>city</span><span>over-served</span></div>`,
  }[view];
  $('legend').innerHTML = html + src;
}

// ---------- first screen ----------

export function renderIntro(D, onTour, onExplore) {
  const m = D.meta, net = m.model.network, lt = m.audit?.lead_time?.rankings?.network;
  const el = document.createElement('div');
  el.id = 'intro';
  el.innerHTML = `<div class="intro-card">
    <div class="intro-mark"><svg width="22" height="22" viewBox="0 0 18 18" aria-hidden="true"><rect x="1" y="1" width="6" height="16" rx="1" fill="#dd513a"/><rect x="11" y="1" width="6" height="16" rx="1" fill="#33363d"/></svg>Firebreak</div>
    <h1>Property distress spreads like fire.<br>See where it goes next, and where to stop it.</h1>
    <p>A forecast, simulator and work planner for every building in Dallas, built from public records that share no IDs:
      the ${m.counts.buildings.toLocaleString()}-building appraisal roll and ${m.counts.reports.toLocaleString()} city 311 reports.</p>
    <div class="intro-stats">
      <div><b>${pct(net.watch_precision)}</b><span>of the top ${net.watch_list.toLocaleString()} flagged buildings got a report within 90 days, on data the model never saw (base rate ${pct(net.base_rate, 1)})</span></div>
      <div><b>${m.edges.block.ratio.toFixed(2)}×</b><span>higher odds when the house next door had a report; ${m.edges.owner.ratio.toFixed(2)}× when another building with the same owner did</span></div>
      ${lt ? `<div><b>${lt.median_days_ahead} days</b><span>median warning before the first call, for ${lt.cases_reached_early.toLocaleString()} cases a 50-visit-a-day crew would reach first</span></div>` : ''}
    </div>
    <div class="intro-go"><button class="btn primary" id="intro-tour">Take the 80-second tour <kbd>T</kbd></button><button class="btn" id="intro-explore">Explore the map</button></div>
    <div class="intro-foot">Dallas 311 · DCAD 2026 certified roll · data through ${fmtDate(new Date(m.as_of))} · HackUTD 2026, CBRE: Predict Before It Spreads</div>
  </div>`;
  document.getElementById('stage').appendChild(el);
  const close = () => el.remove();
  el.querySelector('#intro-tour').onclick = () => { close(); onTour(); };
  el.querySelector('#intro-explore').onclick = () => { close(); onExplore(); };
  return close;
}
