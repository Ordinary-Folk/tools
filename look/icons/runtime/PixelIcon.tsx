// Pixelarticons Pro, React component. Vendored from tools/look/icons (tools.ordinary.co/look);
// edit it there, then run `node gen.mjs --all-apps`.

import { PIXEL_ICON_PATHS, PIXEL_ICON_EVENODD, type PixelIconName } from './paths';

export type { PixelIconName };

/**
 * One Pixelarticons Pro icon (Solid unless the app's pixel-icons.json says
 * otherwise). Whole pixels only: 12px by default, 24px with size={24}. Drawn
 * in the surrounding text colour with crisp edges so the 2px grid never blurs.
 */
export function PixelIcon({
  name,
  size = 12,
  title,
  className,
}: {
  name: PixelIconName;
  size?: 12 | 24;
  /** Accessible label. Without one the icon is hidden from screen readers. */
  title?: string;
  className?: string;
}) {
  return (
    <svg
      className={`px-icon${size === 24 ? ' px-icon--24' : ''}${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={PIXEL_ICON_PATHS[name]} fillRule={PIXEL_ICON_EVENODD.has(name) ? 'evenodd' : undefined} />
    </svg>
  );
}
