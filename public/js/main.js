// App entry: scene, camera, controls, lights, ground, and wiring to UI.
import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';
import { Heatmap } from './heatmap.js';
import { buildPeriodBar, buildIndexBar, buildLangBar, createTooltip, renderLegend, buildOpacityControl, buildInvertToggle, buildShareControls, createToast, buildTimelineBar, createLoading } from './ui.js';
import { loadData, CONFIG, INDICES, INDEX_META, hasTimeline } from './data-source.js';
import { LANGS, UI, sectorLabel } from './i18n.js';
import { captureBrandedPng, nativeShareFiles, downloadImage, shareToX, shareToLine, copyLink } from './share.js';
import { Timeline } from './timeline.js';
import { createSpace } from './space.js';

const SITE_URL = 'https://3dheatmap.markets-lab.com/';

const PERIODS = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y'];
const W = 100, D = 70;         // base-plane extent (X, Z)
const REFRESH_MS = 15 * 60 * 1000; // poll for newer end-of-day data every 15 min

// One index + one language shown at a time; other indices load lazily & cache.
let currentIndex = 'NIKKEI';
let currentLang = 'ja';
const LOADED = new Map(); // index -> { data, live }

// language-aware display resolvers (used by the heatmap labels + tooltip)
const strings = () => UI[currentLang];
function nameFor(c) {
  if (currentLang === 'en' && !INDEX_META[currentIndex].namesEnglish) return c.nameEn || c.code;
  return c.name || c.code; // JA, or an index whose names are already English
}
const sectorFor = (sector) => sectorLabel(sector, currentLang);
const titleFor = () => INDEX_META[currentIndex].title[currentLang];

// Loading veil (already visible from the HTML) — start its elapsed counter now,
// while the first index's data is fetched and the scene is built. First load plays
// the hyperspace clip; on arrival it flashes and reveals the scene. (Index switches
// below call loading.show() without hyperspace → the plain spinner veil.)
const loading = createLoading(document.getElementById('loading'), strings);
loading.show({ hyperspace: true });

// Bundled sample by default; point data-source.js CONFIG.endpoints at backends to
// go live. Top-level await keeps the rest of setup unchanged.
{
  const res = await loadData(currentIndex);
  LOADED.set(currentIndex, res);
}
let DATA = LOADED.get(currentIndex).data;
let live = LOADED.get(currentIndex).live;

const stage = document.getElementById('stage');

// ---- renderer / scene / camera ---------------------------------------------
// preserveDrawingBuffer lets us read the canvas at any time for the share snapshot.
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(stage.clientWidth, stage.clientHeight);
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Space environment: star/nebula sky (as scene.background, so it parallaxes as the
// camera orbits), a planet below the field, and a Death-Star-like station upper
// right — makes the heatmap read as floating in space. Sky uses a bundled
// equirectangular image if present at assetUrl, else a procedural fallback.
const space = createSpace(scene, {
  assetUrl: './assets/starfield.jpg',  // equirectangular star sky (else procedural)
  planetUrl: './assets/jupiter.jpg',   // equirectangular planet map (else procedural)
  ringUrl: './assets/rings.png',       // ring strip, RGBA radial (else procedural)
  ssdUrl: './assets/ssd.png',          // detailed SSD silhouette (else procedural)
});

const camera = new THREE.PerspectiveCamera(50, stage.clientWidth / stage.clientHeight, 0.1, 2000);
camera.position.set(0, 94, 132);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, -2, 0);
controls.minDistance = 30;
controls.maxDistance = 320;
controls.rotateSpeed = 0.9;

// ---- lights -----------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x141822, 1.05));
const key = new THREE.DirectionalLight(0xffffff, 1.35);
key.position.set(60, 120, 40);
scene.add(key);
const fill = new THREE.DirectionalLight(0x9fb4ff, 0.4);
fill.position.set(-80, 60, -60);
scene.add(fill);

// ---- ground: 0% baseline plane + grid --------------------------------------
// Faint "ethereal" baseline against the star field (kept subtle so the field
// reads as floating, not sitting on a floor — it still marks the 0% plane).
const planeGeo = new THREE.PlaneGeometry(W + 24, D + 24);
const plane = new THREE.Mesh(
  planeGeo,
  new THREE.MeshBasicMaterial({ color: 0x0a1220, transparent: true, opacity: 0.16, side: THREE.DoubleSide })
);
plane.rotation.x = -Math.PI / 2;
plane.position.y = -0.02;
scene.add(plane);

const grid = new THREE.GridHelper(Math.max(W, D) + 24, 24, 0x1b2c4a, 0x0f1a2e);
grid.material.transparent = true;
grid.material.opacity = 0.5;
grid.position.y = 0;
scene.add(grid);

// ---- heatmap ----------------------------------------------------------------
const heatmap = new Heatmap(scene, { W, D });
heatmap.nameFor = nameFor;
heatmap.sectorFor = sectorFor;
let currentPeriod = '1D';
heatmap.setData(DATA[currentPeriod].constituents, { animate: false });

// ---- UI ---------------------------------------------------------------------
const legendEl = document.getElementById('legend');
const opacityControl = buildOpacityControl(document.getElementById('controls'), (t) => heatmap.setTransparency(t), strings);
const invertToggle = buildInvertToggle(document.getElementById('controls'), (inv) => {
  heatmap.setInvert(inv);
  renderLegendNow(); // reflect the flipped direction text
}, strings);
const tooltip = createTooltip(document.body, { strings, nameFor, sectorFor });
const periodBar = buildPeriodBar(document.getElementById('periods'), PERIODS, currentPeriod, setPeriod);
const indexBar = buildIndexBar(document.getElementById('indices'), INDICES, currentIndex, INDEX_META, setIndex);
const langBar = buildLangBar(document.getElementById('lang'), LANGS, currentLang, (l) => UI[l].langLabel, setLang);

// ---- snapshot & share -------------------------------------------------------
const toast = createToast(document.body);
const shareControls = buildShareControls(document.getElementById('share'), {
  strings,
  onCamera: () => doShare(null),
  onX: () => doShare('x'),
  onLine: () => doShare('line'),
  onCopy: async () => toast.show((await copyLink(SITE_URL)) ? strings().toastCopied : strings().toastFailed),
});

// ---- timeline (last-5-sessions animation) -----------------------------------
const timelineBar = buildTimelineBar(document.getElementById('timeline'), {
  strings,
  frameCount: frameCountFor(DATA),
  onPlayToggle: () => timeline.toggle(),
  onSeek: (i) => timeline.seek(i),
});
const timeline = new Timeline({
  heatmap,
  bar: timelineBar,
  onFrame: () => updateAsOf(),
  enterExit: (active) => { if (active) periodBar.setActive(null); },
});
timeline.setFrames(timelineFrames(DATA));

applyChrome();

function frameCountFor(data) { return hasTimeline(data) ? data.TIMELINE.frames.length : 0; }
function timelineFrames(data) { return hasTimeline(data) ? data.TIMELINE.frames : []; }

// Share caption text (image is attached separately via the Web Share API).
function shareText() {
  const s = strings();
  return `${titleFor()}｜${s.shareCta} ${s.shareHashtag}`;
}

// Capture the current view as a branded PNG, then share it image-first.
// `service` = null (generic share sheet) | 'x' | 'line'.
//   • If the browser can share files (mobile / modern), the IMAGE is attached via
//     the native share sheet — the user picks X / LINE / etc.
//   • Otherwise (most desktops) X/LINE web composers can't auto-attach an image, so
//     we save the PNG and open the composer (text + URL) for the user to attach it.
async function doShare(service = null) {
  try {
    const s = strings();
    const tz = currentIndex === 'NIKKEI' ? s.jst : s.et;
    let scope, date;
    if (timeline.isEntered() && timelineFrames(DATA)[timeline.index]) {
      scope = s.tlDay;
      date = String(timelineFrames(DATA)[timeline.index].asOf || '').slice(0, 10);
    } else {
      scope = currentPeriod;
      date = String(DATA[currentPeriod]?.asOf || '').slice(0, 10);
    }
    const header = { title: titleFor(), sub: `${scope} · ${date} ${tz}`.trim() };
    const footer = { brand: s.shareBrand, url: SITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, ''), cta: s.shareFooterCta };
    const filename = `heatmap-${currentIndex}-${date || 'view'}.png`;
    const text = shareText();
    const shot = await captureBrandedPng({ renderer, scene, camera, header, footer, filename });

    // 1) Best path — native file share (image attached). User chooses the app.
    const r = await nativeShareFiles({ file: shot.file, title: titleFor(), text, url: SITE_URL });
    if (r === 'shared') { toast.show(s.toastShared); return; }
    if (r === 'cancelled') return;

    // 2) Fallback — save the image, then open the requested composer (text + URL).
    downloadImage(shot.dataUrl, filename);
    if (service === 'x') shareToX({ text, url: SITE_URL });
    else if (service === 'line') shareToLine({ text, url: SITE_URL });
    toast.show(service ? s.toastSavedAttach : s.toastSaved);
  } catch (err) {
    console.warn('[heatmap] share failed:', err.message);
    toast.show(strings().toastFailed);
  }
}

function setPeriod(p) {
  if (!DATA[p]) return;
  timeline.exit();          // leaving the animation view
  currentPeriod = p;
  heatmap.setData(DATA[p].constituents, { animate: true });
  updateAsOf();
}

// Switch the displayed index. Loads (and caches) the index's data on first use,
// keeping the currently selected period. Falls back to the bundled sample if the
// live endpoint is unreachable (handled inside loadData).
async function setIndex(idx) {
  if (idx === currentIndex || !INDEX_META[idx]) return;
  timeline.exit();          // leave the animation view when switching indices
  currentIndex = idx;
  applyChrome();
  let res = LOADED.get(idx);
  if (!res) {
    loading.show(); // first visit to this index: show the veil during the fetch
    try {
      res = await loadData(idx);
      LOADED.set(idx, res);
    } catch (err) {
      console.warn(`[heatmap] failed to load ${idx}:`, err.message);
      loading.hide();
      return;
    }
  }
  if (currentIndex !== idx) { loading.hide(); return; } // a newer switch won the race
  DATA = res.data;
  live = res.live;
  if (!DATA[currentPeriod]) currentPeriod = PERIODS[0];
  heatmap.setData(DATA[currentPeriod].constituents, { animate: true });
  timeline.setFrames(timelineFrames(DATA)); // swap the new index's animation frames
  updateAsOf();
  loading.hide();
}

// Switch UI language: re-render all chrome and rebuild the (baked) 3D labels.
function setLang(lang) {
  if (lang === currentLang || !UI[lang]) return;
  currentLang = lang;
  document.documentElement.lang = lang;
  langBar.setActive(lang);
  applyChrome();
  shareControls.refresh();
  timelineBar.refresh();
  heatmap.rebuildLabels();
}

// All text chrome that depends on the current index and/or language.
function applyChrome() {
  document.title = titleFor();
  indexBar.setActive(currentIndex);
  renderLegendNow();
  invertToggle.render();
  opacityControl.refresh();
  const lo = document.getElementById('lbl-opacity');
  const li = document.getElementById('lbl-invert');
  if (lo) lo.textContent = strings().transparency;
  if (li) li.textContent = strings().direction;
  updateAsOf();
}

function renderLegendNow() {
  renderLegend(legendEl, { strings: strings(), title: titleFor(), inverted: invertToggle ? invertToggle.get() : false });
}

function updateAsOf() {
  const el = document.getElementById('asof');
  if (!el) return;
  const s = strings();
  // In timeline mode reflect the current frame's date instead of the period's.
  const frame = timeline.isEntered() ? timelineFrames(DATA)[timeline.index] : null;
  const date = String((frame ? frame.asOf : DATA[currentPeriod]?.asOf) || '').slice(0, 10);
  const tz = currentIndex === 'NIKKEI' ? s.jst : s.et;
  if (currentLang === 'en') {
    el.textContent = `${s.asOf}: ${date || '—'} (${tz})${live ? '' : ` · ${s.sample}`}`;
  } else {
    el.textContent = `${s.asOf}: ${date || '—'}（${tz}）${live ? '' : ` ・${s.sample}`}`;
  }
}

// ---- auto-refresh: pick up new end-of-day data without a manual reload ------
async function refresh() {
  if (document.visibilityState === 'hidden') return; // skip while tab is backgrounded
  const idx = currentIndex;
  try {
    const res = await loadData(idx);
    LOADED.set(idx, res);
    if (currentIndex !== idx) return; // user switched indices mid-fetch
    const changed = res.data[currentPeriod]?.asOf !== DATA[currentPeriod]?.asOf;
    DATA = res.data;
    live = res.live;
    updateAsOf();
    // Don't disturb an in-progress animation; refresh its frames only when idle.
    if (timeline.isEntered()) return;
    timeline.setFrames(timelineFrames(DATA));
    if (changed) heatmap.setData(DATA[currentPeriod].constituents, { animate: true });
  } catch (err) {
    console.warn('[heatmap] refresh failed, keeping current data:', err.message);
  }
}
if (Object.values(CONFIG.endpoints).some(Boolean)) setInterval(refresh, REFRESH_MS);

// ---- hover picking ----------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoverMesh = null;

renderer.domElement.addEventListener('pointermove', (e) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(heatmap.pickables, false);
  if (hits.length) {
    const m = hits[0].object;
    if (m !== hoverMesh) { hoverMesh = m; heatmap.highlight(m); }
    tooltip.show(m.userData, heatmap.cap, e.clientX, e.clientY);
  } else if (hoverMesh) {
    hoverMesh = null;
    heatmap.clearHighlight();
    tooltip.hide();
  } else {
    tooltip.move(e.clientX, e.clientY);
  }
});
renderer.domElement.addEventListener('pointerleave', () => {
  hoverMesh = null;
  heatmap.clearHighlight();
  tooltip.hide();
});

// ---- resize -----------------------------------------------------------------
function onResize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);

// ---- loop -------------------------------------------------------------------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  controls.update();
  space.update(dt);
  heatmap.update(dt);
  renderer.render(scene, camera);
}
// Paint the first frame under the veil (bars are already built), then reveal.
// rAF is preferred (fires right after a paint); a short timeout is a fallback for
// environments where rAF is throttled.
renderer.render(scene, camera);
animate();
requestAnimationFrame(() => loading.hide());
setTimeout(() => loading.hide(), 250);

// expose for debugging / e2e checks
window.__heatmap = { scene, camera, controls, heatmap, timeline, setPeriod, setIndex, setLang, doShare, captureBrandedPng: (o) => captureBrandedPng({ renderer, scene, camera, ...o }), PERIODS, INDICES, LANGS, get index() { return currentIndex; }, get lang() { return currentLang; } };
