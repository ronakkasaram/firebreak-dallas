// Cases: what the resolution playbook hands to a person, and what happens to it afterwards.
//
// A case is opened when someone holds Approve at the end of a playbook. It then moves through three
// states, each one logged with a time: approved (the plan is signed off), dispatched (a crew has the
// route), resolved (the crew reported back, with an outcome). Nothing here talks to another system: the
// inbox lives in this browser's localStorage, so a deployment would swap these four functions for a
// shared store and keep the rest of the console unchanged.

import { store } from './panels.js';

const KEY = 'fb-cases';

export const STATUS = ['approved', 'dispatched', 'resolved'];
export const STATUS_LABEL = { approved: 'Approved', dispatched: 'Crew dispatched', resolved: 'Resolved' };
export const NEXT = { approved: { to: 'dispatched', label: 'Mark crew dispatched' }, dispatched: { to: 'resolved', label: 'Mark resolved' } };

// Earlier builds stored only { id: approvedAt }. Keep those, as approved cases with no detail.
function read() {
  const raw = store(KEY) || {};
  const out = {};
  for (const [id, v] of Object.entries(raw)) {
    out[id] = typeof v === 'string'
      ? { id, title: `Case ${id}`, status: 'approved', opened: v, log: [{ t: v, what: 'Approved' }] }
      : v;
  }
  return out;
}

export function listCases() {
  return Object.values(read()).sort((a, b) => (STATUS.indexOf(a.status) - STATUS.indexOf(b.status)) || b.opened.localeCompare(a.opened));
}

export function getCase(id) { return read()[id] || null; }

export function openCase(c) {
  const all = read(), t = new Date().toISOString();
  all[c.id] = { ...c, status: 'approved', opened: t, log: [{ t, what: 'Approved from the resolution playbook' }] };
  store(KEY, all);
  return all[c.id];
}

export function advanceCase(id, note = '') {
  const all = read(), c = all[id]; if (!c || !NEXT[c.status]) return c;
  const t = new Date().toISOString(), to = NEXT[c.status].to;
  c.status = to;
  c.log.push({ t, what: STATUS_LABEL[to] + (note ? `: ${note}` : '') });
  if (to === 'resolved') c.outcome = note;
  store(KEY, all);
  return c;
}

export function removeCase(id) { const all = read(); delete all[id]; store(KEY, all); }

const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
export function casesCSV() {
  const rows = listCases();
  const head = ['id', 'title', 'status', 'opened', 'work_orders', 'cost_usd', 'reports_prevented', 'route_km', 'origin', 'outcome', 'route_link'];
  return [head.join(','), ...rows.map(c => [c.id, c.title, c.status, c.opened, c.workOrders ?? '', c.cost != null ? Math.round(c.cost) : '',
    c.prevented != null ? c.prevented.toFixed(2) : '', c.km != null ? c.km.toFixed(2) : '', c.origin ?? '', c.outcome ?? '', c.link ?? ''].map(q).join(','))].join('\n');
}
