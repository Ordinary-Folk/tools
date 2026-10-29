#!/usr/bin/env python3
"""OF scripts catalog publisher.

Scans the folders listed in the hub's scripts/catalog.json (the OF AE shelf in
Dropbox and the other tool folders), builds a manifest (files, versions,
dates, the latest changelog entry read from each script's header) and POSTs it
to the hub, so tools.ordinary.co/scripts shows what is on the shelf right now.
Runs on one Mac that has the team Dropbox synced; install.sh sets up a launchd
agent that fires when a watched folder changes and every 6 hours. Stdlib only,
python 3.9+ (the system /usr/bin/python3 is fine).

  of-scripts-catalog                 scan, publish if anything changed (or 6 h passed)
  of-scripts-catalog --dry-run       scan and print the manifest, publish nothing
  of-scripts-catalog --force         publish even if nothing changed
  of-scripts-catalog --print-watch-paths   the folders launchd should watch
"""
import argparse
import datetime
import hashlib
import json
import os
import plistlib
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

PUBLISHER_VERSION = '1.0.0'
CATALOG_URL = 'https://of-tools.pages.dev/scripts/catalog.json'
PUBLISH_URL = 'https://of-tools.pages.dev/scripts/__publish'
CONFIG_DIR = os.path.expanduser('~/Library/Application Support/Ordinary Folk/Scripts Catalog')
HEARTBEAT_SECS = 6 * 3600          # republish at least this often so "checked" stays fresh
HEADER_BYTES = 16384               # how much of a script we read for its header
TEXT_EXT = ('.jsx', '.jsxinc', '.js', '.py', '.sh', '.command', '.txt', '.md', '.bat', '.ps1')
VERSION_IN_NAME = re.compile(r'(?:^|[ _-])[vV]?(\d+)[.\-](\d+)[.\-](\d+)$')
CHANGELOG_HEAD = re.compile(r'^(?:(editor|panel|loader|web)\s+)?[vV]?(\d+\.\d+\.\d+)\b[\s:(,—–-]*(\d{4}-\d{2}-\d{2})?\)?[\s:,—–-]*(.*)$')


def log(msg):
    print(datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'), msg, flush=True)


def iso(ts):
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def dropbox_root():
    """The folder that holds the team folders (parent of the member folder), like the dbxlinks helper."""
    try:
        with open(os.path.expanduser('~/.dropbox/info.json'), encoding='utf-8') as f:
            info = json.load(f)
        acct = info.get('business') or info.get('personal')
        path = acct and acct.get('path')
        if path:
            parent = os.path.dirname(path)
            base = os.path.basename(parent)
            if base.endswith(' Dropbox') or base.startswith('Dropbox-'):
                return parent
            return path
    except Exception:
        pass
    return os.path.expanduser('~/Ordinary Folk Dropbox')


def fetch_json(url, timeout=20):
    req = urllib.request.Request(url, headers={'User-Agent': 'of-scripts-catalog/' + PUBLISHER_VERSION})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def load_catalog(url):
    cache = os.path.join(CONFIG_DIR, 'catalog-cache.json')
    try:
        cat = fetch_json(url)
        os.makedirs(CONFIG_DIR, exist_ok=True)
        with open(cache, 'w', encoding='utf-8') as f:
            json.dump(cat, f)
        return cat
    except Exception as e:  # offline: last known catalog
        if os.path.exists(cache):
            log('catalog fetch failed (%s), using cached copy' % e)
            with open(cache, encoding='utf-8') as f:
                return json.load(f)
        raise


def is_placeholder(path):
    """Dropbox online-only file: 0 bytes on disk with the placeholder xattr."""
    try:
        if os.path.getsize(path) != 0:
            return False
    except OSError:
        return False
    # macOS python has no os.getxattr; a 0-byte file is rare enough to shell out
    r = subprocess.run(['/usr/bin/xattr', '-p', 'com.dropbox.placeholder', path], capture_output=True)
    return r.returncode == 0


def read_head(path, n=HEADER_BYTES):
    with open(path, 'rb') as f:
        return f.read(n).decode('utf-8', 'replace')


def strip_comment(line):
    line = line.rstrip()
    line = re.sub(r'^\s*(/\*+|\*+/|//+|#+|\*(?!/)|\s)+', '', line)
    return line.rstrip(' */')


def parse_header(text):
    """Title line, a short summary and the newest changelog entry from a script header."""
    out = {}
    lines = text.splitlines()
    cleaned = [strip_comment(l) for l in lines[:400]]
    body = [l for l in cleaned[:40] if l and not re.fullmatch(r'[=\-_]{3,}', l)]
    if body:
        out['title'] = body[0][:160]
        summary = []
        for l in body[1:6]:
            if re.match(r'(?i)^(install|use|usage|setup|changelog|requires|needs)\b', l):
                break
            summary.append(l)
        if summary:
            out['summary'] = ' '.join(summary)[:400]
    # changelog: the first entry after a "Changelog" line
    start = None
    for i, l in enumerate(cleaned):
        if re.match(r'(?i)^changelog\b', l):
            start = i + 1
            break
    if start is None:
        return out
    entry = None
    for l in cleaned[start:start + 120]:
        raw = l
        if raw.startswith('====') or raw.startswith('Built ') or raw.startswith('Do not edit'):
            break
        m = CHANGELOG_HEAD.match(raw)
        if m:
            if entry:
                break  # the next (older) entry starts here
            entry = {'version': m.group(2), 'notes': []}
            if m.group(1):
                entry['part'] = m.group(1)
            if m.group(3):
                entry['date'] = m.group(3)
            rest = m.group(4).strip(' -:')
            if rest:
                entry['notes'].append(rest)
            continue
        if entry is None:
            continue
        if not raw.strip():
            if entry['notes']:
                # a blank line ends the entry unless bullets continue right after
                continue
            continue
        note = re.sub(r'^\s*[-*•]\s*', '', raw).strip()
        if not note:
            continue
        if entry['notes'] and not re.match(r'^\s*[-*•]', raw) and raw.startswith(' ' * 2):
            entry['notes'][-1] = (entry['notes'][-1] + ' ' + note).strip()
        elif re.match(r'^\s*[-*•]', raw) or not entry['notes'] or raw.startswith(' '):
            entry['notes'].append(note)
        else:
            entry['notes'][-1] = (entry['notes'][-1] + ' ' + note).strip()
    if entry:
        entry['notes'] = [re.sub(r'\*\*', '', n)[:400] for n in entry['notes'][:8]]
        out['changelog'] = entry
    return out


def bundle_info(path):
    info = {}
    plist = os.path.join(path, 'Contents', 'Info.plist')
    try:
        with open(plist, 'rb') as f:
            p = plistlib.load(f)
        v = p.get('CFBundleShortVersionString') or p.get('CFBundleVersion')
        if v:
            info['version'] = str(v)
        info['mtime'] = iso(os.path.getmtime(plist))
    except Exception:
        info['mtime'] = iso(os.path.getmtime(path))
    total = 0
    for root, _dirs, files in os.walk(path):
        for n in files:
            try:
                total += os.path.getsize(os.path.join(root, n))
            except OSError:
                pass
    info['size'] = total
    return info


def scan_folder(abs_path, ignore):
    if not os.path.isdir(abs_path):
        return None
    entries = []
    for name in sorted(os.listdir(abs_path), key=str.lower):
        if name.startswith('.') or name in ignore or name.rstrip('\r') == 'Icon':   # Finder custom-icon file
            continue
        p = os.path.join(abs_path, name)
        try:
            st = os.stat(p)
        except OSError:
            continue
        is_dir = os.path.isdir(p)
        bundle = is_dir and name.lower().endswith('.app')
        if is_dir and not bundle:
            entries.append({'name': name, 'kind': 'dir', 'mtime': iso(st.st_mtime)})
            continue
        e = {'name': name, 'kind': 'bundle' if bundle else 'file', 'size': st.st_size, 'mtime': iso(st.st_mtime)}
        stem, ext = os.path.splitext(name)
        m = VERSION_IN_NAME.search(stem)
        if m:
            e['version'] = '.'.join(m.groups())
        if bundle:
            e.update(bundle_info(p))
        elif is_placeholder(p):
            e['onlineOnly'] = True
        elif name == 'VERSION' and st.st_size < 64:
            e['text'] = read_head(p, 64).strip()
            e['version'] = e['text']
        elif ext.lower() in TEXT_EXT and st.st_size > 0:
            e.update(parse_header(read_head(p)))
        elif ext.lower() in ('.html', '.htm') and st.st_size < 4_000_000:
            with open(p, 'rb') as f:
                head = f.read(4_000_000).decode('utf-8', 'replace')
            vm = re.search(r'data-[a-z-]*version="([^"]+)"', head)
            if vm:
                e['version'] = vm.group(1)
        entries.append(e)
    return entries


def build_manifest(catalog, root):
    folders = {}
    for fid, spec in catalog['folders'].items():
        abs_path = os.path.join(root, spec['path'])
        entries = scan_folder(abs_path, set(spec.get('ignore', [])))
        folders[fid] = {'path': spec['path'], 'exists': entries is not None, 'entries': entries or []}
    return {
        'generated': iso(time.time()),
        'generator': 'of-scripts-catalog ' + PUBLISHER_VERSION,
        'host': socket.gethostname(),
        'dropboxRoot': root,
        'folders': folders,
    }


def manifest_hash(manifest):
    return hashlib.sha256(json.dumps(manifest['folders'], sort_keys=True).encode('utf-8')).hexdigest()


def publish(manifest, url, secret):
    body = json.dumps(manifest).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST', headers={
        'Content-Type': 'application/json',
        'X-Hub-Secret': secret,
        'User-Agent': 'of-scripts-catalog/' + PUBLISHER_VERSION,
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read().decode('utf-8', 'replace')[:200]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--catalog-url', default=CATALOG_URL)
    ap.add_argument('--publish-url', default=PUBLISH_URL)
    ap.add_argument('--dropbox-root', default=None, help='default: from ~/.dropbox/info.json')
    ap.add_argument('--secret-file', default=os.path.join(CONFIG_DIR, 'publish-secret'))
    ap.add_argument('--dry-run', action='store_true', help='print the manifest, publish nothing')
    ap.add_argument('--force', action='store_true', help='publish even if nothing changed')
    ap.add_argument('--print-watch-paths', action='store_true', help='print the absolute folders to watch, one per line')
    args = ap.parse_args()

    root = args.dropbox_root or dropbox_root()
    catalog = load_catalog(args.catalog_url)

    if args.print_watch_paths:
        for spec in catalog['folders'].values():
            print(os.path.join(root, spec['path']))
        return 0

    manifest = build_manifest(catalog, root)
    if args.dry_run:
        print(json.dumps(manifest, indent=1))
        return 0

    os.makedirs(CONFIG_DIR, exist_ok=True)
    state_path = os.path.join(CONFIG_DIR, 'state.json')
    state = {}
    if os.path.exists(state_path):
        with open(state_path, encoding='utf-8') as f:
            state = json.load(f)
    digest = manifest_hash(manifest)
    age = time.time() - float(state.get('publishedAt', 0))
    if not args.force and state.get('hash') == digest and age < HEARTBEAT_SECS:
        log('unchanged (last publish %d min ago)' % (age // 60))
        return 0

    try:
        with open(args.secret_file, encoding='utf-8') as f:
            secret = f.read().strip()
    except OSError:
        log('no publish secret at %s (run install.sh)' % args.secret_file)
        return 2
    try:
        status, text = publish(manifest, args.publish_url, secret)
    except urllib.error.HTTPError as e:
        log('publish failed: HTTP %s %s' % (e.code, e.read().decode('utf-8', 'replace')[:200]))
        return 1
    except Exception as e:
        log('publish failed: %s' % e)
        return 1
    state = {'hash': digest, 'publishedAt': time.time(), 'generated': manifest['generated']}
    with open(state_path, 'w', encoding='utf-8') as f:
        json.dump(state, f)
    n = sum(len(f['entries']) for f in manifest['folders'].values())
    log('published %d entries in %d folders (%s): HTTP %s %s' % (n, len(manifest['folders']), 'changed' if age >= HEARTBEAT_SECS and state.get('hash') == digest else 'changed', status, text))
    return 0


if __name__ == '__main__':
    sys.exit(main())
