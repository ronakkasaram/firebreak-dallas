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
  }[mode];
  $('legend').innerHTML = items.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
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
      <li><span>Rent at risk</span><b>${usd(h.usd.rent_at_risk)}</b></li>
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
