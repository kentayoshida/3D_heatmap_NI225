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

export function createTooltip(parent) {
  const el = document.createElement('div');
  el.className = 'tooltip';
  el.style.display = 'none';
  parent.appendChild(el);
  return {
    show(data, cap, x, y) {
      const up = data.changePct >= 0;
      const pct = (up ? '+' : '') + data.changePct.toFixed(2) + '%';
      const contrib = (data.contribution >= 0 ? '+' : '') + data.contribution.toFixed(2);
      const sw = changeColorCss(data.changePct, cap);
      el.innerHTML =
        `<div class="tt-head"><span class="tt-swatch" style="background:${sw}"></span>` +
        `<span class="tt-name">${escapeHtml(data.name)}</span>` +
        `<span class="tt-code">${escapeHtml(data.code)}</span></div>` +
        `<div class="tt-sector">${escapeHtml(data.sector)}</div>` +
        `<div class="tt-row"><span>騰落率</span><b class="${up ? 'up' : 'down'}">${pct}</b></div>` +
        `<div class="tt-row"><span>寄与度</span><b class="${data.contribution >= 0 ? 'up' : 'down'}">${contrib}</b></div>`;
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
export function buildOpacityControl(el, onChange) {
  const input = el.querySelector('#opacity');
  const out = el.querySelector('#opacity-val');
  const apply = () => {
    const t = Math.round(+input.value);   // transparency %
    out.textContent = t >= 85 ? `${t}% · X線` : `${t}%`;
    onChange(t / 100);
  };
  input.addEventListener('input', apply);
  apply();
  return { set(t) { input.value = String(t); apply(); } };
}

// Toggle that flips the vertical direction of bars. `onChange` receives a boolean
// (true = inverted: plus down / minus up).
export function buildInvertToggle(el, onChange) {
  const btn = el.querySelector('#invert');
  let inverted = false;
  const render = () => {
    btn.textContent = inverted ? 'プラス下 / マイナス上' : 'プラス上 / マイナス下';
    btn.classList.toggle('active', inverted);
    btn.setAttribute('aria-pressed', String(inverted));
  };
  btn.addEventListener('click', () => { inverted = !inverted; render(); onChange(inverted); });
  render();
  return { get() { return inverted; } };
}

export function buildLegend(el, title = '3D ヒートマップ') {
  el.innerHTML =
    `<div class="lg-title" id="lg-title">${escapeHtml(title)}</div>` +
    `<div class="lg-enc" id="lg-dir"><b>高さ</b> = 騰落率（0%基準・上=プラス/下=マイナス）</div>` +
    `<div class="lg-enc"><b>面積</b> = 寄与度</div>` +
    `<div class="lg-scale"><span class="down">下落</span>` +
    `<span class="lg-grad"></span><span class="up">上昇</span></div>` +
    `<div class="lg-hint">ドラッグで回転・ホイールで拡大縮小</div>`;
}

// Update just the legend title (on index switch) without rebuilding the panel.
export function setLegendTitle(title) {
  const el = document.getElementById('lg-title');
  if (el) el.textContent = title;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
