// Resolution playbook: an agent that runs the console's own tools, one visible step at a time, to turn an
// alarm into a costed, routed case that waits for a person to approve it.
//
// It is an agent in the plain sense (a plan of tool calls, each one reading the last one's result), not a
// language model: every step calls the same functions a person would click, and every number in its log
// comes from those functions. This file only draws the card and runs the steps in order; the steps
// themselves live in main.js, where the console's state is.

let P = null;

export const playbookActive = () => !!P;

export function startPlaybook(title, steps, { onDone, onClose }) {
  stopPlaybook();
  const el = document.createElement('div');
  el.id = 'playbook';
  el.className = 'playbook card';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-live', 'polite');
  document.getElementById('stage').appendChild(el);
  P = { title, steps, el, log: steps.map(s => ({ name: s.name, tool: s.tool, state: 'wait', out: '' })), onClose, ctx: {}, cancelled: false, summary: null };
  el.addEventListener('click', ev => {
    const a = ev.target.closest('button')?.dataset.a;
    if (a === 'close') stopPlaybook();
  });
  draw();
  run(onDone);
}

export function stopPlaybook() {
  if (!P) return;
  P.cancelled = true;
  P.el.remove();
  const f = P.onClose; P = null;
  f?.();
}

async function run(onDone) {
  const me = P;
  for (let k = 0; k < me.steps.length; k++) {
    if (me.cancelled) return;
    me.log[k].state = 'run'; draw();
    try {
      const out = await me.steps[k].run(me.ctx);
      if (me.cancelled) return;
      me.log[k].state = 'ok'; me.log[k].out = out || '';
    } catch (err) {
      me.log[k].state = 'err'; me.log[k].out = String(err?.message || err);
      draw(); return;
    }
    draw();
  }
  if (me.cancelled) return;
  me.summary = onDone(me.ctx);
  draw();
}

function draw() {
  if (!P) return;
  const done = P.log.filter(l => l.state === 'ok').length;
  P.el.innerHTML = `
    <div class="pb-top"><span class="pb-tag">Playbook</span><b>${P.title}</b><span class="pb-n">${done} / ${P.log.length}</span>
      <button data-a="close" aria-label="Close playbook">Esc</button></div>
    <ol class="pb-steps">${P.log.map(l => `<li class="${l.state}"><i></i><div><b>${l.name}</b> <code>${l.tool}</code>${l.out ? `<small>${l.out}</small>` : ''}</div></li>`).join('')}</ol>
    ${P.summary ? `<div class="pb-sum">${P.summary.html}</div>` : ''}`;
  if (P.summary?.wire) P.summary.wire(P.el);
}
