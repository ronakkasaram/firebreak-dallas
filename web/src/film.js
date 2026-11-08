// Film mode: the guided tour, full screen and without the console's chrome, opened and closed by a
// title card. It exists so anyone can record a clean promo of the real product with a screen recorder:
// press F, record, press Esc. Nothing in the film is staged; each shot is the live console.

let F = null;

export const filmActive = () => !!F;

function card(c, cls) {
  const el = document.createElement('div');
  el.className = `film-card ${cls}`;
  el.innerHTML = `<div class="fc-in">
    <div class="fc-k"><svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true"><rect x="1" y="1" width="6" height="16" rx="1" fill="#dd513a"/><rect x="11" y="1" width="6" height="16" rx="1" fill="#33363d"/></svg>${c.kicker}</div>
    <h1>${c.title}</h1><p>${c.sub}</p></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  return el;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

export async function startFilm({ open, close, run, stop }) {
  if (F) return;
  F = { stop, els: [], done: false };
  document.body.classList.add('film');
  try { await document.documentElement.requestFullscreen?.(); } catch { /* not allowed here: the film still plays in the window */ }
  window.dispatchEvent(new Event('resize'));
  const me = F;
  const a = card(open, 'open'); me.els.push(a);
  await wait(3800); if (F !== me) return;
  a.classList.remove('in'); await wait(500); a.remove();
  run(async () => {
    if (F !== me || me.done) return;
    const z = card(close, 'close'); me.els.push(z);
    await wait(5200);
    if (F === me) stopFilm();
  });
}

export function stopFilm() {
  if (!F) return;
  const f = F; F = null; f.done = true;
  f.els.forEach(e => e.remove());
  document.body.classList.remove('film');
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  f.stop?.();
  window.dispatchEvent(new Event('resize'));
}
