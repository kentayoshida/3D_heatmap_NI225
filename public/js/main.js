// App entry: scene, camera, controls, lights, ground, and wiring to UI.
import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';
import { Heatmap } from './heatmap.js';
import { buildPeriodBar, createTooltip, buildLegend, buildOpacityControl, buildInvertToggle } from './ui.js';
import { loadData, CONFIG } from './data-source.js';

const PERIODS = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y'];
const W = 100, D = 70;         // base-plane extent (X, Z)
const REFRESH_MS = 15 * 60 * 1000; // poll for newer end-of-day data every 15 min

// Bundled sample by default; point data-source.js CONFIG.endpoint at a backend
// (JPX-fed) to go live. Top-level await keeps the rest of setup unchanged.
let DATA, live;
({ data: DATA, live } = await loadData());

const stage = document.getElementById('stage');

// ---- renderer / scene / camera ---------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(stage.clientWidth, stage.clientHeight);
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);
scene.fog = new THREE.Fog(0x0b0e14, 160, 320);

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
const planeGeo = new THREE.PlaneGeometry(W + 24, D + 24);
const plane = new THREE.Mesh(
  planeGeo,
  new THREE.MeshBasicMaterial({ color: 0x141925, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
);
plane.rotation.x = -Math.PI / 2;
plane.position.y = -0.02;
scene.add(plane);

const grid = new THREE.GridHelper(Math.max(W, D) + 24, 24, 0x2a3550, 0x1a2233);
grid.position.y = 0;
scene.add(grid);

// ---- heatmap ----------------------------------------------------------------
const heatmap = new Heatmap(scene, { W, D });
let currentPeriod = '1D';
heatmap.setData(DATA[currentPeriod].constituents, { animate: false });

// ---- UI ---------------------------------------------------------------------
buildLegend(document.getElementById('legend'));
buildOpacityControl(document.getElementById('controls'), (t) => heatmap.setTransparency(t));
buildInvertToggle(document.getElementById('controls'), (inv) => {
  heatmap.setInvert(inv);
  const dir = document.getElementById('lg-dir');
  if (dir) dir.innerHTML = `<b>高さ</b> = 騰落率（0%基準・${inv ? '上=マイナス/下=プラス' : '上=プラス/下=マイナス'}）`;
});
const tooltip = createTooltip(document.body);
const periodBar = buildPeriodBar(document.getElementById('periods'), PERIODS, currentPeriod, setPeriod);
updateAsOf();

function setPeriod(p) {
  if (!DATA[p]) return;
  currentPeriod = p;
  heatmap.setData(DATA[p].constituents, { animate: true });
  updateAsOf();
}

function updateAsOf() {
  const el = document.getElementById('asof');
  if (!el) return;
  const date = String(DATA[currentPeriod]?.asOf || '').slice(0, 10); // YYYY-MM-DD
  el.textContent = `データ基準日: ${date || '—'}（JST）${live ? '' : ' ・サンプル'}`;
}

// ---- auto-refresh: pick up new end-of-day data without a manual reload ------
async function refresh() {
  if (document.visibilityState === 'hidden') return; // skip while tab is backgrounded
  try {
    const { data, live: isLive } = await loadData();
    const changed = data[currentPeriod]?.asOf !== DATA[currentPeriod]?.asOf;
    DATA = data;
    live = isLive;
    updateAsOf();
    if (changed) heatmap.setData(DATA[currentPeriod].constituents, { animate: true });
  } catch (err) {
    console.warn('[ni225] refresh failed, keeping current data:', err.message);
  }
}
if (CONFIG.endpoint) setInterval(refresh, REFRESH_MS);

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
  heatmap.update(dt);
  renderer.render(scene, camera);
}
animate();

// expose for debugging / e2e checks
window.__heatmap = { scene, camera, controls, heatmap, setPeriod, PERIODS };
