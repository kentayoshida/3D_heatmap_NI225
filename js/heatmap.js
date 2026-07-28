// Builds and maintains the 3D field of bars from constituent data.
// Footprint (w×d) comes from the treemap (area ∝ |contribution|); height and
// color come from change%. Positive bars rise above the y=0 plane, negative bars
// sink below it. Period changes animate each bar's size / position / color.
import * as THREE from 'three';
import { layoutTreemap } from './treemap.js';
import { changeColor } from './color.js';

const FONT = '"Noto Sans CJK JP","Noto Sans JP","Hiragino Sans","Yu Gothic",Meiryo,sans-serif';

const BOX_GAP = 0.14;   // shrink each bar slightly so neighbors read as separate
const H_MIN = 0.35;     // floor height so ~0% bars are still a visible slab
const H_SPAN = 22;      // world height of a fully-saturated bar
const H_OVER = 1.35;    // let outliers beyond the cap overshoot a little
const TWEEN_DUR = 0.7;  // seconds

const lerp = (a, b, k) => a + (b - a) * k;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class Heatmap {
  constructor(scene, { W = 100, D = 70 } = {}) {
    this.scene = scene;
    this.W = W;
    this.D = D;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1);
    this.meshes = [];            // pickable bar meshes
    this.byCode = new Map();
    this.labelGroup = new THREE.Group();
    this.group.add(this.labelGroup);
    this.cap = 3;
    this.opacity = 1;
    this.highlighted = null;
  }

  get pickables() { return this.meshes; }

  /** User-adjustable bar transparency. v in [0,1] (1 = opaque). */
  setOpacity(v) {
    this.opacity = v;
    for (const m of this.meshes) this._applyOpacity(m);
  }

  _applyOpacity(m) {
    const translucent = this.opacity < 0.999;
    m.material.opacity = this.opacity;
    m.material.transparent = translucent;
    m.material.depthWrite = !translucent; // see-through when translucent
  }

  _cap(constituents) {
    const arr = constituents.map((c) => Math.abs(c.changePct)).filter((v) => v > 0).sort((a, b) => a - b);
    if (!arr.length) return 3;
    return Math.max(arr[Math.floor(arr.length * 0.9)], 1.5);
  }

  _height(pct, cap) {
    return H_MIN + Math.min(Math.abs(pct) / cap, H_OVER) * H_SPAN;
  }

  /** Rebuild the field from a period's constituents. */
  setData(constituents, { animate = true } = {}) {
    const cap = this._cap(constituents);
    this.cap = cap;
    const { stocks, sectors } = layoutTreemap(constituents, this.W, this.D);
    const targets = new Map(stocks.map((s) => [s.code, s]));

    // drop bars no longer present
    for (let i = this.meshes.length - 1; i >= 0; i--) {
      const m = this.meshes[i];
      if (!targets.has(m.userData.code)) {
        this.group.remove(m);
        m.material.dispose();
        this.meshes.splice(i, 1);
        this.byCode.delete(m.userData.code);
      }
    }

    for (const s of stocks) {
      const height = this._height(s.changePct, cap);
      const sign = s.changePct >= 0 ? 1 : -1;
      const w = Math.max(s.w - BOX_GAP, 0.05);
      const d = Math.max(s.d - BOX_GAP, 0.05);
      const color = changeColor(s.changePct, cap);
      const to = { sx: w, sy: height, sz: d, px: s.x, py: (sign * height) / 2, pz: s.z, color };

      let m = this.byCode.get(s.code);
      if (!m) {
        m = new THREE.Mesh(this.boxGeo, new THREE.MeshLambertMaterial({ color }));
        m.scale.set(w, 0.01, d);      // grow in from flat
        m.position.set(s.x, 0, s.z);
        this.group.add(m);
        this.meshes.push(m);
        this.byCode.set(s.code, m);
      }
      m.userData = { ...s, cap, baseColor: color.clone() };
      this._applyOpacity(m);

      if (animate) {
        m._tween = {
          from: {
            sx: m.scale.x, sy: m.scale.y, sz: m.scale.z,
            px: m.position.x, py: m.position.y, pz: m.position.z,
            color: m.material.color.clone(),
          },
          to, t: 0,
        };
      } else {
        m.scale.set(to.sx, to.sy, to.sz);
        m.position.set(to.px, to.py, to.pz);
        m.material.color.copy(color);
        m._tween = null;
      }
    }

    this._buildLabels(stocks, sectors, cap);
  }

  /** Advance tweens. dt in seconds. */
  update(dt) {
    if (this.highlighted && this.highlighted._tween) {
      // don't fight a tween on the hovered bar; highlight re-applies each frame
    }
    for (const m of this.meshes) {
      const tw = m._tween;
      if (!tw) continue;
      tw.t = Math.min(1, tw.t + dt / TWEEN_DUR);
      const k = easeInOut(tw.t);
      const { from, to } = tw;
      m.scale.set(lerp(from.sx, to.sx, k), lerp(from.sy, to.sy, k), lerp(from.sz, to.sz, k));
      m.position.set(lerp(from.px, to.px, k), lerp(from.py, to.py, k), lerp(from.pz, to.pz, k));
      if (m !== this.highlighted) m.material.color.copy(from.color).lerp(to.color, k);
      m.userData.baseColor = from.color.clone().lerp(to.color, k);
      if (tw.t >= 1) m._tween = null;
    }
  }

  highlight(mesh) {
    if (this.highlighted === mesh) return;
    this.clearHighlight();
    if (!mesh) return;
    this.highlighted = mesh;
    mesh.material.emissive = new THREE.Color(0xffffff);
    mesh.material.emissiveIntensity = 0.35;
  }

  clearHighlight() {
    const m = this.highlighted;
    if (!m) return;
    if (m.material.emissive) m.material.emissive.setHex(0x000000);
    this.highlighted = null;
  }

  // ---- labels --------------------------------------------------------------
  _clearLabels() {
    for (let i = this.labelGroup.children.length - 1; i >= 0; i--) {
      const sp = this.labelGroup.children[i];
      this.labelGroup.remove(sp);
      if (sp.material.map) sp.material.map.dispose();
      sp.material.dispose();
    }
  }

  _buildLabels(stocks, sectors, cap) {
    this._clearLabels();
    const SECTOR_Y = H_MIN + H_SPAN * 1.12; // hover sector headers above the skyline

    // sector headers — small pills floating above each district
    for (const sec of sectors) {
      if (sec.w < 7 || sec.d < 5) continue; // skip tiny districts
      const sp = this._textSprite({ title: sec.sector, bg: 'rgba(10,14,22,0.62)', color: '#cbd5e8', fontSize: 26 });
      const worldW = Math.min(sec.w * 0.5, 8);
      sp.scale.set(worldW, worldW / sp.userData.aspect, 1);
      sp.position.set(sec.cx, SECTOR_Y, sec.cz);
      sp.renderOrder = 3;
      this.labelGroup.add(sp);
    }

    // stock labels — the largest bars only, ranked by footprint area
    const ranked = stocks
      .filter((s) => s.w >= 4.6 && s.d >= 2.8)
      .sort((a, b) => b.w * b.d - a.w * a.d)
      .slice(0, 34);
    for (const s of ranked) {
      const sign = s.changePct >= 0 ? 1 : -1;
      const height = this._height(s.changePct, cap);
      const topY = Math.max(0, sign * height);
      const pctTxt = (s.changePct >= 0 ? '+' : '') + s.changePct.toFixed(2) + '%';
      const sp = this._textSprite({ title: s.name, sub: pctTxt, color: '#ffffff', subColor: '#e4ebf7', fontSize: 30 });
      const worldW = Math.min(Math.max(s.w * 0.78, 4), 16);
      sp.scale.set(worldW, worldW / sp.userData.aspect, 1);
      sp.position.set(s.x, topY + (worldW / sp.userData.aspect) / 2 + 0.3, s.z);
      sp.renderOrder = 4;
      this.labelGroup.add(sp);
    }
  }

  _textSprite({ title, sub, bg = null, color = '#fff', subColor = '#dfe6f2', fontSize = 30 }) {
    const dpr = 2;
    const fs = fontSize;
    const subfs = Math.round(fontSize * 0.78);
    const pad = 14;
    const gap = sub ? 6 : 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `700 ${fs}px ${FONT}`;
    const w1 = ctx.measureText(title).width;
    let w2 = 0;
    if (sub) { ctx.font = `600 ${subfs}px ${FONT}`; w2 = ctx.measureText(sub).width; }
    const textW = Math.max(w1, w2);
    const textH = fs + (sub ? subfs + gap : 0);
    const cw = Math.ceil(textW + pad * 2);
    const ch = Math.ceil(textH + pad * 2);
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    ctx.scale(dpr, dpr);

    if (bg) {
      const r = 8;
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.arcTo(cw, 0, cw, ch, r);
      ctx.arcTo(cw, ch, 0, ch, r);
      ctx.arcTo(0, ch, 0, 0, r);
      ctx.arcTo(0, 0, cw, 0, r);
      ctx.closePath();
      ctx.fill();
    }
    // subtle shadow for legibility over any bar color
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 4;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;
    ctx.font = `700 ${fs}px ${FONT}`;
    ctx.fillText(title, cw / 2, pad);
    if (sub) {
      ctx.fillStyle = subColor;
      ctx.font = `600 ${subfs}px ${FONT}`;
      ctx.fillText(sub, cw / 2, pad + fs + gap);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.userData.aspect = cw / ch;
    return sp;
  }
}
