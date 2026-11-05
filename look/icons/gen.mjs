#!/usr/bin/env node
// OF house icons → a small, app-specific icon module. Lives in the tools hub repo
// (look/icons), the source of truth shown at tools.ordinary.co/look/icons.
// Pixelarticons Pro 2.7.0 (licensed per seat) + OF custom icons in custom/.
//
//   node gen-pixel-icons.mjs <app-root>          write the app's icons (reads <app-root>/pixel-icons.json)
//   node gen-pixel-icons.mjs <app-root> --check  exit 1 if the app's generated files are out of date
//   node gen-pixel-icons.mjs --find <words>      search icon names ("--find trash bin")
//   node gen-pixel-icons.mjs --all-apps [--check] run (or check) every app that has a pixel-icons.json
//
// pixel-icons.json (in the app root):
//   {
//     "dir": "src/lib/pixel-icons",          where the vendored files go
//     "react": true,                          also write PixelIcon.tsx (default true)
//     "icons": {                              key = name used in the app, value = Pixelarticons name
//       "close": "close",                     Solid if it exists, else the base style
//       "trash": "trash",
//       "nord": "circle",
//       "remote": "laptop:outline",           ":outline" (same as ":base"), ":sharp", ":glyph", ":solid"
//       "appt": { "icon": "calendar-2", "style": "outline" }   same thing, longhand
//       "resolve": "icons/resolve.svg"       a custom 24x24 SVG in the app (e.g. from the Pixel Icon Maker)
//       "search": "@search"                  PREFERRED: a house icon from house.json (change it there, every app follows)
//     }
//   }
//   "icons" may also be an array of Pixelarticons names (the key is then the name itself).
//
// Output in <dir>: paths.ts (generated path data), pixelIconDom.ts (plain DOM helper),
// PixelIcon.tsx (React), pixel-icons.css. Only the listed icons are written.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPS = process.env.OF_APPS_DIR || '/Users/jrcanest/Ordinary Folk Dropbox/Jorge R. Canedo E/Apps';
const HOUSE = path.join(HERE, 'house.json');
let houseCache = null;
function house() {
  houseCache ??= JSON.parse(fs.readFileSync(HOUSE, 'utf8')).icons;
  return houseCache;
}
const TOOLBOX_APPS = '/Users/jrcanest/Ordinary Folk Dropbox/_Ordinary Folk Projects/_OF TOOL BOX/Apps - OF';
const SOURCE = process.env.PIXELARTICONS_DIR
  || '/Users/jrcanest/Ordinary Folk Dropbox/_Ordinary Folk Projects/_OF TOOL BOX/Icons/pixelarticons-pro-2.7.0/svg';
const STYLES = ['solid', 'base', 'sharp', 'glyph'];
const RUNTIME = ['pixelIconDom.ts', 'PixelIcon.tsx', 'pixel-icons.css'];

function fail(msg) { console.error(`pixel-icons: ${msg}`); process.exit(1); }

function fileFor(name, style) {
  return path.join(SOURCE, style === 'base' ? `${name}.svg` : `${name}-${style}.svg`);
}

/** Read one icon: { d, evenOdd, style }. Solid by default, base when there is no Solid. */
/** A custom icon drawn for one app (e.g. in the Pixel Icon Maker): a 24x24 SVG file path relative to the app root. */
function readCustom(spec, appRoot) {
  const f = path.resolve(appRoot || '.', spec);
  if (!fs.existsSync(f)) fail(`custom icon not found: ${spec}`);
  const svg = fs.readFileSync(f, 'utf8');
  if (!/viewBox="0 0 24 24"/.test(svg)) fail(`${spec} is not on the 24px grid (viewBox 0 0 24 24)`);
  const paths = [...svg.matchAll(/<path\b([^>]*)\/?>/g)];
  if (!paths.length) fail(`${spec} has no <path>`);
  const d = paths.map(m => (m[1].match(/\sd="([^"]+)"/) || [])[1]).join('');
  return { name: path.basename(spec, '.svg'), style: 'custom', d, evenOdd: paths.some(m => /fill-rule="evenodd"/.test(m[1])) };
}

export function readIcon(spec, appRoot) {
  if (spec && typeof spec === 'object') spec = spec.style ? `${spec.icon}:${spec.style}` : spec.icon;
  if (spec.startsWith('@')) {
    const entry = house()[spec.slice(1)];
    if (!entry) fail(`no house icon "${spec.slice(1)}" (see look/icons/house.json)`);
    return entry.icon.endsWith('.svg') ? readCustom(entry.icon, HERE) : readIcon(entry.icon);
  }
  if (spec.endsWith('.svg')) return readCustom(spec, appRoot);
  let [name, wanted] = spec.split(':');
  if (wanted === 'outline') wanted = 'base';
  const order = wanted ? [wanted] : ['solid', 'base'];
  for (const style of order) {
    if (!STYLES.includes(style)) fail(`unknown style "${style}" in "${spec}"`);
    const f = fileFor(name, style);
    if (!fs.existsSync(f)) continue;
    const svg = fs.readFileSync(f, 'utf8');
    if (!/viewBox="0 0 24 24"/.test(svg)) fail(`${path.basename(f)} is not on the 24px grid`);
    const paths = [...svg.matchAll(/<path\b([^>]*)\/?>/g)];
    if (!paths.length) fail(`${path.basename(f)} has no <path>`);
    const d = paths.map(m => (m[1].match(/\sd="([^"]+)"/) || [])[1]).join('');
    const evenOdd = paths.some(m => /fill-rule="evenodd"/.test(m[1]));
    return { name, style, d, evenOdd };
  }
  if (!fs.existsSync(SOURCE)) fail(`icon source not found: ${SOURCE} (set PIXELARTICONS_DIR)`);
  fail(`no icon "${spec}" (try: node gen-pixel-icons.mjs --find ${name.split('-')[0]})`);
}

function camel(key) {
  const c = key.replace(/[^a-zA-Z0-9]+(.)?/g, (_, ch) => (ch ? ch.toUpperCase() : ''));
  return /^[0-9]/.test(c) ? `i${c}` : c;
}

function render(config, appRoot) {
  const entries = Array.isArray(config.icons)
    ? config.icons.map(n => [n.split(':')[0], n])
    : Object.entries(config.icons || {});
  if (!entries.length) fail('pixel-icons.json lists no icons');
  entries.sort(([a], [b]) => a.localeCompare(b));
  const lines = [
    '// GENERATED by tools/look/icons/gen.mjs (tools.ordinary.co/look). Do not edit;',
    '// change pixel-icons.json (or the house icon in tools/look/icons/house.json) and run the generator again.',
    '// Pixelarticons Pro 2.7.0, licensed to Ordinary Folk per seat. Solid style unless noted.',
    '// Each value is one SVG path on a 24x24 grid of 2px pixels.',
    '',
  ];
  const evenOdd = [];
  for (const [key, spec] of entries) {
    const icon = readIcon(spec, appRoot);
    const id = `px${camel(key).replace(/^./, c => c.toUpperCase())}`;
    const via = typeof spec === 'string' && spec.startsWith('@') ? ` · house ${spec}` : '';
    const note = (icon.style === 'solid' ? icon.name : `${icon.name} (${icon.style === 'base' ? 'outline' : icon.style})`) + via;
    lines.push(`/** ${note} */`);
    lines.push(`export const ${id} = '${icon.d}';`);
    if (icon.evenOdd) evenOdd.push(key);
  }
  lines.push('', 'export const PIXEL_ICON_PATHS = {');
  for (const [key] of entries) {
    const id = `px${camel(key).replace(/^./, c => c.toUpperCase())}`;
    lines.push(`  ${/^[a-zA-Z_$][\w$]*$/.test(key) ? key : `'${key}'`}: ${id},`);
  }
  lines.push('} as const;', '');
  lines.push('export type PixelIconName = keyof typeof PIXEL_ICON_PATHS;', '');
  lines.push(`/** Icons whose path needs fill-rule="evenodd". */`);
  lines.push(`export const PIXEL_ICON_EVENODD: ReadonlySet<string> = new Set(${JSON.stringify(evenOdd)});`, '');
  return lines.join('\n');
}

function plan(appRoot) {
  const cfgPath = path.join(appRoot, 'pixel-icons.json');
  if (!fs.existsSync(cfgPath)) fail(`no pixel-icons.json in ${appRoot}`);
  const config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const dir = path.join(appRoot, config.dir || 'src/lib/pixel-icons');
  const files = { 'paths.ts': render(config, appRoot) };
  for (const f of RUNTIME) {
    if (f === 'PixelIcon.tsx' && config.react === false) continue;
    files[f] = fs.readFileSync(path.join(HERE, 'runtime', f), 'utf8');
  }
  return { dir, files };
}

function run(appRoot, check) {
  const { dir, files } = plan(appRoot);
  let stale = [];
  for (const [f, body] of Object.entries(files)) {
    const dest = path.join(dir, f);
    const same = fs.existsSync(dest) && fs.readFileSync(dest, 'utf8') === body;
    if (same) continue;
    stale.push(path.relative(appRoot, dest));
    if (!check) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(dest, body); }
  }
  const label = path.basename(appRoot);
  if (!stale.length) console.log(`same     ${label}`);
  else console.log(`${check ? 'DIFFERS ' : 'wrote   '} ${label}: ${stale.join(', ')}`);
  return check ? stale.length === 0 : true;
}

function findApps() {
  const found = [];
  const skip = new Set(['node_modules', 'dist', 'build', '.git', '_Archive', '_shared']);
  const walk = (d, depth) => {
    if (depth > 3 || !fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory() || skip.has(e.name) || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (fs.existsSync(path.join(p, 'pixel-icons.json'))) found.push(p);
      else walk(p, depth + 1);
    }
  };
  walk(APPS, 0);
  walk(TOOLBOX_APPS, 0);
  return found;
}

function find(words) {
  const names = new Map();
  for (const f of fs.readdirSync(SOURCE)) {
    if (!f.endsWith('.svg')) continue;
    const m = f.slice(0, -4).match(/^(.*?)(?:-(solid|sharp|glyph))?$/);
    const styles = names.get(m[1]) || new Set();
    styles.add(m[2] || 'base');
    names.set(m[1], styles);
  }
  const hits = [...names].filter(([n]) => words.some(w => n.includes(w.toLowerCase())));
  for (const [n, s] of hits.sort()) console.log(`${n.padEnd(28)} ${s.has('solid') ? 'solid + outline' : 'outline only'}`);
  if (!hits.length) console.log('no match');
}

export { house };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  if (!args.length || args[0] === '--help') {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
  } else if (args[0] === '--find') {
    find(args.slice(1));
  } else if (args[0] === '--all-apps') {
    const apps = findApps();
    if (!apps.length) console.log('no app has a pixel-icons.json yet');
    const ok = apps.map(a => run(a, check)).every(Boolean);
    process.exit(ok ? 0 : 1);
  } else {
    process.exit(run(path.resolve(args[0]), check) ? 0 : 1);
  }

}
