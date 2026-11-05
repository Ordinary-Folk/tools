// Pixelarticons Pro, plain DOM helper. Vendored from tools/look/icons (tools.ordinary.co/look);
// edit it there, then run `node gen.mjs --all-apps`.
//
// Always whole pixels (12px or 24px), crisp edges, filled with the text colour.

import { PIXEL_ICON_PATHS, PIXEL_ICON_EVENODD, type PixelIconName } from './paths';

export type PixelIconSize = 12 | 24;

export interface PixelIconOptions {
  /** 12 (default, sits in a line of text) or 24. Other sizes blur the 2px grid. */
  size?: PixelIconSize;
  /** Accessible label. Without one the icon is hidden from screen readers. */
  title?: string;
  className?: string;
}

const NS = 'http://www.w3.org/2000/svg';

function escapeXml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** The icon as an SVG string, for innerHTML or template literals. */
export function pixelIconSvg(name: PixelIconName, opts: PixelIconOptions = {}): string {
  const size = opts.size ?? 12;
  const cls = `px-icon${size === 24 ? ' px-icon--24' : ''}${opts.className ? ` ${opts.className}` : ''}`;
  const rule = PIXEL_ICON_EVENODD.has(name) ? ' fill-rule="evenodd"' : '';
  const a11y = opts.title ? ' role="img"' : ' aria-hidden="true"';
  const title = opts.title ? `<title>${escapeXml(opts.title)}</title>` : '';
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges"${a11y}>${title}<path${rule} d="${PIXEL_ICON_PATHS[name]}"/></svg>`;
}

/** The icon as an element, for appendChild. */
export function createPixelIcon(name: PixelIconName, opts: PixelIconOptions = {}): SVGSVGElement {
  const size = opts.size ?? 12;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', `px-icon${size === 24 ? ' px-icon--24' : ''}${opts.className ? ` ${opts.className}` : ''}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('shape-rendering', 'crispEdges');
  if (opts.title) {
    svg.setAttribute('role', 'img');
    const t = document.createElementNS(NS, 'title');
    t.textContent = opts.title;
    svg.appendChild(t);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  const path = document.createElementNS(NS, 'path');
  if (PIXEL_ICON_EVENODD.has(name)) path.setAttribute('fill-rule', 'evenodd');
  path.setAttribute('d', PIXEL_ICON_PATHS[name]);
  svg.appendChild(path);
  return svg;
}

export { PIXEL_ICON_PATHS, type PixelIconName };
