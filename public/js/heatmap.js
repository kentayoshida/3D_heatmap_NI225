// Builds and maintains the 3D field of bars from constituent data.
// Footprint (w×d) comes from the treemap (area ∝ index weight%); height is (nearly)
// linear in change% and color comes from change%, so a bar's volume (area × height)
// reads as its 寄与度 (weight × change). Positive bars rise above the y=0 plane,
// negative bars sink below it. Period changes animate size / position / color.
import * as THREE from 'three';
import { layoutTreemap } from './treemap.js';
import { changeColor } from './color.js';

const FONT = '"Noto Sans CJK JP","Noto Sans JP","Hiragino Sans","Yu Gothic",Meiryo,sans-serif';

const BOX_GAP = 0.14;   // shrink each bar slightly so neighbors read as separate
// Height is (near-)linear in change% so volume (area × height) ≈ 寄与度: a tiny
// floor keeps ~0% bars pickable/visible, and a generous overshoot clamps only true
// outliers (so one earnings pop doesn't crush the rest of the scale).
const H_MIN = 0.15;     // floor height so ~0% bars are still a pickable slab
const H_SPAN = 22;      // world height at the saturation cap
const H_OVER = 2.4;     // let outliers beyond the cap overshoot (loose clamp)
const TWEEN_DUR = 0.7;  // seconds
const FILL_MIN = 0.07;          // fill opacity at the top of the glass range
const XRAY_AT = 0.85;           // slider fraction at/above which X-ray (outline) mode kicks in
const XRAY_FACE_OPACITY = 0.045; // faint faces kept in X-ray so silhouettes/hover remain

// ---- adaptive (level-of-detail) stock labels --------------------------------
// Names are baked for a broad set of bars, but only shown when they'd be legible:
// a bar's label appears once its footprint spans a minimum fraction of the
// viewport height (so zooming in reveals smaller-area names, zooming out declutters).
const LABEL_MIN_SIDE = 0.9;     // build a name only for bars at least this wide & deep
const LABEL_MAX = 240;          // hard cap on baked stock-name sprites (perf)
const LABEL_TOP_ALWAYS = 14;    // the biggest names stay labeled at any zoom
const LABEL_REVEAL_FRAC = 0.035; // show a name once its bar spans ≥ this share of viewport height

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
    this.edgeGeo = new THREE.EdgesGeometry(this.boxGeo); // shared unit-box outline
    this.meshes = [];            // pickable bar meshes
    this.byCode = new Map();
    this.labelGroup = new THREE.Group();
    this.group.add(this.labelGroup);
    this.cap = 3;
    this.opacity = 1;      // current fill opacity
    this.transparency = 0; // slider fraction [0,1]
    this.xray = false;     // wireframe (outline-only) mode
    this.invert = false;   // flip vertical direction (plus down / minus up)
    this._constituents = null;
    this._layout = null;   // last { stocks, sectors, cap } for label rebuilds
    this._stockLabels = [];               // [{ sp, size, area }] for zoom-adaptive LOD
    this._labelTarget = new THREE.Vector3(0, -2, 0); // orbit center (for camera distance)
    this.highlighted = null;
    // language-aware display resolvers (overridden by main.js)
    this.nameFor = (c) => c.name || c.code;
    this.sectorFor = (sector) => sector;
  }

  get pickables() { return this.meshes; }

  // Effective vertical direction for a change%, honoring the invert toggle.
  _sign(pct) { return (pct >= 0 ? 1 : -1) * (this.invert ? -1 : 1); }

  /** Flip which way bars point (plus up/minus down ↔ plus down/minus up). */
  setInvert(v) {
    this.invert = v;
    if (this._constituents) this.setData(this._constituents, { animate: true });
  }

  /**
   * Transparency slider handler. t in [0,1]:
   *   0            → solid fill
   *   up to XRAY_AT → progressively transparent glass
   *   ≥ XRAY_AT     → X-ray: faces nearly gone, only colored outlines remain
   * so back bars stay visible even in dense, zoomed-in views.
   */
  setTransparency(t) {
    this.transparency = t;
    this.xray = t >= XRAY_AT;
    this.opacity = 1 - t * (1 - FILL_MIN);
    for (const m of this.meshes) this._applyLook(m);
  }

  _applyLook(m) {
    if (this.xray) {
      m.material.opacity = XRAY_FACE_OPACITY;
      m.material.transparent = true;
      m.material.depthWrite = false;
      if (m._edges) m._edges.visible = true;
    } else {
      const translucent = this.opacity < 0.999;
      m.material.opacity = this.opacity;
      m.material.transparent = translucent;
      m.material.depthWrite = !translucent; // see-through when translucent
      if (m._edges) m._edges.visible = false;
    }
  }

  _cap(constituents) {
    const arr = constituents.map((c) => Math.abs(c.changePct)).filter((v) => v > 0).sort((a, b) => a - b);
    if (!arr.length) return 3;
    return Math.max(arr[Math.floor(arr.length * 0.9)], 1.5);
  }

  _height(pct, cap) {
    return H_MIN + Math.min(Math.abs(pct) / cap, H_OVER) * H_SPAN;
  }

  /** Rebuild the field from a period's constituents.
   *  `duration` (seconds) overrides the default tween length for this transition
   *  (used by the timeline to pace frame-to-frame morphs). */
  setData(constituents, { animate = true, duration = TWEEN_DUR, cap = null } = {}) {
    this._constituents = constituents;
    // A caller may pin the cap (height/color scale) so a series of frames shares
    // one vertical scale (used by the timeline); otherwise derive it per frame.
    cap = cap != null ? cap : this._cap(constituents);
    this.cap = cap;
    const { stocks, sectors } = layoutTreemap(constituents, this.W, this.D);
    const targets = new Map(stocks.map((s) => [s.code, s]));

    // drop bars no longer present
    for (let i = this.meshes.length - 1; i >= 0; i--) {
      const m = this.meshes[i];
      if (!targets.has(m.userData.code)) {
        this.group.remove(m);
        m.material.dispose();
        if (m._edges) m._edges.material.dispose();
        this.meshes.splice(i, 1);
        this.byCode.delete(m.userData.code);
      }
    }

    for (const s of stocks) {
      const height = this._height(s.changePct, cap);
      const sign = this._sign(s.changePct);
      const w = Math.max(s.w - BOX_GAP, 0.05);
      const d = Math.max(s.d - BOX_GAP, 0.05);
      const color = changeColor(s.changePct, cap);
      const to = { sx: w, sy: height, sz: d, px: s.x, py: (sign * height) / 2, pz: s.z, color };

      let m = this.byCode.get(s.code);
      if (!m) {
        m = new THREE.Mesh(this.boxGeo, new THREE.MeshLambertMaterial({ color }));
        m.scale.set(w, 0.01, d);      // grow in from flat
        m.position.set(s.x, 0, s.z);
        // colored outline (child → inherits the bar's scale/position), for X-ray mode
        const edges = new THREE.LineSegments(this.edgeGeo, new THREE.LineBasicMaterial({ color: color.clone(), transparent: true, opacity: 0.95 }));
        edges.visible = false;
        m.add(edges);
        m._edges = edges;
        this.group.add(m);
        this.meshes.push(m);
        this.byCode.set(s.code, m);
      }
      m.userData = { ...s, cap, baseColor: color.clone() };
      this._applyLook(m);

      if (animate) {
        m._tween = {
          from: {
            sx: m.scale.x, sy: m.scale.y, sz: m.scale.z,
            px: m.position.x, py: m.position.y, pz: m.position.z,
            color: m.material.color.clone(),
          },
          to, t: 0, dur: Math.max(duration, 0.001),
        };
      } else {
        m.scale.set(to.sx, to.sy, to.sz);
        m.position.set(to.px, to.py, to.pz);
        m.material.color.copy(color);
        m._edges.material.color.copy(color);
        m._tween = null;
      }
    }

    this._layout = { stocks, sectors, cap };
    this._buildLabels(stocks, sectors, cap);
  }

  /** Rebuild only the text labels (e.g. after a language switch), without
   *  touching the bars — the layout is identical, only the strings change. */
  rebuildLabels() {
    if (this._layout) this._buildLabels(this._layout.stocks, this._layout.sectors, this._layout.cap);
  }

  /** Advance tweens. dt in seconds. */
  update(dt) {
    if (this.highlighted && this.highlighted._tween) {
      // don't fight a tween on the hovered bar; highlight re-applies each frame
    }
    for (const m of this.meshes) {
      const tw = m._tween;
      if (!tw) continue;
      tw.t = Math.min(1, tw.t + dt / (tw.dur || TWEEN_DUR));
      const k = easeInOut(tw.t);
      const { from, to } = tw;
      m.scale.set(lerp(from.sx, to.sx, k), lerp(from.sy, to.sy, k), lerp(from.sz, to.sz, k));
      m.position.set(lerp(from.px, to.px, k), lerp(from.py, to.py, k), lerp(from.pz, to.pz, k));
      const cur = from.color.clone().lerp(to.color, k);
      if (m !== this.highlighted) m.material.color.copy(cur);
      if (m._edges) m._edges.material.color.copy(cur);
      m.userData.baseColor = cur;
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
      const sp = this._textSprite({ title: this.sectorFor(sec.sector), bg: 'rgba(10,14,22,0.62)', color: '#cbd5e8', fontSize: 26 });
      const worldW = Math.min(sec.w * 0.5, 8);
      sp.scale.set(worldW, worldW / sp.userData.aspect, 1);
      sp.position.set(sec.cx, SECTOR_Y, sec.cz);
      sp.renderOrder = 3;
      this.labelGroup.add(sp);
    }

    // stock labels — baked for a broad set (biggest first) and toggled by zoom in
    // updateLabels(): the biggest names always show; smaller-area names appear as
    // the camera closes in, so more constituents are labeled by default and tiny
    // bars still get names once you zoom in.
    this._stockLabels = [];
    const ranked = stocks
      .filter((s) => s.w >= LABEL_MIN_SIDE && s.d >= LABEL_MIN_SIDE)
      .sort((a, b) => b.w * b.d - a.w * a.d)
      .slice(0, LABEL_MAX);
    ranked.forEach((s, i) => {
      const sign = this._sign(s.changePct);
      const height = this._height(s.changePct, cap);
      const topY = Math.max(0, sign * height);
      const pctTxt = (s.changePct >= 0 ? '+' : '') + s.changePct.toFixed(2) + '%';
      const sp = this._textSprite({ title: this.nameFor(s), sub: pctTxt, color: '#ffffff', subColor: '#e4ebf7', fontSize: 30 });
      const worldW = Math.min(Math.max(s.w * 0.8, 2.6), 15);
      sp.scale.set(worldW, worldW / sp.userData.aspect, 1);
      sp.position.set(s.x, topY + (worldW / sp.userData.aspect) / 2 + 0.3, s.z);
      sp.renderOrder = 4;
      sp.visible = i < 52;           // sensible default before the first LOD pass
      this.labelGroup.add(sp);
      this._stockLabels.push({ sp, size: Math.sqrt(s.w * s.d) });
    });
  }

  /** Show/hide baked stock names by zoom: a name appears once its bar spans at
   *  least LABEL_REVEAL_FRAC of the viewport height (with the biggest always on).
   *  Call once per frame with the active camera. */
  updateLabels(camera) {
    const list = this._stockLabels;
    if (!list || !list.length || !camera) return;
    const dist = camera.position.distanceTo(this._labelTarget);
    const k = 2 * Math.tan((camera.fov * Math.PI / 180) / 2); // world height that fills the viewport at unit distance
    const denom = Math.max(dist * k, 1e-3);
    for (let i = 0; i < list.length; i++) {
      const L = list[i];
      L.sp.visible = i < LABEL_TOP_ALWAYS || (L.size / denom) >= LABEL_REVEAL_FRAC;
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
