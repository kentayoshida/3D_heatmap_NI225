// Change-% → color. finviz / nikkei225jp convention: green = up, red = down,
// near-0 = neutral slate. `cap` saturates the gradient (usually a per-period
// percentile of |change%|) so a quiet day and a volatile year both read well.
import * as THREE from 'three';

const NEUTRAL = new THREE.Color(0x2c313c); // ~0%
const UP_MID = new THREE.Color(0x2f9e57);
const UP_HI = new THREE.Color(0x21d367);
const DOWN_MID = new THREE.Color(0xb23a3a);
const DOWN_HI = new THREE.Color(0xf5443a);

/**
 * @param {number} pct   change in %
 * @param {number} cap   saturation cap in % (>0)
 * @returns {THREE.Color}
 */
export function changeColor(pct, cap) {
  const t = Math.min(Math.abs(pct) / (cap || 1), 1);
  const mid = pct >= 0 ? UP_MID : DOWN_MID;
  const hi = pct >= 0 ? UP_HI : DOWN_HI;
  // neutral -> mid over first half, mid -> hi over second half
  if (t < 0.5) return NEUTRAL.clone().lerp(mid, t / 0.5);
  return mid.clone().lerp(hi, (t - 0.5) / 0.5);
}

// CSS color string, for HTML UI (legend, tooltip swatches).
export function changeColorCss(pct, cap) {
  return '#' + changeColor(pct, cap).getHexString();
}
