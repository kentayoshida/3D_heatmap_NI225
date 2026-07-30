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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
