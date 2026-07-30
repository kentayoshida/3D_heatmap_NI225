// Snapshot & share: capture the live WebGL view at the user's current camera
// angle/zoom, composite a branded header/footer band onto it (index name, as-of
// date, and the site URL so the CTA survives re-sharing), then share via the Web
// Share API (Level 2, files) with a download fallback — plus X / LINE / copy-link.
//
// Ported in spirit from the devil-fruit-maker share flow (src/lib/share.ts), but
// here the source is a Three.js canvas so we composite with the native 2D canvas
// API instead of html-to-image (no extra dependency).

const FONT = '"Noto Sans CJK JP","Noto Sans JP","Hiragino Sans","Yu Gothic",Meiryo,system-ui,sans-serif';
const BG = '#0b0e14';
const BAND = 'rgba(9,12,19,0.96)';

// Render the scene once (so the drawing buffer is fresh) and composite a branded
// PNG. `header` = { title, sub }, `footer` = { brand, url, cta }.
// Returns { blob, file, dataUrl }.
export async function captureBrandedPng({ renderer, scene, camera, header, footer, filename }) {
  renderer.render(scene, camera); // ensure the buffer reflects the current view
  const src = renderer.domElement;
  const W = src.width;                    // device pixels (DPR already applied)
  const srcH = src.height;
  const topH = Math.round(W * 0.055);
  const botH = Math.round(W * 0.075);

  const out = document.createElement('canvas');
  out.width = W;
  out.height = srcH + topH + botH;
  const ctx = out.getContext('2d');

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, topH, W, srcH);

  // ---- top band: index title (left) + period · date (right) ----
  ctx.fillStyle = BAND;
  ctx.fillRect(0, 0, W, topH);
  const padX = Math.round(W * 0.02);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#eef2fb';
  ctx.font = `700 ${Math.round(topH * 0.44)}px ${FONT}`;
  ctx.fillText(header.title || '', padX, topH / 2);
  if (header.sub) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#9aa6bd';
    ctx.font = `600 ${Math.round(topH * 0.34)}px ${FONT}`;
    ctx.fillText(header.sub, W - padX, topH / 2);
  }

  // ---- bottom band: logo + brand (left) + CTA · URL (right) ----
  const by = srcH + topH;
  ctx.fillStyle = BAND;
  ctx.fillRect(0, by, W, botH);
  // mini logo (three bars, like the favicon)
  const bar = Math.round(botH * 0.12);
  const barH = Math.round(botH * 0.5);
  const lx = padX, ly = by + (botH - barH) / 2;
  const cols = ['#f5443a', '#22d367', '#f5443a'];
  const hts = [0.62, 1.0, 0.44];
  for (let i = 0; i < 3; i++) {
    const h = barH * hts[i];
    ctx.fillStyle = cols[i];
    ctx.fillRect(lx + i * (bar + Math.round(bar * 0.5)), ly + (barH - h), bar, h);
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#dfe6f2';
  ctx.font = `700 ${Math.round(botH * 0.3)}px ${FONT}`;
  const brandX = lx + 3 * (bar + Math.round(bar * 0.5)) + Math.round(botH * 0.18);
  ctx.fillText(footer.brand || '', brandX, by + botH / 2);
  // right: CTA + URL
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8fb0ff';
  ctx.font = `700 ${Math.round(botH * 0.3)}px ${FONT}`;
  const url = footer.url || '';
  ctx.fillText(url, W - padX, by + botH * 0.62);
  if (footer.cta) {
    ctx.fillStyle = '#9aa6bd';
    ctx.font = `600 ${Math.round(botH * 0.24)}px ${FONT}`;
    ctx.fillText(footer.cta, W - padX, by + botH * 0.3);
  }

  const blob = await new Promise((res) => out.toBlob(res, 'image/png'));
  if (!blob) throw new Error('canvas.toBlob returned null');
  const dataUrl = out.toDataURL('image/png');
  const file = new File([blob], filename || 'heatmap.png', { type: 'image/png' });
  return { blob, file, dataUrl };
}

// Web Share API Level 2 — share the PNG *file itself* (so on mobile the user can
// pick X / LINE / etc. and the image is attached). Returns:
//   'shared'      — the OS share sheet handled it (image attached)
//   'cancelled'   — user dismissed the sheet
//   'unsupported' — this browser can't share files (use the download fallback)
//   'error'       — share() threw for another reason
export async function nativeShareFiles({ file, title, text, url }) {
  const nav = navigator;
  if (typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title, text, url });
      return 'shared';
    } catch (err) {
      return err && err.name === 'AbortError' ? 'cancelled' : 'error';
    }
  }
  return 'unsupported';
}

// Save the PNG to disk (fallback when file sharing isn't available, and the way to
// get the image in hand before opening an X / LINE composer to attach it).
export function downloadImage(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename || 'heatmap.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Open an X (Twitter) intent tweet composer with the CTA text + URL.
export function shareToX({ text, url }) {
  const u = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  window.open(u, '_blank', 'noopener,noreferrer');
}

// Open the LINE share composer with the CTA text + URL.
export function shareToLine({ text, url }) {
  const u = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  window.open(u, '_blank', 'noopener,noreferrer');
}

// Copy the site URL to the clipboard. Returns true on success.
export async function copyLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}
