// Deep-space environment for the 3D heatmap.
//
// Goal: make the heatmap look like it floats in space. The star/nebula sky is set
// as `scene.background` (an equirectangular texture), so it is sampled by the view
// direction — as the user orbits, the sky, planet and station parallax in 3D and
// the field reads as a floating object seen from different angles.
//
// Everything here is drawn procedurally on 2D canvases, so it needs no external
// files and works offline / inside an iframe (the whole app is self-contained,
// CDN-free). If a royalty-free equirectangular image is bundled at `assetUrl`, it
// replaces the procedural sky for extra fidelity; if it's missing, the procedural
// sky stays. Canvas → CanvasTexture is the same pattern the labels use
// (heatmap.js:303).
import * as THREE from 'three';

// ---- small helpers ----------------------------------------------------------
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---- procedural sky (equirectangular 2:1) -----------------------------------
function makeSkyTexture() {
  const w = 2048, h = 1024;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // deep-space base: near-black with a faint blue tint
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#05060b');
  g.addColorStop(0.5, '#070912');
  g.addColorStop(1, '#04050a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // nebula clouds along a diagonal band (additive, low alpha)
  ctx.globalCompositeOperation = 'lighter';
  const clouds = [['#243a6b', 0.10], ['#3a2a6b', 0.09], ['#123a4d', 0.08], ['#4d2a55', 0.07]];
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    const x = w * (0.06 + t * 0.5) + (Math.random() - 0.5) * 260;
    const y = h * (0.72 - t * 0.5) + (Math.random() - 0.5) * 200;
    const r = 120 + Math.random() * 340;
    const [col, a] = clouds[i % clouds.length];
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, hexA(col, a));
    rg.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // stars: many faint, a few bright with a soft halo + slight color tint
  for (let i = 0; i < 2200; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const br = Math.random();
    const size = br > 0.985 ? 1.8 : br > 0.9 ? 1.2 : 0.8;
    const a = 0.35 + br * 0.65;
    const tint = Math.random();
    ctx.fillStyle = tint > 0.92 ? `rgba(170,200,255,${a})`
      : tint < 0.06 ? `rgba(255,210,180,${a})`
      : `rgba(255,255,255,${a})`;
    ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
    if (br > 0.985) {
      const rg = ctx.createRadialGradient(x, y, 0, x, y, size * 6);
      rg.addColorStop(0, `rgba(255,255,255,${a * 0.5})`);
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(x, y, size * 6, 0, Math.PI * 2); ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---- procedural planet (banded gas-giant; muted so it won't fight the bars) --
function makePlanetTexture() {
  const w = 1024, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  const palette = ['#2b4a63', '#39617f', '#26506b', '#4a7191', '#1f3d54', '#5a7f9e'];
  for (let y = 0; y < h; y++) {
    const lat = y / h;
    const turb = Math.sin(lat * 40 + Math.sin(lat * 7) * 2) * 0.5 + 0.5; // gentle wobble
    const idx = Math.floor(lat * 6 + turb * 0.6) % palette.length;
    ctx.fillStyle = palette[idx];
    ctx.fillRect(0, y, w, 1);
  }
  // wispy horizontal streaks
  ctx.globalCompositeOperation = 'overlay';
  for (let i = 0; i < 120; i++) {
    const y = Math.random() * h, len = 60 + Math.random() * 260, x = Math.random() * w;
    ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '0,10,30'},${0.04 + Math.random() * 0.06})`;
    ctx.fillRect(x, y, len, 1 + Math.random() * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  // a subtle storm spot
  const sx = w * 0.66, sy = h * 0.58, sr = 52;
  const rg = ctx.createRadialGradient(sx, sy, 4, sx, sy, sr);
  rg.addColorStop(0, 'rgba(190,155,120,0.5)');
  rg.addColorStop(1, 'rgba(190,155,120,0)');
  ctx.fillStyle = rg;
  ctx.beginPath(); ctx.ellipse(sx, sy, sr, sr * 0.6, 0, 0, Math.PI * 2); ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// ---- procedural station (Death-Star-like: panels + trench + superlaser dish) --
// The superlaser dish is baked into the texture (not extra geometry) so it can't
// be occluded by the opaque body sphere and it rotates with the station for free.
function makeStationTexture() {
  const w = 1024, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // paneled grey surface with per-cell brightness variation
  ctx.fillStyle = '#6a6f78';
  ctx.fillRect(0, 0, w, h);
  const cols = 48, rows = 24, cw = w / cols, ch = h / rows;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const v = (Math.random() - 0.5) * 18;
    ctx.fillStyle = `rgb(${106 + v},${111 + v},${120 + v})`;
    ctx.fillRect(i * cw, j * ch, cw, ch);
  }
  // panel grid lines
  ctx.strokeStyle = 'rgba(30,33,38,0.55)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= cols; i++) { ctx.beginPath(); ctx.moveTo(i * cw, 0); ctx.lineTo(i * cw, h); ctx.stroke(); }
  for (let j = 0; j <= rows; j++) { ctx.beginPath(); ctx.moveTo(0, j * ch); ctx.lineTo(w, j * ch); ctx.stroke(); }
  // greebles
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(40,44,50,${0.25 + Math.random() * 0.3})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 10, 2 + Math.random() * 6);
  }
  // equatorial trench
  const ty = h * 0.5;
  ctx.fillStyle = '#2a2d33'; ctx.fillRect(0, ty - 10, w, 20);
  ctx.fillStyle = '#1c1e23'; ctx.fillRect(0, ty - 2, w, 4);

  // superlaser dish (upper hemisphere): shaded socket + concentric detail + focus
  const du = w * 0.5, dv = h * 0.30, dR = 78;
  const socket = ctx.createRadialGradient(du, dv, dR * 0.2, du, dv, dR);
  socket.addColorStop(0, '#15171b');
  socket.addColorStop(0.7, '#2a2d33');
  socket.addColorStop(1, '#4a4e56');
  ctx.fillStyle = socket;
  ctx.beginPath(); ctx.arc(du, dv, dR, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(150,156,166,0.7)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(du, dv, dR, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(20,22,26,0.6)'; ctx.lineWidth = 2;
  for (const rr of [dR * 0.75, dR * 0.5]) { ctx.beginPath(); ctx.arc(du, dv, rr, 0, Math.PI * 2); ctx.stroke(); }
  for (let k = 0; k < 12; k++) { // radial spokes
    const a = (k / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(du + Math.cos(a) * dR * 0.16, dv + Math.sin(a) * dR * 0.16);
    ctx.lineTo(du + Math.cos(a) * dR, dv + Math.sin(a) * dR);
    ctx.stroke();
  }
  ctx.fillStyle = '#0c0d10'; // focus lens
  ctx.beginPath(); ctx.arc(du, dv, dR * 0.16, 0, Math.PI * 2); ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// ---- Saturn-like ring system ------------------------------------------------
// A flat annulus in the planet's equatorial plane. RingGeometry's default UVs run
// around the ring; we remap them so u = radial fraction (0 at inner edge, 1 at
// outer), which lets a horizontal strip texture paint concentric bands. A bundled
// strip image can replace the procedural one — same "provide an image, else
// procedural" pattern as the sky/planet.
function makeRingGeometry(inner, outer, seg = 220) {
  const g = new THREE.RingGeometry(inner, outer, seg, 1);
  const pos = g.attributes.position, uv = g.attributes.uv, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    uv.setXY(i, (v.length() - inner) / (outer - inner), 0.5); // u = radius, y flat
  }
  uv.needsUpdate = true;
  return g;
}

// Procedural ring strip (radial cross-section): icy-tan bands, a Cassini-like gap,
// and edge fade. RGBA — the alpha channel is the ring's transparency profile.
function makeRingTexture() {
  const w = 1024, h = 16;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  for (let x = 0; x < w; x++) {
    const u = x / w;
    let a = 0.8;
    if (u < 0.05) a *= u / 0.05;                 // inner edge fade
    if (u > 0.96) a *= (1 - u) / 0.04;           // outer edge fade
    a *= 1 - 0.92 * Math.exp(-((u - 0.60) ** 2) / (2 * 0.013 ** 2)); // Cassini gap
    a *= 1 - 0.55 * Math.exp(-((u - 0.38) ** 2) / (2 * 0.02 ** 2));  // fainter gap
    const b = 158 + 46 * Math.sin(u * 80) + 22 * Math.sin(u * 230);  // banding
    ctx.fillStyle = `rgba(${b},${Math.round(b * 0.9)},${Math.round(b * 0.74)},${Math.max(0, a)})`;
    ctx.fillRect(x, 0, 1, h);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// ---- assemble ---------------------------------------------------------------
// Builds the sky/planet/station into `scene` and returns { update(dt), planet,
// station } so the render loop can add gentle rotation. All objects sit well
// within the camera's far plane (2000).
//   assetUrl  — equirectangular sky image (else procedural sky)
//   planetUrl — equirectangular planet map, e.g. Jupiter (else procedural planet)
//   ringUrl   — horizontal ring strip (RGBA, radial cross-section; else procedural)
export function createSpace(scene, { assetUrl, planetUrl, ringUrl } = {}) {
  scene.fog = null; // fog would grey the sky/planet out; depth cueing isn't needed here

  // sky: procedural immediately (no blank first frame); swap to a bundled
  // equirectangular image if one is present, otherwise keep the procedural sky.
  const proceduralSky = makeSkyTexture();
  scene.background = proceduralSky;
  if (assetUrl) {
    new THREE.TextureLoader().load(
      assetUrl,
      (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        scene.background = tex;
        proceduralSky.dispose();
      },
      undefined,
      () => { /* no image bundled — procedural sky stays */ },
    );
  }

  // planet, low and behind the field (large; only its upper limb is in frame).
  // Procedural surface immediately; swap to a bundled equirectangular map
  // (e.g. Jupiter) if present — keeps the app self-contained if it's missing.
  const planet = new THREE.Group();
  const PR = 96;
  const globeMat = new THREE.MeshStandardMaterial({ map: makePlanetTexture(), roughness: 1, metalness: 0 });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(PR, 64, 48), globeMat);
  planet.add(globe);
  if (planetUrl) {
    new THREE.TextureLoader().load(
      planetUrl,
      (tex) => { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; globeMat.map = tex; globeMat.needsUpdate = true; },
      undefined,
      () => { /* no image bundled — procedural planet stays */ },
    );
  }
  const atmo = new THREE.Mesh( // additive back-side shell = cheap atmosphere rim
    new THREE.SphereGeometry(PR * 1.06, 48, 32),
    new THREE.MeshBasicMaterial({
      color: 0x5c93d6, transparent: true, opacity: 0.14,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  planet.add(atmo);

  // Saturn-like rings in the equatorial plane. Added to the planet group (not the
  // globe), so they hold still while the globe surface spins, and share the axial
  // tilt below. Procedural strip now; swap to a bundled ring image if present.
  const ringMat = new THREE.MeshBasicMaterial({
    map: makeRingTexture(), transparent: true, side: THREE.DoubleSide,
    depthWrite: false, opacity: 0.95,
  });
  const rings = new THREE.Mesh(makeRingGeometry(PR * 1.28, PR * 2.15), ringMat);
  rings.rotation.x = -Math.PI / 2; // lay flat into the equatorial (XZ) plane
  planet.add(rings);
  if (ringUrl) {
    new THREE.TextureLoader().load(
      ringUrl,
      (tex) => { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; ringMat.map = tex; ringMat.needsUpdate = true; },
      undefined,
      () => { /* no image bundled — procedural rings stay */ },
    );
  }

  planet.position.set(-30, -196, -150); // low, so the ringed planet sits below the field
  planet.rotation.set(0.30, 0, 0.16);   // axial tilt so the rings read as an open ellipse
  scene.add(planet);

  // Death-Star-like station, upper right and behind. rotation.y is tuned so the
  // superlaser dish (baked at texture u=0.5) faces the initial camera.
  const station = new THREE.Group();
  const SR = 30;
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(SR, 48, 32),
    new THREE.MeshStandardMaterial({ map: makeStationTexture(), roughness: 0.85, metalness: 0.25 }),
  );
  station.add(body);
  // The default camera pitches down ~36°, so this world point projects to the open
  // upper-right of the frame, clear of the tall bars.
  station.position.set(150, -6, -140);
  station.rotation.y = -2.05; // aims the baked superlaser dish at the default camera
  scene.add(station);

  return {
    planet, station,
    update(dt) {
      globe.rotation.y += dt * 0.012;   // slow gas-giant spin
      station.rotation.y += dt * 0.02;  // slow station spin
    },
  };
}
