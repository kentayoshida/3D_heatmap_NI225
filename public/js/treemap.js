// Squarified treemap (Bruls, Huizing & van Wijk 2000), two-level:
// level 1 = sectors, level 2 = stocks within each sector.
// Footprint area is proportional to each name's index weight% (`weight`), so a
// bar's volume (area × height, height = change%) reads as its 寄与度. Older sample
// payloads without `weight` fall back to |contribution|. Height is added later by
// the renderer.
//
// Coordinates: the base plane lies on XZ, centered at the origin. layout() returns
// stock footprints as { ...stock, x, z, w, d } where (x,z) is the box CENTER and
// (w,d) its size along X and Z.

// worst aspect ratio of a row of `areas` laid across a strip of length `side`.
function worstRatio(areas, side) {
  let s = 0, mx = -Infinity, mn = Infinity;
  for (const a of areas) { s += a; if (a > mx) mx = a; if (a < mn) mn = a; }
  if (s <= 0) return Infinity;
  const s2 = s * s, side2 = side * side;
  return Math.max((side2 * mx) / s2, s2 / (side2 * mn));
}

// Squarify `items` ([{value, ref}]) into rect {x,y,w,h}. Returns
// [{ref, x, y, w, h}] with (x,y) the min corner.
function squarify(items, rect) {
  const out = [];
  const nodes = items.filter((it) => it.value > 0).map((it) => ({ ...it }));
  if (nodes.length === 0) return out;
  const total = nodes.reduce((a, n) => a + n.value, 0);
  const scale = (rect.w * rect.h) / total;
  for (const n of nodes) n.area = n.value * scale;
  nodes.sort((a, b) => b.area - a.area);

  let { x, y, w, h } = rect;
  let idx = 0;
  while (idx < nodes.length) {
    const side = Math.min(w, h);
    const row = [];
    // grow the current row while it keeps the worst aspect ratio from getting worse
    while (idx < nodes.length) {
      const cur = row.map((r) => r.area);
      const withNew = worstRatio([...cur, nodes[idx].area], side);
      const without = row.length ? worstRatio(cur, side) : Infinity;
      if (row.length === 0 || withNew <= without) { row.push(nodes[idx]); idx++; }
      else break;
    }
    const rowArea = row.reduce((a, r) => a + r.area, 0);
    if (w <= h) {
      const stripH = rowArea / w || 0;
      let cx = x;
      for (const r of row) {
        const rw = stripH ? r.area / stripH : 0;
        out.push({ ref: r.ref, x: cx, y, w: rw, h: stripH });
        cx += rw;
      }
      y += stripH; h -= stripH;
    } else {
      const stripW = rowArea / h || 0;
      let cy = y;
      for (const r of row) {
        const rh = stripW ? r.area / stripW : 0;
        out.push({ ref: r.ref, x, y: cy, w: stripW, h: rh });
        cy += rh;
      }
      x += stripW; w -= stripW;
    }
  }
  return out;
}

/**
 * Two-level treemap.
 * @param {Array} constituents  [{code,name,sector,changePct,contribution}]
 * @param {number} W  plane width  (X extent)
 * @param {number} D  plane depth  (Z extent)
 * @param {number} gap  inset applied inside each sector block (world units)
 * @returns {{stocks:Array, sectors:Array}}
 */
// Area source: index weight% (`weight`); fall back to |contribution| for older
// sample payloads that predate the weight field.
const areaOf = (c) => (c.weight != null ? Math.max(c.weight, 0) : Math.abs(c.contribution));

export function layoutTreemap(constituents, W, D, gap = 0.7) {
  const bySector = new Map();
  for (const c of constituents) {
    const v = areaOf(c);
    if (!(v > 0)) continue;
    let g = bySector.get(c.sector);
    if (!g) { g = { sector: c.sector, value: 0, items: [] }; bySector.set(c.sector, g); }
    g.value += v;
    g.items.push(c);
  }
  const sectors = [...bySector.values()];
  const rect = { x: -W / 2, y: -D / 2, w: W, h: D };
  const sectorRects = squarify(sectors.map((s) => ({ value: s.value, ref: s })), rect);

  const stocks = [];
  const sectorBoxes = [];
  for (const sr of sectorRects) {
    const g = sr.ref;
    const inner = {
      x: sr.x + gap,
      y: sr.y + gap,
      w: Math.max(sr.w - 2 * gap, 0.2),
      h: Math.max(sr.h - 2 * gap, 0.2),
    };
    sectorBoxes.push({
      sector: g.sector,
      value: g.value,
      // centers, mapping the treemap y-axis onto world Z
      cx: sr.x + sr.w / 2,
      cz: sr.y + sr.h / 2,
      w: sr.w,
      d: sr.h,
      inner,
    });
    const rects = squarify(g.items.map((c) => ({ value: areaOf(c), ref: c })), inner);
    for (const r of rects) {
      stocks.push({
        ...r.ref,
        x: r.x + r.w / 2,
        z: r.y + r.h / 2,
        w: r.w,
        d: r.h,
      });
    }
  }
  return { stocks, sectors: sectorBoxes };
}
