#!/usr/bin/env python3
"""
FTB Questbook — Setup Script

Two modes:
  1. Chapters only  — copies .snbt files, questpics, writes chapters.json. Fast.
  2. Full setup     — does everything above PLUS extracts textures from mod jars
                      and writes data/textures.js. Slow (first time), fast after.

Requirements for textures: pip install Pillow numpy
"""

import os, sys, io, zipfile, shutil, pathlib, json, re, platform, base64, time

try:
    from PIL import Image
    import numpy as np
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

ROOT       = pathlib.Path(__file__).parent
ASSET_QP   = ROOT / 'assets' / 'questpics'
DATA_DIR   = ROOT / 'data'
QUESTS_DIR = DATA_DIR / 'quests'
TEXTURES_F = DATA_DIR / 'textures.js'
CHAPTERS_F = DATA_DIR / 'chapters.json'

for d in [ASSET_QP, QUESTS_DIR]: d.mkdir(parents=True, exist_ok=True)

# ── Console helpers ───────────────────────────────────────
def green(s):  return f'\033[92m{s}\033[0m'
def yellow(s): return f'\033[93m{s}\033[0m'
def red(s):    return f'\033[91m{s}\033[0m'
def bold(s):   return f'\033[1m{s}\033[0m'
def ask(prompt, default=''):
    v = input(f'{yellow("?")} {prompt}{f" [{default}]" if default else ""}: ').strip()
    return v or default
def confirm(prompt, default_yes=False):
    hint = '[Y/n]' if default_yes else '[y/N]'
    v = input(f'{yellow("?")} {prompt} {hint}: ').strip().lower()
    return (v != 'n') if default_yes else (v == 'y')

# ── Platform discovery ────────────────────────────────────
def find_mc_jar():
    if platform.system() == 'Windows':
        base = pathlib.Path(os.environ.get('APPDATA','')) / '.minecraft' / 'versions'
    elif platform.system() == 'Darwin':
        base = pathlib.Path.home() / 'Library' / 'Application Support' / 'minecraft' / 'versions'
    else:
        base = pathlib.Path.home() / '.minecraft' / 'versions'
    if not base.exists(): return []
    return sorted([d/f'{d.name}.jar' for d in base.iterdir()
                   if (d/f'{d.name}.jar').exists() and re.match(r'1\.21',d.name)], reverse=True)

def find_instances():
    if platform.system() == 'Windows':
        bases = [pathlib.Path(os.environ.get('USERPROFILE',''))/'curseforge'/'minecraft'/'Instances',
                 pathlib.Path(os.environ.get('APPDATA',''))/'PrismLauncher'/'instances']
    elif platform.system() == 'Darwin':
        bases = [pathlib.Path.home()/'curseforge'/'minecraft'/'Instances',
                 pathlib.Path.home()/'Library'/'Application Support'/'PrismLauncher'/'instances']
    else:
        bases = [pathlib.Path.home()/'.local'/'share'/'PrismLauncher'/'instances']
    return [d for base in bases if base.exists()
            for d in base.iterdir() if d.is_dir() and
            any(k in d.name.lower() for k in ('atm','all the mods','allthemods'))]


# ══════════════════════════════════════════════════════════
#  SNBT SCANNER
# ══════════════════════════════════════════════════════════
SKIP_IDS = {
    'ftbquests:custom_icon', 'ftbfiltersystem:smart_filter',
    'ftbfiltersystem:item_tag', 'minecraft:air',
}
def scan_snbt_ids(text):
    ids = set()
    for m in re.finditer(r'"([a-z][a-z0-9_]*:[a-z][a-z0-9_]*)"', text):
        ids.add(m.group(1))
    for m in re.finditer(r'item\(([a-z][a-z0-9_]*:[a-z][a-z0-9_]*)\)', text):
        ids.add(m.group(1))
    for m in re.finditer(r'item_tag\((?:ftbfiltersystem:)?([a-z][a-z0-9_]*:[a-z][a-z0-9_]*)\)', text):
        ids.add(m.group(1))
    return ids - SKIP_IDS


# ══════════════════════════════════════════════════════════
#  JAR INDEXER
# ══════════════════════════════════════════════════════════
def build_jar_index(jar_paths):
    idx = {}
    for jar_path in jar_paths:
        try:
            with zipfile.ZipFile(jar_path, 'r') as zf:
                for name in zf.namelist():
                    if not name.endswith('.png') or '.mcmeta' in name: continue
                    m = re.match(r'assets/([^/]+)/textures/(item|block)/(.+)\.png$', name)
                    if m:
                        modid, ttype, fname = m.groups()
                        key = f'{modid}:{ttype}:{fname}'
                        if key not in idx:
                            idx[key] = (str(jar_path), name)
        except Exception:
            pass
    return idx


# ══════════════════════════════════════════════════════════
#  TEXTURE HELPERS
# ══════════════════════════════════════════════════════════
def load_tex(jar_path, internal_path):
    with zipfile.ZipFile(jar_path, 'r') as zf:
        data = zf.read(internal_path)
    return Image.open(io.BytesIO(data)).convert('RGBA')

def get_frametime(jar_path, internal_path):
    try:
        with zipfile.ZipFile(jar_path, 'r') as zf:
            mp = internal_path + '.mcmeta'
            if mp in zf.namelist():
                meta = json.loads(zf.read(mp))
                return int(meta.get('animation', {}).get('frametime', 1))
    except Exception:
        pass
    return None

def to_b64_png(img):
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=False)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()

def first_frame(img):
    w, h = img.size
    if h > w and h % w == 0:
        img = img.crop((0, 0, w, w))
    return img


# ══════════════════════════════════════════════════════════
#  ISO CUBE RENDERER
# ══════════════════════════════════════════════════════════
def find_block_faces(modid, name, idx):
    def try_load(*names):
        for n in names:
            key = f'{modid}:block:{n}'
            if key in idx:
                jar, path = idx[key]
                return first_frame(load_tex(jar, path))
        return None
    base  = try_load(name)
    top   = try_load(f'{name}_top',   f'{name}_top_on',   f'{name}_top_off')   or base
    side  = try_load(f'{name}_side',  f'{name}_side_all', f'{name}_side_on')   or base
    front = try_load(f'{name}_front', f'{name}_front_on', f'{name}_face')      or side or base
    return top, side, front

def make_iso_cube(top_img, left_img, right_img):
    N = 16; OUT = N * 2
    def prep(img):
        if img is None: return np.zeros((N, N, 4), dtype=np.float32)
        return np.array(first_frame(img).resize((N, N), Image.NEAREST).convert('RGBA'), dtype=np.float32)
    top_a = prep(top_img); left_a = prep(left_img); right_a = prep(right_img)
    left_a[:,:,:3] *= 0.80; right_a[:,:,:3] *= 0.65
    out = np.zeros((OUT, OUT, 4), dtype=np.uint8)
    sy, sx = np.meshgrid(np.arange(N), np.arange(N), indexing='ij')
    def blit(arr, dy, dx):
        mask = (arr[:,:,3] > 0) & (dx >= 0) & (dx < OUT) & (dy >= 0) & (dy < OUT)
        out[dy[mask], dx[mask]] = np.clip(arr[mask], 0, 255).astype(np.uint8)
    blit(left_a,  N//2 + sy + sx//2, sx)
    blit(right_a, N//2 + sy + sx//2, 2*N - 1 - sx)
    blit(top_a,   (sx + sy) // 2,    sx - sy + N)
    return Image.fromarray(out)


# ══════════════════════════════════════════════════════════
#  PROCESS ONE ITEM → base64 entry
# ══════════════════════════════════════════════════════════
FACE_SUFFIXES = ('_top','_top_on','_side','_side_all','_front','_front_on','_face')

def process_item(item_id, idx):
    if ':' not in item_id: return None, None
    modid, name = item_id.split(':', 1)

    # ── Check assets/textures/manual/ first (user-supplied PNGs) ──
    for tex_type in ('item', 'block'):
        manual_path = ROOT / 'assets' / 'textures' / 'manual' / modid / tex_type / f'{name}.png'
        if manual_path.exists():
            try:
                img = Image.open(manual_path).convert('RGBA')
                w, h = img.size
                # Animate if strip
                if h > w and h % w == 0:
                    frames = h // w
                    return {'src': to_b64_png(img), 'frames': frames, 'frametime': 1}, 'animated'
                return to_b64_png(img), 'item'
            except Exception:
                pass

    # item/ first
    item_key = f'{modid}:item:{name}'
    if item_key in idx:
        jar, path = idx[item_key]
        try:
            img = load_tex(jar, path)
            ft  = get_frametime(jar, path)
            w, h = img.size
            if ft is not None and h > w and h % w == 0:
                frames = h // w
                return {'src': to_b64_png(img), 'frames': frames, 'frametime': ft}, 'animated'
            return to_b64_png(img), 'item'
        except Exception:
            return None, None

    # block/ — base texture or face variants (e.g. teleport_pad has only _top/_side)
    block_key   = f'{modid}:block:{name}'
    has_base     = block_key in idx
    has_variants = any(f'{modid}:block:{name}{s}' in idx for s in FACE_SUFFIXES)

    if has_base or has_variants:
        try:
            if has_base:
                jar, path = idx[block_key]
                img = load_tex(jar, path)
            else:
                img = None
                for s in FACE_SUFFIXES:
                    vkey = f'{modid}:block:{name}{s}'
                    if vkey in idx:
                        jar, path = idx[vkey]
                        img = load_tex(jar, path)
                        break
            if img is None: return None, None

            w, h = img.size
            is_std = w in (8, 16, 32, 64, 128)

            if HAS_PIL and is_std and (has_variants or (h <= w)):
                top, side, front = find_block_faces(modid, name, idx)
                base_img = img if has_base else (top or side or front)
                top   = top   or base_img
                side  = side  or base_img
                front = front or base_img
                if top is not None:
                    iso = make_iso_cube(top, side, front)
                    return to_b64_png(iso), 'block_iso'

            return to_b64_png(first_frame(img)), 'block_flat'
        except Exception:
            return None, None

    return None, None


# ══════════════════════════════════════════════════════════
#  CHAPTER HELPERS
# ══════════════════════════════════════════════════════════
CHAPTER_NAMES = {
    'mainquestline':'Main Quest Line','gettingstarted':'Getting Started',
    'thermal':'Thermal Series','mekanism':'Mekanism',
    'ae2':'Applied Energistics 2','create':'Create',
    'botania':'Botania','bloodmagic':'Blood Magic',
    'endgame':'Endgame','allthemodium':'Allthemodium',
    'tinkers':"Tinkers' Construct",'immersiveengineering':'Immersive Engineering',
}
def fname_to_title(fname):
    base = re.sub(r'_part_?\d+$','',re.sub(r'_\d+$','',fname))
    key  = base.split('_')[0].lower()
    t    = CHAPTER_NAMES.get(key,' '.join(w.capitalize() for w in base.split('_')))
    if '_part_' in fname: t += f' (Part {fname.split("_part_")[-1]})'
    return t

def snbt_quick_icon(text):
    m = re.search(r'icon:\s*\{\s*(?:count:\s*\d+\s*)?id:\s*"([^"]+)"', text)
    return m.group(1) if m else None


# ══════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════
print(bold('\n⚗  FTB Questbook — Setup\n' + '─'*44))
print('  1. Chapters only  — fast, no jar scanning')
print('  2. Full setup     — chapters + texture extraction')
print()
mode = ask('Choose mode', '1').strip()
do_textures = (mode == '2')

if do_textures and not HAS_PIL:
    print(yellow('  Pillow/numpy not found. Run: pip install Pillow numpy'))
    print(yellow('  Falling back to chapters-only mode.\n'))
    do_textures = False

# ── Locate instance ───────────────────────────────────────
print(bold('\nLocating ATM10 instance'))
inst_cands = find_instances()
if inst_cands:
    for i,c in enumerate(inst_cands[:5]): print(f'  [{i}] {c}')
atm = pathlib.Path(ask('Instance folder', str(inst_cands[0]) if inst_cands else ''))
atm = atm if atm.exists() else None
if atm: print(green(f'  ✓ {atm.name}'))
else:   print(yellow('  No instance — will use files already in data/quests/'))

# ── Copy quest files ──────────────────────────────────────
print(bold('\nQuest files (.snbt)'))
quest_src = (atm/'config'/'ftbquests'/'quests'/'chapters') if atm else None
if not (quest_src and quest_src.exists()):
    s = ask('Chapters folder path (Enter to skip)','')
    quest_src = pathlib.Path(s) if s else None

snbt_files = sorted(quest_src.glob('*.snbt')) if (quest_src and quest_src.exists()) else []
if snbt_files:
    if confirm(f'Copy {len(snbt_files)} .snbt files to data/quests/?', default_yes=True):
        for f in snbt_files:
            shutil.copy2(f, QUESTS_DIR/f.name)
        print(f'  {green("✓")} Copied {len(snbt_files)} files')

local_snbts = sorted(QUESTS_DIR.glob('*.snbt'))
print(f'  {len(local_snbts)} .snbt files in data/quests/')

# ── Copy questpics ────────────────────────────────────────
print(bold('\nQuestpics'))
qp_src = (atm/'kubejs'/'assets'/'atm'/'textures'/'questpics') if atm else None
if not (qp_src and qp_src.exists()):
    s = ask('questpics folder path (Enter to skip)','')
    qp_src = pathlib.Path(s) if s else None
if qp_src and qp_src.exists():
    copied = 0
    for f in qp_src.rglob('*.png'):
        dest = ASSET_QP/f.relative_to(qp_src)
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(f,dest); copied+=1
    print(f'  {green("✓")} {copied} images → assets/questpics/')
else:
    print(yellow('  Skipping'))

# ── Build chapters.json ───────────────────────────────────
print(bold('\nBuilding chapters.json'))
existing_map = {}
if CHAPTERS_F.exists():
    try:
        for ch in json.loads(CHAPTERS_F.read_text()).get('chapters',[]): existing_map[ch.get('id','')] = ch
    except: pass

chapters = []
for snbt_f in local_snbts:
    text  = snbt_f.read_text(encoding='utf-8', errors='replace')
    ch_id = snbt_f.stem
    icon  = snbt_quick_icon(text)
    ex    = existing_map.get(ch_id,{})
    chapters.append({
        'id':          ch_id,
        'title':       ex.get('title', fname_to_title(ch_id)),
        'icon':        ex.get('icon',  icon),
        'icon_emoji':  ex.get('icon_emoji','📖'),
        'description': ex.get('description',''),
        'file':        f'data/quests/{snbt_f.name}',
    })
    print(f'  {green("✓")} {ch_id}')

pack = ask('\nPack display name','All the Mods 10')
with open(CHAPTERS_F,'w') as f:
    json.dump({'pack_name':pack,'chapters':chapters},f,indent=2)
print(f'  {green("✓")} chapters.json written — {len(chapters)} chapters')

if not do_textures:
    # Ensure a valid (possibly empty) textures.js exists so the browser doesn't hang
    if not TEXTURES_F.exists():
        TEXTURES_F.write_text('const TEXTURES = {};\n')
        print(f'\n  {yellow("ℹ")} Created empty textures.js — run mode 2 to extract textures')
    print(bold(f'\n✅ Chapters done! Open start.bat then http://localhost:8000'))
    print(f'   Run mode 2 when you want real item textures.\n')
    sys.exit(0)

# ══════════════════════════════════════════════════════════
#  TEXTURE EXTRACTION (mode 2 only)
# ══════════════════════════════════════════════════════════
print(bold('\n─'*44))
print(bold('TEXTURE EXTRACTION'))
print(bold('─'*44))

# Ensure manual textures folder exists
(ROOT / 'assets' / 'textures' / 'manual').mkdir(parents=True, exist_ok=True)

# ── Scan SNBTs for item IDs ───────────────────────────────
print(bold('\nScanning chapters for item IDs'))
all_ids = set()
for snbt_f in local_snbts:
    text = snbt_f.read_text(encoding='utf-8', errors='replace')
    all_ids |= scan_snbt_ids(text)
print(f'  {green("✓")} {len(all_ids)} unique item IDs found across {len(local_snbts)} chapters')

# ── Locate jars ───────────────────────────────────────────
print(bold('\nLocating jars'))
mc_cands = find_mc_jar()
mc_jar   = pathlib.Path(ask('Minecraft 1.21.1 jar', str(mc_cands[0]) if mc_cands else ''))
mc_jar   = mc_jar if mc_jar.exists() else None
if not mc_jar: print(yellow('  Skipping vanilla jar'))

jar_paths = []
if mc_jar: jar_paths.append(mc_jar)
mods_dir = (atm/'mods') if atm else None
if mods_dir and mods_dir.exists():
    jar_paths.extend(mods_dir.glob('*.jar'))
elif not mods_dir:
    s = ask('Path to mods/ folder (Enter to skip)','')
    if s and pathlib.Path(s).exists():
        jar_paths.extend(pathlib.Path(s).glob('*.jar'))

# ── Index all jars ────────────────────────────────────────
print(f'\n  Indexing {len(jar_paths)} jar(s)...')
t0  = time.time()
idx = build_jar_index(jar_paths)
print(f'  {green("✓")} {len(idx)} textures indexed in {time.time()-t0:.1f}s')

# ── Process only the IDs we need ─────────────────────────
print(bold(f'\nProcessing {len(all_ids)} item textures'))
textures   = {}
missing_ids = set()
counts     = {'item':0,'block_iso':0,'block_flat':0,'animated':0,'missing':0}
t0       = time.time()

for i, item_id in enumerate(sorted(all_ids)):
    entry, kind = process_item(item_id, idx)
    if entry is not None:
        textures[item_id] = entry
        counts[kind] += 1
    else:
        counts['missing'] += 1
        missing_ids.add(item_id)
    if (i+1) % 25 == 0 or (i+1) == len(all_ids):
        bar = '█' * int((i+1)/len(all_ids)*20)
        print(f'  [{bar:<20}] {i+1}/{len(all_ids)}', end='\r')

elapsed = time.time()-t0
print(f'\n  {green("✓")} Done in {elapsed:.1f}s')
print(f'     Items: {counts["item"]}  ISO cubes: {counts["block_iso"]}  '
      f'Flat: {counts["block_flat"]}  Animated: {counts["animated"]}  '
      f'Missing (emoji): {counts["missing"]}')

# ── Write textures.js ─────────────────────────────────────
print(bold('\nWriting data/textures.js'))
lines = ['// Auto-generated by setup.py — do not edit manually', 'const TEXTURES = {']
for item_id, entry in sorted(textures.items()):
    lines.append(f'  {json.dumps(item_id)}: {json.dumps(entry, separators=(",",":"))},')
lines.append('};')
out_text = '\n'.join(lines)
TEXTURES_F.write_text(out_text, encoding='utf-8')
size_kb = len(out_text.encode()) // 1024
print(f'  {green("✓")} {len(textures)} entries, {size_kb}KB')

# ── Write missing_textures.md ─────────────────────────────
print(bold('\nWriting data/missing_textures.md'))
MANUAL_DIR = ROOT / 'assets' / 'textures' / 'manual'
MISSING_F  = DATA_DIR / 'missing_textures.md'

# Figure out which chapter(s) each missing ID appears in
missing_by_chapter = {}
for snbt_f in local_snbts:
    text     = snbt_f.read_text(encoding='utf-8', errors='replace')
    ch_ids   = scan_snbt_ids(text) & missing_ids
    if ch_ids:
        missing_by_chapter[snbt_f.stem] = sorted(ch_ids)

# Build the report
md_lines = [
    '# Missing Textures',
    '',
    'These item IDs had no texture found in your mod jars.',
    'To fix: drop a PNG at the path shown, then re-run setup.py mode 2.',
    'PNGs placed in assets/textures/manual/ are picked up automatically.',
    '',
    '---',
    '',
]

total_missing = 0
for ch_id, ids in sorted(missing_by_chapter.items()):
    md_lines.append(f'## {ch_id}')
    md_lines.append('')
    for item_id in ids:
        modid, name = item_id.split(':', 1) if ':' in item_id else ('unknown', item_id)
        # Suggest item/ path first (most likely), block/ as alternative
        item_path  = f'assets/textures/manual/{modid}/item/{name}.png'
        block_path = f'assets/textures/manual/{modid}/block/{name}.png'
        md_lines.append(f'### {item_id}')
        md_lines.append(f'  Item sprite → `{item_path}`')
        md_lines.append(f'  Block faces → `{block_path}` (+ `{name}_top.png`, `{name}_side.png`)')
        md_lines.append('')
        total_missing += 1
    md_lines.append('')

MISSING_F.write_text('\n'.join(md_lines), encoding='utf-8')
print(f'  {green("✓")} missing_textures.md: {total_missing} items across {len(missing_by_chapter)} chapters')
print(f'   Drop PNGs into assets/textures/manual/ then re-run mode 2')

print(bold(f'\n✅ Full setup complete!'))
print(f'   {len(chapters)} chapters  |  {len(textures)} textures ({size_kb}KB)  |  {total_missing} missing')
print(f'\n   Windows: start.bat  |  Mac/Linux: ./start.sh')
print(f'   Open http://localhost:8000\n')
