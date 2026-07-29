// DOM UI: period selector, hover tooltip, and legend. Kept separate from the
// Three.js scene so the 3D code stays focused on rendering.
import { changeColorCss } from './color.js';

export function buildPeriodBar(el, periods, current, onSelect) {
  el.innerHTML = '';
  const buttons = new Map();
  for (const p of periods) {
    const b = document.createElement('button');
    b.className = 'period-btn';
    b.textContent = p;
    b.setAttribute('aria-pressed', String(p === current));
    if (p === current) b.classList.add('active');
    b.addEventListener('click', () => {
      if (b.classList.contains('active')) return;
      setActive(p);
      onSelect(p);
    });
    el.appendChild(b);
    buttons.set(p, b);
  }
  function setActive(p) {
    for (const [key, btn] of buttons) {
      const on = key === p;
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
// 0% = solid (opacity 1), 100% = maximally see-through (opacity MIN_OPACITY).
// `onChange` receives the resulting bar opacity in (0,1].
const MIN_OPACITY = 0.07;
export function buildOpacityControl(el, onChange) {
  const input = el.querySelector('#opacity');
  const out = el.querySelector('#opacity-val');
  const apply = () => {
    const t = Math.round(+input.value);            // transparency %
    out.textContent = t + '%';
    onChange(1 - (t / 100) * (1 - MIN_OPACITY));    // → opacity
  };
  input.addEventListener('input', apply);
  apply();
  return { set(t) { input.value = String(t); apply(); } };
}

export function buildLegend(el) {
  el.innerHTML =
    `<div class="lg-title">日経平均 3D ヒートマップ</div>` +
    `<div class="lg-enc"><b>高さ</b> = 騰落率（0%基準・上=プラス/下=マイナス）</div>` +
    `<div class="lg-enc"><b>面積</b> = 寄与度</div>` +
    `<div class="lg-scale"><span class="down">下落</span>` +
    `<span class="lg-grad"></span><span class="up">上昇</span></div>` +
    `<div class="lg-hint">ドラッグで回転・ホイールで拡大縮小</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
