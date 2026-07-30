// DOM UI: period selector, hover tooltip, and legend. Kept separate from the
// Three.js scene so the 3D code stays focused on rendering.
import { changeColorCss } from './color.js';

export function buildPeriodBar(el, periods, current, onSelect) {
  return buildPillBar(el, periods.map((p) => [p, p]), current, onSelect);
}

// Index switcher (NIKKEI / DOW30 / NASDAQ 100). `indices` are keys; `meta` maps
// each key to { label }. Same pill styling as the period bar.
export function buildIndexBar(el, indices, current, meta, onSelect) {
  return buildPillBar(el, indices.map((k) => [k, (meta[k] && meta[k].label) || k]), current, onSelect);
}

// Language toggle (日本語 / EN). Same pill styling.
export function buildLangBar(el, langs, current, labelOf, onSelect) {
  return buildPillBar(el, langs.map((l) => [l, labelOf(l)]), current, onSelect);
}

// Shared pill-button group. `items` = [[value, label], ...].
function buildPillBar(el, items, current, onSelect) {
  el.innerHTML = '';
  const buttons = new Map();
  for (const [value, label] of items) {
    const b = document.createElement('button');
    b.className = 'period-btn';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(value === current));
    if (value === current) b.classList.add('active');
    b.addEventListener('click', () => {
      if (b.classList.contains('active')) return;
      setActive(value);
      onSelect(value);
    });
    el.appendChild(b);
    buttons.set(value, b);
  }
  function setActive(value) {
    for (const [key, btn] of buttons) {
      const on = key === value;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
  }
  return { setActive };
}

// `ctx` supplies language-aware helpers: strings() → the current UI string table,
// nameFor(data) → display name, sectorFor(sector) → display sector.
export function createTooltip(parent, ctx) {
  const el = document.createElement('div');
  el.className = 'tooltip';
  el.style.display = 'none';
  parent.appendChild(el);
  return {
    show(data, cap, x, y) {
      const s = ctx.strings();
      const up = data.changePct >= 0;
      const pct = (up ? '+' : '') + data.changePct.toFixed(2) + '%';
      const contrib = (data.contribution >= 0 ? '+' : '') + data.contribution.toFixed(2);
      const sw = changeColorCss(data.changePct, cap);
      el.innerHTML =
        `<div class="tt-head"><span class="tt-swatch" style="background:${sw}"></span>` +
        `<span class="tt-name">${escapeHtml(ctx.nameFor(data))}</span>` +
        `<span class="tt-code">${escapeHtml(data.code)}</span></div>` +
        `<div class="tt-sector">${escapeHtml(ctx.sectorFor(data.sector))}</div>` +
        `<div class="tt-row"><span>${escapeHtml(s.ttChange)}</span><b class="${up ? 'up' : 'down'}">${pct}</b></div>` +
        `<div class="tt-row"><span>${escapeHtml(s.ttContribution)}</span><b class="${data.contribution >= 0 ? 'up' : 'down'}">${contrib}</b></div>`;
      el.style.display = 'block';
      this.move(x, y);
    },
    move(x, y) {
      const pad = 14;
      const w = el.offsetWidth, h = el.offsetHeight;
      let left = x + pad, top = y + pad;
      if (left + w > window.innerWidth) left = x - w - pad;
      if (top + h > window.innerHeight) top = y - h - pad;
      el.style.left = left + 'px';
      el.style.top = top + 'px';
    },
    hide() { el.style.display = 'none'; },
  };
}

// Wires up the transparency slider. The slider value is TRANSPARENCY in %:
// 0% = solid, higher = more see-through, top of the range = X-ray (outline only).
// `onChange` receives the transparency fraction in [0,1]; the heatmap maps it to
// fill opacity / X-ray mode.
// `strings` is a getter returning the current UI string table (for the X-ray suffix).
export function buildOpacityControl(el, onChange, strings) {
  const input = el.querySelector('#opacity');
  const out = el.querySelector('#opacity-val');
  const apply = () => {
    const t = Math.round(+input.value);   // transparency %
    out.textContent = t >= 85 ? `${t}% · ${strings().xray}` : `${t}%`;
    onChange(t / 100);
  };
  input.addEventListener('input', apply);
  apply();
  return { set(t) { input.value = String(t); apply(); }, refresh: apply };
}

// Toggle that flips the vertical direction of bars. `onChange` receives a boolean
// (true = inverted: plus down / minus up). `strings` is a getter for the labels.
export function buildInvertToggle(el, onChange, strings) {
  const btn = el.querySelector('#invert');
  let inverted = false;
  const render = () => {
    const s = strings();
    btn.textContent = inverted ? s.invertOn : s.invertOff;
    btn.classList.toggle('active', inverted);
    btn.setAttribute('aria-pressed', String(inverted));
  };
  btn.addEventListener('click', () => { inverted = !inverted; render(); onChange(inverted); });
  render();
  return { get() { return inverted; }, render };
}

// Single legend renderer, driven by { strings, title, inverted }. Called on init
// and whenever the language, index (title) or invert state changes.
export function renderLegend(el, { strings, title, inverted }) {
  const dir = inverted ? strings.dirDown : strings.dirUp;
  el.innerHTML =
    `<div class="lg-title">${escapeHtml(title)}</div>` +
    `<div class="lg-enc" id="lg-dir">${strings.legHeight.replace('{dir}', escapeHtml(dir))}</div>` +
    `<div class="lg-enc">${strings.legArea}</div>` +
    `<div class="lg-scale"><span class="down">${escapeHtml(strings.down)}</span>` +
    `<span class="lg-grad"></span><span class="up">${escapeHtml(strings.up)}</span></div>` +
    `<div class="lg-hint">${escapeHtml(strings.hint)}</div>`;
}

// ---- snapshot & share -------------------------------------------------------
// Camera button (📷) captures + shares the current view; a small cluster of
// X / LINE / copy-link buttons shares the CTA text + URL. `strings` is a getter.
// Handlers are async; buttons are disabled while a capture is in flight.
const CAMERA_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 7h3l1.3-2h7.4L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/>' +
  '<circle cx="12" cy="13" r="3.4"/></svg>';

export function buildShareControls(el, { strings, onCamera, onX, onLine, onCopy }) {
  el.innerHTML = '';
  const s = strings();

  const cam = document.createElement('button');
  cam.className = 'share-cam';
  cam.type = 'button';
  cam.innerHTML = CAMERA_SVG;
  cam.title = s.shareOpen;
  cam.setAttribute('aria-label', s.shareOpen);

  const row = document.createElement('div');
  row.className = 'share-row';
  const mk = (label, title, handler) => {
    const b = document.createElement('button');
    b.className = 'share-mini';
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', () => handler && handler());
    return b;
  };
  row.appendChild(mk(s.shareX, 'X', onX));
  row.appendChild(mk(s.shareLine, 'LINE', onLine));
  row.appendChild(mk('🔗', s.shareCopy, onCopy));

  let busy = false;
  cam.addEventListener('click', async () => {
    if (busy || !onCamera) return;
    busy = true;
    cam.disabled = true;
    try { await onCamera(); } finally { busy = false; cam.disabled = false; }
  });

  el.appendChild(cam);
  el.appendChild(row);

  return {
    refresh() {
      const t = strings();
      cam.title = t.shareOpen;
      cam.setAttribute('aria-label', t.shareOpen);
      const minis = row.querySelectorAll('.share-mini');
      minis[0].textContent = t.shareX; minis[0].title = 'X';
      minis[1].textContent = t.shareLine; minis[1].title = 'LINE';
      minis[2].title = t.shareCopy;
    },
  };
}

// Small transient toast, bottom-center-ish. Returns { show(msg) }.
export function createToast(parent) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.display = 'none';
  parent.appendChild(el);
  let timer = null;
  return {
    show(msg, ms = 2200) {
      el.textContent = msg;
      el.style.display = 'block';
      el.classList.add('show');
      clearTimeout(timer);
      timer = setTimeout(() => { el.classList.remove('show'); setTimeout(() => { el.style.display = 'none'; }, 250); }, ms);
    },
  };
}

// ---- timeline (last-N-sessions) animation bar -------------------------------
// Play/pause + a scrubber over `frameCount` frames + a date label. `onPlayToggle`
// fires on the play button; `onSeek(i)` on scrubbing. Main owns playback state and
// calls setPlaying / setFrame back. `strings` is a getter.
export function buildTimelineBar(el, { strings, frameCount, onPlayToggle, onSeek }) {
  el.innerHTML = '';
  const s = strings();

  const label = document.createElement('span');
  label.className = 'tl-label';
  label.textContent = s.tlLabel;

  const play = document.createElement('button');
  play.className = 'tl-play';
  play.type = 'button';
  play.setAttribute('aria-label', s.tlPlay);

  const slider = document.createElement('input');
  slider.className = 'tl-slider';
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(Math.max(frameCount - 1, 0));
  slider.step = '1';
  slider.value = '0';
  slider.setAttribute('aria-label', s.tlLabel);

  const date = document.createElement('span');
  date.className = 'tl-date';
  date.textContent = '';

  let playing = false;
  const renderPlay = () => {
    play.innerHTML = playing ? '<span class="tl-ico">❚❚</span>' : '<span class="tl-ico">▶</span>';
    play.setAttribute('aria-label', playing ? strings().tlPause : strings().tlPlay);
  };
  renderPlay();

  play.addEventListener('click', () => onPlayToggle && onPlayToggle());
  slider.addEventListener('input', () => onSeek && onSeek(Number(slider.value)));

  el.appendChild(label);
  el.appendChild(play);
  el.appendChild(slider);
  el.appendChild(date);

  return {
    setPlaying(v) { playing = v; renderPlay(); },
    setFrame(i, dateStr) { slider.value = String(i); if (dateStr != null) date.textContent = dateStr; },
    setFrameCount(n) { slider.max = String(Math.max(n - 1, 0)); },
    setEnabled(v) { play.disabled = !v; slider.disabled = !v; el.classList.toggle('disabled', !v); },
    refresh() {
      const t = strings();
      label.textContent = t.tlLabel;
      slider.setAttribute('aria-label', t.tlLabel);
      renderPlay();
    },
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
