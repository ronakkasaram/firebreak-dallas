// Guided tour: a scripted walk through the console for a two-minute judging slot or a first-time
// visitor. Steps come from main.js (each one drives the real console); this file only runs the clock
// and draws the caption card. Every number in a caption is read from the pipeline's files.

let T = null;

export const tourActive = () => !!T;

export function startTour(steps, onEnd = () => {}) {
  stopTour();
  const el = document.createElement('div');
  el.id = 'tour';
  el.className = 'tour card';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-live', 'polite');
  document.getElementById('stage').appendChild(el);
  T = { steps, k: -1, timer: 0, paused: false, el, onEnd };
  el.addEventListener('click', ev => {
    const a = ev.target.closest('button')?.dataset.a;
    if (a === 'next') go(T.k + 1);
    if (a === 'prev') go(Math.max(0, T.k - 1));
    if (a === 'pause') { T.paused = !T.paused; T.paused ? clearTimeout(T.timer) : go(T.k, true); draw(); }
    if (a === 'exit') stopTour();
  });
  go(0);
}

export function stopTour() {
  if (!T) return;
  clearTimeout(T.timer);
  T.el.remove();
  const end = T.onEnd;
  T = null;
  end();
}

function go(k, resume = false) {
  if (!T) return;
  clearTimeout(T.timer);
  if (k >= T.steps.length) { stopTour(); return; }
  const st = T.steps[k];
  if (!resume) { T.k = k; T.paused = false; st.run(); }
  draw();
  T.timer = setTimeout(() => go(T.k + 1), st.ms);
}

function draw() {
  const st = T.steps[T.k], n = T.steps.length;
  T.el.innerHTML = `
    <div class="tour-top"><span class="tour-n">${T.k + 1} / ${n}</span><b>${st.title}</b>
      <span class="tour-btns">
        <button data-a="prev" ${T.k === 0 ? 'disabled' : ''} aria-label="Previous step">‹</button>
        <button data-a="pause" aria-label="${T.paused ? 'Resume' : 'Pause'}">${T.paused ? '▶' : '❚❚'}</button>
        <button data-a="next" aria-label="Next step">›</button>
        <button data-a="exit" aria-label="End tour">Esc</button>
      </span></div>
    <p>${st.text()}</p>
    <div class="tour-bar"><i style="animation-duration:${st.ms}ms;animation-play-state:${T.paused ? 'paused' : 'running'}"></i></div>
    <div class="tour-dots">${T.steps.map((_, i) => `<i class="${i < T.k ? 'done' : i === T.k ? 'on' : ''}"></i>`).join('')}</div>`;
}
