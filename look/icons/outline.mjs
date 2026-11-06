// Pixel-icon outline: turns any Pixelarticons-style SVG (several <path>s, overlapping
// rectangles, mixed fill rules) into ONE clean outline on the 24-unit grid.
//
// Why: Safari draws overlapping or abutting rectangles with hairline seams when it
// anti-aliases (iPhone 3x screens, where one icon unit is 1.5 device pixels). A single
// traced outline has no internal edges, so there is nothing to seam. The pixels drawn
// are exactly the same as the source.
//
//   import { outline } from './outline.mjs';
//   outline([{ d, evenOdd }, ...]) -> 'M..Z' (fill with the default nonzero rule)

const N = 24;

/** Parse an SVG path (M m L l H h V v Z z, absolute or relative) into closed polygons. */
function polygons(d) {
  const toks = d.match(/[MmLlHhVvZz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  const polys = []; let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = '', i = 0;
  const num = () => parseFloat(toks[i++]);
  const close = () => { if (cur && cur.length > 2) polys.push(cur); cur = null; x = sx; y = sy; };
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
    switch (cmd) {
      case 'M': case 'm': {
        if (cur) close();
        const nx = num(), ny = num();
        x = cmd === 'm' ? x + nx : nx; y = cmd === 'm' ? y + ny : ny; sx = x; sy = y;
        cur = [[x, y]]; cmd = cmd === 'm' ? 'l' : 'L'; break;
      }
      case 'L': x = num(); y = num(); cur.push([x, y]); break;
      case 'l': x += num(); y += num(); cur.push([x, y]); break;
      case 'H': x = num(); cur.push([x, y]); break;
      case 'h': x += num(); cur.push([x, y]); break;
      case 'V': y = num(); cur.push([x, y]); break;
      case 'v': y += num(); cur.push([x, y]); break;
      case 'Z': case 'z': close(); break;
      default: i++;
    }
  }
  if (cur) close();
  return polys;
}

/** Winding number of point (px, py) against polygons. */
function winding(polys, px, py) {
  let w = 0;
  for (const p of polys) for (let k = 0; k < p.length; k++) {
    const [x1, y1] = p[k], [x2, y2] = p[(k + 1) % p.length];
    if (y1 <= py) { if (y2 > py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) > 0) w++; }
    else if (y2 <= py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) < 0) w--;
  }
  return w;
}

/** 24x24 grid of filled units (cell centres), union of every path with its own fill rule. */
export function raster(paths) {
  const g = Array.from({ length: N }, () => new Array(N).fill(0));
  for (const { d, evenOdd } of paths) {
    const polys = polygons(d);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const w = winding(polys, x + 0.5, y + 0.5);
      if (evenOdd ? (w % 2 !== 0) : w !== 0) g[y][x] = 1;
    }
  }
  return g;
}

/** Trace the filled cells into closed outlines (outer loops clockwise, holes counter-clockwise). */
export function trace(g) {
  const on = (x, y) => x >= 0 && y >= 0 && x < N && y < N && g[y][x] === 1;
  const edges = new Map(); // "x,y" start -> list of [x2,y2]
  const add = (x1, y1, x2, y2) => { const k = `${x1},${y1}`; (edges.get(k) || edges.set(k, []).get(k)).push([x2, y2]); };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!on(x, y)) continue;
    if (!on(x, y - 1)) add(x, y, x + 1, y);         // top, left to right
    if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1); // right, down
    if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1); // bottom, right to left
    if (!on(x - 1, y)) add(x, y + 1, x, y);         // left, up
  }
  let d = '';
  for (;;) {
    const startKey = [...edges.keys()].find(k => edges.get(k).length);
    if (!startKey) break;
    const pts = [];
    let [cx, cy] = startKey.split(',').map(Number), prev = null;
    for (;;) {
      const list = edges.get(`${cx},${cy}`);
      if (!list || !list.length) break;
      // At a pinch point (two loops touching corners), keep turning the same way.
      let idx = 0;
      if (list.length > 1 && prev) {
        const dirIn = [cx - prev[0], cy - prev[1]];
        const right = [-dirIn[1], dirIn[0]];
        idx = list.findIndex(([nx, ny]) => nx - cx === right[0] && ny - cy === right[1]);
        if (idx < 0) idx = 0;
      }
      const [nx, ny] = list.splice(idx, 1)[0];
      pts.push([cx, cy]); prev = [cx, cy]; cx = nx; cy = ny;
      if (`${cx},${cy}` === startKey && !(edges.get(startKey) || []).length) break;
      if (`${cx},${cy}` === startKey) break;
    }
    // Drop collinear points.
    const out = pts.filter((p, k) => {
      const a = pts[(k - 1 + pts.length) % pts.length], b = pts[(k + 1) % pts.length];
      return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
    });
    if (out.length < 3) continue;
    d += `M${out[0][0]} ${out[0][1]}` + out.slice(1).map(([x, y], k) => (x === out[k][0] ? `V${y}` : `H${x}`)).join('') + 'Z';
  }
  return d;
}

/** Many source paths -> one seam-free outline with the same pixels. */
export function outline(paths) { return trace(raster(paths)); }
