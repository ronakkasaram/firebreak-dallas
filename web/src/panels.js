// Side panel and HUD. Every number here comes from meta.json or hotspots.json; nothing is invented in the UI.

const $ = id => document.getElementById(id);
const usd = v => '$' + Math.round(v).toLocaleString();
const kusd = v => v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3) + 'K' : usd(v);
const pct = v => (v * 100).toFixed(0) + '%';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function veilAddr(a) { return a.replace(/^\d+/, '••••'); }

function shownAddr(h, state) {
  return state.veil && h.asset_class === 'home' ? veilAddr(h.address) : h.address;
}

function store(key, val) {
  try {
    if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
    localStorage.setItem(key, JSON.stringify(val));
  } catch { return null; }
}

export function renderHud(D) {
  const { meta, hotspots } = D;
  const exposure = hotspots.reduce((a, h) => a + h.usd.exposure, 0);
  $('hud-stats').innerHTML = `
    <div><b>${meta.counts.buildings.toLocaleString()}</b><span>buildings linked</span></div>
    <div><b>${meta.counts.tenants.toLocaleString()}</b><span>business tenants</span></div>
    <div><b>${Math.round(D.expected).toLocaleString()}</b><span>reports expected, 90 days</span></div>
    <div><b>${kusd(exposure)}</b><span>at stake, top ${hotspots.length}</span></div>`;
}

export function renderClaim(meta) {
  const net = meta.model.network, base = meta.model.base;
  const edges = Object.entries(meta.edges);
  const bar = r => `<i style="width:${Math.min(100, Math.max(4, (r - 0.7) / 0.7 * 100))}%"></i>`;
  $('claim').innerHTML = `
    <div class="kicker">The prediction we were asked to break</div>
    <blockquote><s>Commercial property networks are too fragmented to detect hidden dependencies.</s></blockquote>
    <p class="lede">We joined <b>DCAD</b> parcels, owners and business tenants with <b>Dallas 311</b> reports, then measured
      each hidden link on buildings that had never had a report.</p>
    <ul class="edges">${edges.map(([k, e]) => `
      <li class="${e.ratio >= 1.1 ? 'live' : 'dead'}">
        <div class="edge-top"><span>${k === 'block' ? 'next door' : k === 'owner' ? 'same owner' : 'pipes and streets'}</span>
          <b>${e.ratio.toFixed(2)}×</b></div>
        <div class="edge-bar">${bar(e.ratio)}<em></em></div>
        <small>${esc(e.edge)}. ${(e.exposed_buildings).toLocaleString()} exposed buildings, 4 test periods.</small>
      </li>`).join('')}
    </ul>
    <div class="proof">
      <div><b>${pct(net.watch_precision)}</b><span>of our ${net.watch_list.toLocaleString()} flagged buildings got a new
        report within 90 days</span></div>
      <div><b>${net.watch_lift.toFixed(1)}×</b><span>the city base rate of ${pct(net.base_rate)}. Held-out test from
        ${meta.backtest_cutoff}, AUC ${net.auc.toFixed(3)} (own history only: ${base.auc.toFixed(3)})</span></div>
    </div>`;
}

export function renderList(D, state, onPick) {
  const rows = D.hotspots.filter(h => state.filter === 'all' || h.asset_class === state.filter).slice(0, 40);
  $('list').innerHTML = rows.map((h, k) => `
    <li data-k="${k}">
      <span class="rank">${String(k + 1).padStart(2, '0')}</span>
      <span class="who"><b>${esc(h.name || shownAddr(h, state))}</b><small>${h.asset_class}${h.tenants ? ` · ${h.tenants} tenants` : ''}
        · ${h.zip}</small></span>
      <span class="num"><b>${kusd(h.usd.exposure)}</b><small>${pct(h.risk)} risk</small></span>
    </li>`).join('');
  $('list').onclick = ev => {
    const li = ev.target.closest('li'); if (li) onPick(rows[+li.dataset.k]);
  };
}

export function renderLegend(mode) {
  const items = {
    spread: [['#ff6a2b', 'code violation'], ['#d68c3c', 'unregistered rental'], ['#e6c478', 'tenant complaint'],
      ['#be5aa0', 'vacancy'], ['#eb4646', 'nuisance'], ['#5a96c8', 'pipes, streets']],
    backtest: [['#ff6a2b', 'flagged on cutoff day'], ['#8fbf7a', 'report landed: called it']],
    forecast: [['#ff6a2b', 'expected new reports'], ['#c9a25a', 'firebreak: homes'], ['#ff6a2b', 'firebreak: commercial']],
    wholesale: [['#ff6a2b', 'first spark'], ['#eb4646', 'code stack'], ['#c9a25a', 'tired landlord'], ['#be5aa0', 'block on fire']],
    house: [['#ff6a2b', 'trigger arc: report to the report it set off'], ['#ffb26e', 'chance of a report, 90 days'], ['#8fbf7a', 'stabilized']],
  }[mode];
  $('legend').innerHTML = items.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
}

export const LIST_COLOR = {
  first_spark: [255, 106, 43], code_stack: [235, 70, 70], tired_landlord: [201, 162, 90], block_fire: [190, 90, 160],
};
const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');

function csv(rows) {
  const cols = ['list', 'parcel_id', 'address', 'zip', 'risk', 'reports_365', 'value', 'arv', 'repairs', 'buyer_price',
    'offer', 'fee', 'buyers_nearby'];
  const q = v => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : (v ?? '');
  return [cols.join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\n');
}

// Wholesale mode: the contagion signal pointed at motivated sellers, scored on the backtest date.
export function renderWholesale(D, state, onPick, onChange) {
  const el = $('wholesale');
  if (!D.lists) { el.innerHTML = '<p class="muted">No lists.json yet. Run the backend build.</p>'; return; }
  const draw = () => {
    const L = D.lists.lists.find(l => l.id === state.list) || D.lists.lists[0];
    const bt = L.backtest || {};
    const viable = L.leads.filter(l => l.viable);
    const fees = viable.reduce((a, l) => a + l.fee, 0);
    el.innerHTML = `
      <div class="kicker">Wholesale · find the seller before the first letter lands</div>
      <p class="lede">List providers sell owners who <b>already</b> have a violation, so every wholesaler mails them the
        same week. Firebreak ranks owners using the same spread signal, on houses no one else is watching yet.
        Owner-occupied homes are never listed.</p>
      <div class="tabs">${D.lists.lists.map(l => `<button data-l="${l.id}" class="${l.id === L.id ? 'on' : ''}"
        style="--c:${hex(LIST_COLOR[l.id])}">${esc(l.title)}</button>`).join('')}</div>
      <div class="list-card" style="--c:${hex(LIST_COLOR[L.id])}">
        <h3>${esc(L.title)}</h3>
        <p>${esc(L.pitch)}</p>
        <small>${esc(L.rule)}</small>
        <div class="proof">
          <div><b>${pct(bt.hit_rate || 0)}</b><span>of the top ${bt.top} on ${D.lists.backtest_cutoff} got a new report
            within 90 days</span></div>
          <div><b>${(bt.lift || 0).toFixed(1)}×</b><span>the ${pct(bt.base_rate || 0)} rate for all non-owner-occupied
            houses${bt.pool_rate != null ? `. The rule alone, unranked: ${pct(bt.pool_rate)}` : ''}</span></div>
        </div>
        <div class="roi"><b>${L.leads.length}</b> leads · <b>${viable.length}</b> pencil at 70% of ARV ·
          <b>${kusd(fees)}</b> in minimum fees if every viable one closed</div>
        <button class="dl">[ download csv ]</button>
      </div>
      <ol id="leads">${L.leads.slice(0, 60).map((l, k) => `
        <li data-k="${k}">
          <span class="rank">${String(k + 1).padStart(2, '0')}</span>
          <span class="who"><b>${esc(shownAddr(l, state))}</b><small>${l.zip} · ${l.reports_365} reports ·
            ${l.block_90d} on block · ${l.buyers_nearby} buyers</small></span>
          <span class="num"><b>${pct(l.risk)}</b><small>${l.viable ? 'offer ' + kusd(l.offer) : 'no spread'}</small></span>
        </li>`).join('')}</ol>`;
    el.querySelector('.tabs').onclick = ev => {
      const id = ev.target.dataset.l; if (!id) return;
      state.list = id; state.lead = null; $('dossier').hidden = true; draw(); onChange();
    };
    el.querySelector('#leads').onclick = ev => {
      const li = ev.target.closest('li'); if (li) onPick(L.leads[+li.dataset.k]);
    };
    el.querySelector('.dl').onclick = () => {
      const blob = new Blob([csv(L.leads.map(l => ({ ...l, list: L.id })))], { type: 'text/csv' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `firebreak_${L.id}.csv` });
      a.click(); URL.revokeObjectURL(a.href);
    };
  };
  draw();
}

export function renderLead(l, D, state) {
  const el = $('dossier');
  const queued = store('fb-queued') || {};
  el.hidden = false;
  el.innerHTML = `
    <div class="dossier-head">
      <div class="kicker">${l.asset_class} lead · ${esc(D.lists.lists.find(x => x.id === state.list)?.title || '')}</div>
      <h2>${esc(shownAddr(l, state))}</h2>
      <div class="muted">Dallas ${l.zip}${l.year_built ? ` · built ${l.year_built}` : ''}${l.sqft ? ` · ${Math.round(l.sqft).toLocaleString()} sf` : ''}</div>
    </div>
    <div class="risk-row">
      <div class="risk"><b>${pct(l.risk)}</b><span>chance of a new report in 90 days</span></div>
      <div class="risk"><b>${pct(l.p_two_buyers)}</b><span>chance 2 repeat buyers want it (${l.buyers_nearby} nearby)</span></div>
    </div>
    <div class="kicker">Why this owner, why now</div>
    <ul class="facts">
      <li><span>Reports here</span><b>${l.reports_365} this year · ${l.reports_all} ever</b></li>
      <li><span>Next door (50 m, 30 d)</span><b>${l.next_door_30d}</b></li>
      <li><span>Block (250 m, 90 d)</span><b>${l.block_90d}</b></li>
      <li><span>Owner</span><b>${l.owner.label ? esc(l.owner.label) : 'private owner'} · ${l.owner.buildings} buildings
        ${l.owner.out_of_state ? '· out of state' : l.owner.absentee ? '· mails elsewhere' : ''}</b></li>
      <li><span>Network adds</span><b>+${(l.network_pts * 100).toFixed(0)} pts</b></li>
    </ul>
    <div class="kicker">Oracle · rescue math</div>
    <ul class="facts">
      <li><span>DCAD value</span><b>${usd(l.value)}</b></li>
      <li><span>After-repair value</span><b>${usd(l.arv)}</b></li>
      <li><span>Repairs</span><b>${usd(l.repairs)}</b></li>
      <li><span>Cash buyer pays</span><b>${usd(l.buyer_price)}</b></li>
      <li><span>Offer to owner</span><b>${usd(l.offer)}</b></li>
      <li class="total"><span>Assignment fee</span><b>${l.viable ? usd(l.fee) : 'does not pencil'}</b></li>
    </ul>
    <button class="sign ${queued[l.parcel_id] ? 'signed' : ''}" tabindex="0">
      <span class="fill" style="width:${queued[l.parcel_id] ? 100 : 0}%"></span>
      <span class="label">${queued[l.parcel_id] ? '[ queued for WHOLZR · a human sends ]' : '[ hold to queue for WHOLZR ]'}</span>
    </button>
    <p class="fine">Owner names and mailing addresses never leave the private WHOLZR export. Nothing is mailed from here.</p>`;
  const btn = el.querySelector('.sign');
  if (!queued[l.parcel_id]) {
    holdButton(btn, 1100, () => {
      queued[l.parcel_id] = new Date().toISOString();
      store('fb-queued', queued);
      btn.classList.add('signed');
      btn.querySelector('.label').textContent = '[ queued for WHOLZR · a human sends ]';
    });
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function holdButton(el, ms, done) {
  let t0 = 0, raf = 0;
  const fill = el.querySelector('.fill');
  const step = t => {
    const f = Math.min(1, (t - t0) / ms);
    fill.style.width = (f * 100) + '%';
    if (f >= 1) { done(); return; }
    raf = requestAnimationFrame(step);
  };
  const start = ev => { ev.preventDefault(); t0 = performance.now(); raf = requestAnimationFrame(step); };
  const stop = () => { cancelAnimationFrame(raf); if (!el.classList.contains('signed')) fill.style.width = '0'; };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointerleave', stop);
  el.addEventListener('keydown', ev => { if (ev.key === 'Enter') done(); });
}

export function renderDossier(h, D, state, onClose) {
  const el = $('dossier');
  const p = h.plan, uw = p.underwrite;
  const approved = store('fb-approved') || {};
  const k = h.history.kinds || {};
  const lift = Math.max(0, h.risk - h.risk_base);
  el.hidden = false;
  el.innerHTML = `
    <div class="dossier-head">
      <button class="x" aria-label="Close">[ esc ]</button>
      <div class="kicker">${h.asset_class}${h.building_type ? ' · ' + esc(h.building_type.toLowerCase()) : ''}</div>
      <h2>${esc(h.name || shownAddr(h, state))}</h2>
      <div class="muted">${esc(shownAddr(h, state))}, Dallas ${h.zip}${h.year_built ? ` · built ${h.year_built}` : ''}
        ${h.units ? ` · ${h.units} units` : h.sqft ? ` · ${Math.round(h.sqft).toLocaleString()} sf` : ''}</div>
    </div>

    <div class="risk-row">
      <div class="risk"><b>${pct(h.risk)}</b><span>chance of a new report in 90 days</span></div>
      ${lift >= 0.02 ? `<div class="risk"><b>+${(lift * 100).toFixed(0)} pts</b><span>from links a single owner can't see</span></div>`
        : `<div class="risk"><b>${h.prevented_nearby.toFixed(2)}</b><span>reports prevented next door by acting now</span></div>`}
    </div>

    <div class="kicker">Why</div>
    <ul class="facts">
      <li><span>Reports here</span><b>${h.history.last_90} in 90 d · ${h.history.last_365} in a year</b></li>
      <li><span>Kinds</span><b>${Object.entries(k).map(([a, n]) => `${n} ${a}`).join(' · ') || '—'}</b></li>
      <li><span>Next door (50 m, 30 d)</span><b>${h.block.reports_50m_30d} reports</b></li>
      <li><span>Block (250 m, 90 d)</span><b>${h.block.reports_250m_90d} reports · ${h.block.buildings_250m} buildings</b></li>
      <li><span>Owner</span><b>${h.owner.label ? esc(h.owner.label) : 'private owner'} · ${h.owner.buildings} buildings ·
        ${h.owner.reports_elsewhere_365} reports elsewhere</b></li>
      <li><span>Tenants on file</span><b>${h.tenants}</b></li>
    </ul>

    <div class="kicker">What spreading costs</div>
    <ul class="facts money">
      <li><span>Neighbor value within 200 m</span><b>${kusd(h.usd.neighbor_value)}</b></li>
      <li><span>Expected value lost next door</span><b>${usd(h.usd.spillover)}</b></li>
      <li><span>Rent exposed${h.usd.rent_use ? ` (${h.usd.rent_use} rate)` : ''} · case open ${h.usd.days_open ?? '—'} d</span><b>${usd(h.usd.rent_at_risk)}</b></li>
      <li><span>Reports prevented by acting now</span><b>${(h.risk + h.prevented_nearby).toFixed(2)}</b></li>
      <li class="total"><span>At stake</span><b>${usd(h.usd.exposure)}</b></li>
    </ul>

    ${uw ? `<div class="kicker">Oracle · rescue math</div>
    <ul class="facts">
      <li><span>After-repair value</span><b>${usd(uw.arv)}</b></li>
      <li><span>Repairs (${uw.repair_tier})</span><b>${usd(uw.repairs)}</b></li>
      <li><span>Cash buyer pays</span><b>${usd(uw.buyer_price)}</b></li>
      <li><span>Offer to owner</span><b>${usd(uw.offer)}</b></li>
      <li><span>Assignment fee</span><b>${usd(uw.fee)}</b></li>
    </ul>` : ''}

    <div class="kicker">The crew's plan · nothing is sent without you</div>
    <ol class="steps">${p.steps.map(s => `<li><b>${s.crew}</b><span>${esc(s.do)}</span>${s.cost ? `<em>${usd(s.cost)}</em>` : ''}</li>`).join('')}</ol>
    ${p.buyers.length ? `<div class="buyers">Buyers who bought here lately: ${p.buyers.map(b => `<span>${esc(b.name)} <small>${b.buys_2y} buys${b.in_zip ? ', this ZIP' : ''}</small></span>`).join('')}</div>` : ''}
    <div class="roi"><b>${usd(p.cost)}</b> to act now · <b>${usd(h.usd.exposure)}</b> at stake if it spreads</div>

    <button class="sign ${approved[h.parcel_id] ? 'signed' : ''}" tabindex="0">
      <span class="fill" style="width:${approved[h.parcel_id] ? 100 : 0}%"></span>
      <span class="label">${approved[h.parcel_id] ? '[ approved · queued for a human to send ]' : '[ hold to approve the plan ]'}</span>
    </button>
    <p class="fine">Demo: approval is stored in this browser only. No email, mail or call leaves Firebreak.</p>`;

  el.querySelector('.x').onclick = () => { el.hidden = true; onClose(); };
  const btn = el.querySelector('.sign');
  if (!approved[h.parcel_id]) {
    holdButton(btn, 1100, () => {
      approved[h.parcel_id] = new Date().toISOString();
      store('fb-approved', approved);
      btn.classList.add('signed');
      btn.querySelector('.label').textContent = '[ approved · queued for a human to send ]';
    });
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- house by house ----------

const HK_KINDS = ['code', 'rental', 'tenant', 'vacancy', 'nuisance'];
const EV_KIND = ['code violation', 'unregistered rental', 'tenant complaint', 'construction', 'vacancy', 'nuisance', 'pipes, streets'];
const CLASS_NAME = ['home', 'multifamily', 'commercial', 'industrial'];

function sparkline(base, withS) {
  const W = 300, H = 64, n = base.length - 1;
  const max = Math.max(base[n], 1e-9);
  const path = a => Array.from(a, (v, t) => `${t ? 'L' : 'M'}${(t / n * W).toFixed(1)},${(H - v / max * (H - 6)).toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Expected reports over 90 days">
    <path d="${path(base)}" class="sp-base"/>${withS ? `<path d="${path(withS)}" class="sp-with"/>` : ''}</svg>`;
}

export function renderHouseIdle(D) {
  const h = D.hawkes, a = D.meta.audit;
  if (!h) { $('house').innerHTML = '<p class="muted">Run the backend build to make hawkes.json.</p>'; return; }
  const f = h.fit, p = h.params;
  const maxB = Math.max(...HK_KINDS.map(k => h.branching[k].same_house + h.branching[k].neighbours));
  const lt = a?.lead_time?.rankings, before = a?.fairness, after = a?.fairness_after_rerank;
  const under = r => r.districts.filter(d => d.under_served).length;
  $('house').innerHTML = `
    <div class="kicker">House by house</div>
    <h2 class="hh">A report on one house raises the odds on the next one. We measured by how much.</h2>
    <p class="lede">A self-exciting point process (Hawkes) fitted to every Dallas property report, house by house:
      each report adds to the rate of its own house and of houses within ${p.radius_m} m, fading with distance
      (${p.sigma_m} m scale) and time (${p.slow_delay_days} days on average).</p>
    <div class="proof">
      <div><b>${pct(f.spread_share)}</b><span>of 2025 reports were set off by an earlier report nearby, on the weeks-long
        scale. Another ${pct(f.triggered_share - f.spread_share)} were same-hour echoes of one problem.</span></div>
      <div><b>+${f.test_gain_nats_per_report.toFixed(2)}</b><span>nats per report on held-out ${f.test.replace(' to ', '–')}
        against the same model with no spread. The spread is real, not a fitting artefact.</span></div>
    </div>
    <div class="kicker sub">New reports each report sets off, by kind</div>
    <ul class="branch">${HK_KINDS.map(k => {
      const b = h.branching[k];
      return `<li><span>${k}</span><span class="bar"><i class="own" style="width:${b.same_house / maxB * 100}%"></i><i class="nb"
        style="width:${b.neighbours / maxB * 100}%"></i></span><b>${(b.same_house + b.neighbours).toFixed(2)}</b></li>`;
    }).join('')}</ul>
    <p class="note"><i class="sw own"></i>same house <i class="sw nb"></i>neighbours. As a ranker this model hits
      ${pct(h.as_ranker.watch_precision)} on the top 2,000 against ${pct(h.as_ranker.gbm_watch_precision)} for the boosted
      model, so the list stays boosted. Hawkes runs the what-if.</p>
    ${lt ? `<div class="kicker sub">Days of warning (held-out ${a.cutoff})</div>
    <p class="lede">A crew that visits ${a.lead_time.capacity_per_day} buildings a day in our order reaches
      <b>${lt.network.cases_reached_early.toLocaleString()}</b> cases before the first 311 call, a median
      <b>${lt.network.median_days_ahead} days early</b>. Working from last year's complaint counts reaches
      ${lt.last_year_count.cases_reached_early.toLocaleString()}. Waiting for calls reaches none.</p>` : ''}
    ${before ? `<div class="kicker sub">Fair across the 14 council districts</div>
    <ul class="fair">${before.districts.map((d, k) => {
      const d2 = after.districts[k];
      const x = v => Math.min(100, (v ?? 0) / 2 * 100);
      return `<li><span>D${d.district}</span><span class="track"><em></em><i class="${d.under_served ? 'bad' : ''}"
        style="left:${x(d.recall_ratio)}%"></i><i class="fix" style="left:${x(d2.recall_ratio)}%"></i></span></li>`;
    }).join('')}</ul>
    <p class="note">Dot: each district's share of its real cases on the list, against the city (line at 1.0).
      Ember: ${under(before)} districts under 0.8, the four-fifths rule. Lichen: after giving each district slots in proportion to
      the cases the model expects there. ${under(after)} under 0.8; precision ${pct(before.city_precision)} to ${pct(after.city_precision)}.</p>` : ''}
    <p class="cta">Click any building on the map.</p>`;
}

export function renderHouse(D, H, actions) {
  const { b } = D, r = H.res, i = H.i;
  const N = r?.N, f = r?.focus, end = 90;
  const pBase = r ? r.base.pBy[end * N + f] : null;
  const pWith = r?.withS ? r.withS.pBy[end * N + f] : null;
  const stabilized = H.stab.includes(i);
  const dr = r?.drivers;
  const drTot = dr ? dr.background + dr.self + dr.neighbours : 1;
  const area = r ? r.base.cumDaily[end] : 0;
  const areaWith = r?.withS ? r.withS.cumDaily[end] : null;
  const hot = D.hotspots.find(h => h.i === i);
  $('house').innerHTML = `
    <button class="close" id="house-close" aria-label="Back">×</button>
    <div class="kicker">House by house · ${CLASS_NAME[b.class[i]]} · council district ${b.district?.[i] || '?'}</div>
    <h2 class="hh">${hot ? esc(hot.name || (hot.asset_class === 'home' ? veilAddr(hot.address) : hot.address)) : `Building ${i.toLocaleString()}`}</h2>
    <p class="muted small">DCAD value ${kusd(b.value[i])} · boosted-model 90-day risk ${pct(b.risk[i] / 255)} · ${b.reports_365[i]} reports in the last year</p>
    ${!r ? `<p class="muted">${esc(H.status || 'simulating …')}</p>` : `
    <div class="proof">
      <div><b>${stabilized ? '0%' : pct(pWith ?? pBase)}</b><span>chance of a new report here within 90 days, across
        ${r.runs} simulated futures${pWith !== null && !stabilized ? ` (${pct(pBase)} with no firebreaks)` : ''}.
        ${r.base.medianDay && !stabilized ? `If one comes, median day ${r.base.medianDay}.` : ''}</span></div>
      <div><b>${(areaWith ?? area).toFixed(1)}</b><span>reports expected within 700 m${areaWith !== null ? `, down from ${area.toFixed(1)}` : ''}.
        80% of futures: ${(r.withS || r.base).p10}–${(r.withS || r.base).p90}.</span></div>
    </div>
    ${sparkline(r.base.cumDaily, r.withS?.cumDaily)}
    <div class="kicker sub">Why this house</div>
    <div class="drivers"><i class="bg" style="width:${dr.background / drTot * 100}%"></i><i class="own"
      style="width:${dr.self / drTot * 100}%"></i><i class="nb" style="width:${dr.neighbours / drTot * 100}%"></i></div>
    <p class="note"><i class="sw bg"></i>its own record ${dr.background.toFixed(2)} <i class="sw own"></i>its past reports
      ${dr.self.toFixed(2)} <i class="sw nb"></i>neighbours' reports ${dr.neighbours.toFixed(2)} (expected reports, 90 days)</p>
    <ol class="why">${dr.top.slice(0, 5).map(t => `<li><span>${EV_KIND[t.kind]}</span><span>${t.self ? 'this house' : t.d + ' m away'},
      ${t.age} days ago</span><b>+${t.v.toFixed(3)}</b></li>`).join('') || '<li class="muted">No reports within 250 m in 180 days.</li>'}</ol>
    <div class="acts">
      <button id="stab" class="${stabilized ? 'on' : ''}">${stabilized ? 'stabilized · undo' : 'stabilize this house'}</button>
      <button id="fb" ${H.busy ? 'disabled' : ''}>find 3 firebreaks</button>
      ${H.stab.length ? '<button id="clear">clear</button>' : ''}
    </div>
    ${H.status ? `<p class="muted small">${esc(H.status)}</p>` : ''}
    ${H.fb ? `<div class="kicker sub">Firebreaks: where fixing one house spares the most others</div>
    <ol class="picks">${H.fb.picks.map(p => `<li data-g="${p.g}"><span>${CLASS_NAME[b.class[p.g]]} ${p.g.toLocaleString()}</span>
      <span>${p.own.toFixed(2)} own</span><b>${p.spread.toFixed(2)} spared</b></li>`).join('')}</ol>
    <p class="note">${H.fb.evals} scenarios scored with exact expected counts (lazy greedy over the ${H.fb.candidates} most active
      houses). "Spared": reports prevented at <em>other</em> houses.</p>` : ''}
    ${r.withS ? `<div class="proof one"><div><b>${kusd(r.protectedUsd)}</b><span>neighbour value protected:
      ${r.prevented.toFixed(1)} fewer reports in simulation, each distressed house costing 0.9% of residential value within 200 m
      (Immergluck &amp; Smith 2006).</span></div></div>` : ''}
    <p class="note">Stabilize means the house stops producing reports and its past reports stop pushing on neighbours:
      repairs, a code fix, or a WHOLZR buy-and-rehab (homesteads get help first). Same random seeds for every scenario,
      so the difference is the intervention, not luck.</p>`}`;
  $('house-close').onclick = actions.close;
  if (!r) return;
  $('stab').onclick = actions.toggle;
  $('fb').onclick = actions.firebreaks;
  if ($('clear')) $('clear').onclick = actions.clear;
  document.querySelectorAll('.picks li').forEach(li => { li.onclick = () => actions.fly(+li.dataset.g); });
}
