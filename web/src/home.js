// Home: the screen a team opens every morning. It answers three questions before anyone touches the map:
// what needs attention today, what should I do about it, and what is already in motion. Every number is
// read from the pipeline's files or from the console's own tools (main.js builds the model passed in);
// this file only lays it out.

import { $, esc, pct, kusd, fmtDate } from './panels.js';
import { STATUS_LABEL, NEXT } from './cases.js';

export const ROLES = {
  city: { tab: 'Compliance', name: 'Code compliance', who: 'city inspectors, neighbourhood services' },
  owner: { tab: 'Owners', name: 'Owners and managers', who: 'portfolio, asset and property managers' },
  buyer: { tab: 'Acquisitions', name: 'Acquisitions', who: 'investors and wholesale buyers' },
};

const num = v => Math.round(v).toLocaleString();
const OUTCOMES = ['Repaired', 'Owner contacted, repair scheduled', 'Citation issued', 'Nothing found on site'];

function kpi(v, label, caption = '') {
  return `<div class="kpi"><div class="v">${v}</div><div class="l">${label}</div>${caption ? `<div class="c">${caption}</div>` : ''}</div>`;
}

const when = t => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function age(days) { return days <= 1 ? 'today' : days < 45 ? `${days} days old` : `${Math.round(days / 30)} months old`; }

export function renderHome(D, S, h, M) {
  const role = ROLES[S.role] ? S.role : 'city';
  const open = M.cases.filter(c => c.status !== 'resolved'), done = M.cases.filter(c => c.status === 'resolved');
  const shown = S.caseTab === 'resolved' ? done : S.caseTab === 'all' ? M.cases : open;
  const top = M.alarms[0];
  $('panel').innerHTML = `
    <div class="pane home-head">
      <div class="ph"><h2>Home</h2><span class="meta">${fmtDate(new Date(D.meta.as_of))}</span></div>
      <div class="seg roles" role="tablist" aria-label="Workspace">
        ${Object.entries(ROLES).map(([k, r]) => `<button role="tab" aria-selected="${k === role}" class="${k === role ? 'on' : ''}" data-role="${k}" title="${r.name}: ${r.who}">${r.tab}</button>`).join('')}
      </div>
      <p class="brief">${top ? `The strongest cluster this week is around <b>${esc(top.where)}</b>: ${num(top.observed)} new cases in
        ${top.window} days against ${top.expected.toFixed(1)} expected.` : 'No cluster is being watched this week.'}
        ${open.length ? `${open.length} ${open.length === 1 ? 'case is' : 'cases are'} in motion.` : 'No case is open yet.'}
        ${M.watchHits ? `${M.watchHits} followed ${M.watchHits === 1 ? 'building was' : 'buildings were'} touched by new reports.` : ''}</p>
      <div class="kpis">
        ${kpi(num(D.recent7), 'property reports, last 7 days', `${num(D.recent7prev)} the week before`)}
        ${kpi(num(M.alarms.length), 'clusters being watched', 'subset scan, strongest first')}
        ${kpi(num(open.length), 'open cases', `${num(done.length)} resolved`)}
        ${kpi(M.live.status === 'on' && M.live.mode === 'live' ? num(M.live.count) : '—', 'new 311 reports since the snapshot',
          M.live.status === 'on' ? (M.live.mode === 'live' ? `pulled ${esc(M.live.at)}` : 'live feed unreachable here') : esc(M.live.note || 'connecting'))}
      </div>
    </div>

    <div class="pane">
      <div class="sec-h"><h3>Needs attention</h3><small>emerging clusters, strongest first</small></div>
      <ol class="todo">
        ${M.alarms.slice(0, 4).map(a => `<li>
          <button class="todo-main" data-alarm="${a.k}"><b>${esc(a.where)}</b>
            <small>${num(a.observed)} cases in ${a.window} days · ${a.expected.toFixed(1)} expected · ${num(a.buildings)} buildings</small></button>
          <button class="btn ${a.k === 0 ? 'primary' : ''}" data-pb="${a.k}" title="Run the resolution playbook">Resolve <kbd>R</kbd></button></li>`).join('')}
      </ol>
    </div>

    <div class="pane">
      <div class="sec-h"><h3>Next moves</h3><small>${ROLES[role].name}: ${ROLES[role].who}</small></div>
      <ul class="moves">
        ${M.moves.map((m, k) => `<li><button data-move="${k}"><span class="mv-t">${esc(m.title)}</span><span class="mv-w">${m.why}</span>${m.key ? `<kbd>${m.key}</kbd>` : ''}</button></li>`).join('')}
      </ul>
    </div>

    <div class="pane">
      <div class="sec-h"><h3>Cases</h3><small>${M.cases.length ? `<button class="link" id="cases-csv">Export CSV</button>` : 'kept in this browser'}</small></div>
      <div class="chips" role="tablist">
        ${[['open', `Open ${open.length}`], ['resolved', `Resolved ${done.length}`], ['all', `All ${M.cases.length}`]].map(([k, l]) =>
          `<button class="chip ${(S.caseTab || 'open') === k ? 'on' : ''}" data-ctab="${k}">${l}</button>`).join('')}
      </div>
      ${shown.length ? `<ul class="cases">${shown.map(c => caseRow(c, S.caseOpen === c.id)).join('')}</ul>`
        : `<p class="note">${M.cases.length ? 'Nothing here.' : 'A case opens when someone approves a playbook. Pick a cluster above and press Resolve: the playbook traces it, costs the work and routes a crew, then waits for you to hold Approve.'}</p>`}
    </div>

    <div class="pane">
      <div class="sec-h"><h3>Data health</h3><small>what every number on this screen rests on</small></div>
      <div class="tw"><table class="t health"><thead><tr><th>Source</th><th>As of</th><th class="r">Size</th></tr></thead><tbody>
        ${M.health.map(r => `<tr><td><i class="dot ${r.state}"></i>${esc(r.name)}<small>${esc(r.note)}</small></td><td>${esc(r.asOf)}<small>${r.days != null ? age(r.days) : ''}</small></td><td class="r">${r.size}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="note">Green: refreshed within the forecast horizon. Amber: older than that; the console still runs, and the Evidence tab says how much the model drifted on the last held-out quarter.</p>
    </div>

    <div class="pane shortcuts">
      <div class="sec-h"><h3>Shortcuts</h3><small><button class="link" id="film-go">Film mode <kbd>F</kbd></button></small></div>
      <ul class="keys">
        <li><kbd>0</kbd>Home</li><li><kbd>1</kbd>–<kbd>5</kbd>Detect to Evidence</li><li><kbd>⌘K</kbd>Search an address, owner or action</li>
        <li><kbd>R</kbd>Resolve the strongest cluster</li><li><kbd>N</kbd>Hidden owner network</li><li><kbd>T</kbd>Guided tour</li>
      </ul>
    </div>`;

  const P = $('panel');
  P.querySelectorAll('[data-role]').forEach(b => { b.onclick = () => h.role(b.dataset.role); });
  P.querySelectorAll('[data-alarm]').forEach(b => { b.onclick = () => h.homeAlarm(+b.dataset.alarm); });
  P.querySelectorAll('[data-pb]').forEach(b => { b.onclick = () => h.playbook(+b.dataset.pb); });
  P.querySelectorAll('[data-move]').forEach(b => { b.onclick = () => M.moves[+b.dataset.move].run(); });
  P.querySelectorAll('[data-ctab]').forEach(b => { b.onclick = () => h.caseTab(b.dataset.ctab); });
  P.querySelectorAll('[data-case]').forEach(b => { b.onclick = () => h.caseOpen(b.dataset.case); });
  P.querySelectorAll('[data-adv]').forEach(b => {
    b.onclick = () => { const sel = P.querySelector(`select[data-outcome="${b.dataset.adv}"]`); h.caseAdvance(b.dataset.adv, sel ? sel.value : ''); };
  });
  P.querySelectorAll('[data-cdel]').forEach(b => { b.onclick = () => h.caseRemove(b.dataset.cdel); });
  P.querySelectorAll('[data-cmap]').forEach(b => { b.onclick = () => h.caseMap(b.dataset.cmap); });
  const csv = $('cases-csv'); if (csv) csv.onclick = h.casesCsv;
  $('film-go').onclick = h.film;
}

function caseRow(c, expanded) {
  const step = NEXT[c.status];
  return `<li class="case ${c.status} ${expanded ? 'open' : ''}">
    <button class="case-h" data-case="${esc(c.id)}" aria-expanded="${expanded}">
      <span class="st ${c.status}">${STATUS_LABEL[c.status]}</span><b>${esc(c.title)}</b>
      <small>${esc(c.id)} · ${c.workOrders != null ? `${c.workOrders} work orders · ${kusd(c.cost)} · ${c.prevented.toFixed(1)} reports prevented` : 'approved in an earlier version'}</small></button>
    ${expanded ? `<div class="case-b">
      ${c.origin ? `<p class="note">Origin: ${esc(c.origin)}. Route: ${c.stops ?? '—'} stops, ${c.km != null ? c.km.toFixed(1) + ' km' : '—'}.</p>` : ''}
      <ol class="log">${c.log.map(l => `<li><time datetime="${esc(l.t)}">${esc(when(l.t))}</time>${esc(l.what)}</li>`).join('')}</ol>
      <div class="inline">
        ${step ? (step.to === 'resolved'
          ? `<select data-outcome="${esc(c.id)}" aria-label="Outcome">${OUTCOMES.map(o => `<option>${o}</option>`).join('')}</select><button class="btn primary" data-adv="${esc(c.id)}">${step.label}</button>`
          : `<button class="btn primary" data-adv="${esc(c.id)}">${step.label}</button>`) : ''}
        ${c.stopsIdx ? `<button class="btn" data-cmap="${esc(c.id)}">Show on map</button>` : ''}
        ${c.link ? `<a class="btn" href="${esc(c.link)}" target="_blank" rel="noopener">Open route</a>` : ''}
        <button class="btn ghost" data-cdel="${esc(c.id)}">Remove</button>
      </div></div>` : ''}
  </li>`;
}

export function healthRows(D, live) {
  const asOf = new Date(D.meta.as_of), H = D.meta.horizon_days;
  const days = s => { const d = new Date(s); return isNaN(d) ? null : Math.max(0, Math.round((asOf - d) / 864e5)); };
  const state = d => (d == null ? 'na' : d <= H ? 'ok' : 'old');
  const dcadDate = (D.meta.sources.dcad.match(/\d{4}-\d{2}-\d{2}/) || [])[0];
  const pulled = (D.meta.sources.dallas_311.match(/\d{4}-\d{2}-\d{2}/) || [])[0];
  const rows = [
    { name: 'DCAD 2026 certified roll', note: 'buildings, owners, tenants', asOf: dcadDate || '—', days: days(dcadDate), size: `${num(D.meta.counts.buildings)} buildings` },
    { name: 'Dallas 311 snapshot', note: 'property and infrastructure reports', asOf: pulled || D.meta.as_of, days: days(pulled || D.meta.as_of), size: `${num(D.meta.counts.reports)} reports` },
    { name: 'Live 311 feed', note: live.status === 'on' ? (live.mode === 'live' ? 'Dallas Open Data, polled from the browser' : 'unreachable here: replaying the snapshot') : (live.note || 'connecting'),
      asOf: live.status === 'on' && live.mode === 'live' ? 'now' : '—', days: live.status === 'on' && live.mode === 'live' ? 0 : null, size: live.status === 'on' ? `${num(live.count)} new` : '—', live: true },
    { name: 'Forecast model, frozen', note: `boosted trees, AUC ${D.meta.model.network.auc.toFixed(3)} held-out`, asOf: D.meta.backtest_cutoff, days: days(D.meta.backtest_cutoff), size: `${num(D.meta.model.train_rows)} rows` },
    ...(D.hawkes ? [{ name: 'Spread model (Hawkes)', note: `refit each build, +${D.hawkes.fit.test_gain_nats_per_report.toFixed(2)} nats a report held-out`, asOf: D.hawkes.as_of, days: days(D.hawkes.as_of), size: `${num(D.hawkes.fit.train_reports)} reports` }] : []),
  ];
  if (D.falcon) rows.push({ name: 'Neural field (FALCON)', note: `${D.falcon.model.epochs} epochs, best validation ${D.falcon.model.best_val_poisson}`, asOf: D.falcon.as_of, days: days(D.falcon.as_of), size: `${D.falcon.grid}² cells` });
  for (const r of rows) r.state = r.live ? (r.days === 0 ? 'ok' : 'na') : state(r.days);
  return rows;
}
