// ═══════════════════════════════════════════════════════════
//  FTB Questbook — app.js
// ═══════════════════════════════════════════════════════════

let CHAPTERS   = [];
let QUEST_MAP  = {};
let completed  = new Set(JSON.parse(localStorage.getItem('ftbq_done') || '[]'));
let selQuest   = null;
let activeChap = null;

let zoom = 1, panX = 0, panY = 0;
let isPanning = false, lastMX = 0, lastMY = 0;
let didPan    = false;

const SCALE      = 100;
const NODE_BASE  = 52;   // px for size=1.0 quest
const PAD        = 80;
const CHUNK_SIZE = 25;

// ── WEB WORKER ────────────────────────────────────────────
const workerPool = [], workerQueue = new Map();
function getWorker() {
  if (workerPool.length) return workerPool.pop();
  const w = new Worker('js/snbt-parser.worker.js');
  w.onmessage = ({ data: msg }) => {
    const p = workerQueue.get(msg.chapterId); if (!p) return;
    if (msg.type === 'progress') p.onProgress?.(msg.msg, msg.pct);
    else if (msg.type === 'done')  { workerQueue.delete(msg.chapterId); workerPool.push(w); p.resolve(msg); }
    else if (msg.type === 'error') { workerQueue.delete(msg.chapterId); workerPool.push(w); p.reject(new Error(msg.error)); }
  };
  return w;
}
function parseWithWorker(chapterId, snbt, onProgress) {
  return new Promise((resolve, reject) => {
    workerQueue.set(chapterId, { resolve, reject, onProgress });
    getWorker().postMessage({ snbt, chapterId });
  });
}

// ── ITEM DATABASE ─────────────────────────────────────────
const IDB = {
  "minecraft:oak_log":["🌲","Oak Log","Minecraft"],
  "minecraft:crafting_table":["📋","Crafting Table","Minecraft"],
  "minecraft:wooden_pickaxe":["⛏","Wooden Pickaxe","Minecraft"],
  "minecraft:furnace":["🧱","Furnace","Minecraft"],
  "minecraft:coal":["⬛","Coal","Minecraft"],
  "minecraft:iron_ingot":["⬜","Iron Ingot","Minecraft"],
  "minecraft:copper_ingot":["🟤","Copper Ingot","Minecraft"],
  "minecraft:iron_pickaxe":["⛏","Iron Pickaxe","Minecraft"],
  "minecraft:redstone":["🔴","Redstone Dust","Minecraft"],
  "minecraft:diamond":["💎","Diamond","Minecraft"],
  "minecraft:obsidian":["🟣","Obsidian","Minecraft"],
  "minecraft:ender_pearl":["🟢","Ender Pearl","Minecraft"],
  "minecraft:netherite_ingot":["🖤","Netherite Ingot","Minecraft"],
  "minecraft:wither_skeleton_skull":["💀","Wither Skeleton Skull","Minecraft"],
  "minecraft:soul_sand":["🟫","Soul Sand","Minecraft"],
  "minecraft:sculk_shrieker":["📢","Sculk Shrieker","Minecraft"],
  "minecraft:torch":["🕯","Torch","Minecraft"],
  "minecraft:cooked_beef":["🥩","Cooked Beef","Minecraft"],
  "minecraft:bucket":["🪣","Bucket","Minecraft"],
  "minecraft:dragon_egg":["🥚","Dragon Egg","Minecraft"],
  "minecraft:warden":["👹","Warden","Minecraft"],
  "minecraft:diamond_pickaxe":["💎","Diamond Pickaxe","Minecraft"],
  "minecraft:diamond_sword":["💎","Diamond Sword","Minecraft"],
  "minecraft:netherite_pickaxe":["🖤","Netherite Pickaxe","Minecraft"],
  "minecraft:netherite_sword":["🖤","Netherite Sword","Minecraft"],
  "mekanism:osmium_ingot":["🔵","Osmium Ingot","Mekanism"],
  "mekanism:basic_energy_cube":["🔋","Basic Energy Cube","Mekanism"],
  "mekanism:digital_miner":["⛏","Digital Miner","Mekanism"],
  "mekanism:jetpack":["🚀","Jetpack","Mekanism"],
  "powah:energy_cell_starter":["🔋","Starter Energy Cell","Powah"],
  "pipez:energy_pipe":["🔌","Energy Pipe","Pipez"],
};
const MOD_NAMES = {
  minecraft:'Minecraft', mekanism:'Mekanism', mekanismgenerators:'Mekanism Generators',
  powah:'Powah', generatorgalore:'Generator Galore', pipez:'Pipez',
  alltheores:'All The Ores', ironfurnaces:'Iron Furnaces',
  crafting_on_a_stick:'Crafting On A Stick', ftbfiltersystem:'FTB Filter System',
  atm:'All the Mods', create:'Create', botania:'Botania', ae2:'Applied Energistics 2',
  occultism:'Occultism', productivetrees:'Productive Trees', artifacts:'Artifacts',
  allthemodium:'Allthemodium', ars_nouveau:'Ars Nouveau', bloodmagic:'Blood Magic',
  alexsmobs:'Alex\'s Mobs', twilightforest:'Twilight Forest', thermal:'Thermal',
  industrialforegoing:'Industrial Foregoing', immersiveengineering:'Immersive Engineering',
};
function itemName(id)  {
  if (!id) return '';
  return IDB[id]?.[1] || id.split(':').pop().split('_').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ');
}
function itemEmoji(id) { return IDB[id]?.[0] || '📦'; }
function itemMod(id)   { return IDB[id]?.[2] || MOD_NAMES[id?.split(':')[0]] || id?.split(':')[0] || ''; }

// Handles both string "modid:name" and object {id:"modid:name"} item fields
function getItemId(item) {
  if (!item) return '';
  if (typeof item === 'string') return item;
  return item.id || '';
}

function parseFilter(f) {
  if (!f) return { name: 'Smart Filter', id: null };
  const t = f.match(/item_tag\(([^)]+)\)/);
  if (t) { const tid = t[1].replace('ftbfiltersystem:', ''); return { name: itemName(tid), id: tid }; }
  const it = f.match(/item\(([^)]+)\)/);
  if (it) return { name: itemName(it[1]), id: it[1] };
  return { name: 'Smart Filter', id: null };
}

// ── TEXTURE HELPERS ───────────────────────────────────────
function texEntry(id) { return (id && typeof TEXTURES !== 'undefined') ? (TEXTURES[id] || null) : null; }
function texSrc(id)   { const t = texEntry(id); return t ? (typeof t === 'string' ? t : t.src) : null; }
function isAnimated(id) { const t = texEntry(id); return !!(t && typeof t === 'object' && t.frames); }

function resolveImageSrc(p) {
  if (!p) return null;
  const atm = p.match(/^atm:textures\/questpics\/(.+)\.png$/);
  if (atm) return `assets/questpics/${atm[1]}.png`;
  const mc  = p.match(/^minecraft:(block|item)\/(.+)$/);
  if (mc)  return texSrc(`minecraft:${mc[2]}`);
  const mod = p.match(/^([^:]+):(block|item)\/(.+)$/);
  if (mod) return texSrc(`${mod[1]}:${mod[3]}`);
  return null;
}

// ── QUEST ICON WATERFALL ──────────────────────────────────
function resolveQuestIcon(q) {
  // 1. Custom icon path
  if (q._customIconPath) {
    const src = resolveImageSrc(q._customIconPath);
    if (src) return { src, id: null, animated: false };
  }
  // 2. Worker-derived _iconId
  if (q._iconId) {
    if (isAnimated(q._iconId)) { const t = texEntry(q._iconId); return { src: t.src, id: q._iconId, animated: true, frames: t.frames }; }
    const src = texSrc(q._iconId);
    if (src) return { src, id: q._iconId, animated: false };
  }
  // 3. Explicit quest icon field
  const rawIcon = q.icon?.id || (typeof q.icon === 'string' ? q.icon : null);
  if (rawIcon && rawIcon !== 'ftbquests:custom_icon') {
    if (isAnimated(rawIcon)) { const t = texEntry(rawIcon); return { src: t.src, id: rawIcon, animated: true, frames: t.frames }; }
    const src = texSrc(rawIcon);
    if (src) return { src, id: rawIcon, animated: false };
  }
  // 4. First task item
  const ft = (q.tasks || [])[0];
  if (ft) {
    let tid = null;
    if (ft.type === 'item') {
      const iid = getItemId(ft.item);
      if (iid === 'ftbfiltersystem:smart_filter') {
        const fs = ft.item?.components?.['ftbfiltersystem:filter'] || '';
        const m  = fs.match(/item\(([^)]+)\)/); if (m) tid = m[1];
      } else tid = iid;
    } else if (ft.type === 'kill')  tid = ft.entity || '';
    else if (ft.type === 'biome')   tid = ft.biome  || '';
    if (tid) {
      if (isAnimated(tid)) { const t = texEntry(tid); return { src: t.src, id: tid, animated: true, frames: t.frames }; }
      const src = texSrc(tid);
      if (src) return { src, id: tid, animated: false };
    }
  }
  // 5. First reward item
  const fr = (q.rewards || []).find(r => r.type === 'item');
  if (fr) {
    const rid = getItemId(fr.item);
    if (rid) {
      if (isAnimated(rid)) { const t = texEntry(rid); return { src: t.src, id: rid, animated: true, frames: t.frames }; }
      const src = texSrc(rid);
      if (src) return { src, id: rid, animated: false };
    }
  }
  // 6. Emoji fallback
  return { src: null, id: q._iconId || rawIcon || null, animated: false };
}

// ── SLOT BUILDER ──────────────────────────────────────────
function makeSlot(itemId, size = 36, customSrc = null) {
  const div = document.createElement('div');
  div.className = 'islot';
  div.style.cssText = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.55)}px;flex-shrink:0;`;
  const src = customSrc || texSrc(itemId);
  if (isAnimated(itemId) && !customSrc) {
    const t = texEntry(itemId);
    div.style.overflow = 'hidden';
    const img = document.createElement('img');
    img.src = t.src; img.className = `iimg-anim anim-${t.frames}`; img.alt = ''; img.draggable = false;
    img.style.cssText = `width:100%;height:auto;image-rendering:pixelated;display:block;`;
    div.appendChild(img);
  } else if (src) {
    const img = document.createElement('img');
    img.src = src; img.className = 'iimg'; img.alt = ''; img.draggable = false;
    div.appendChild(img);
  } else {
    div.textContent = itemEmoji(itemId || '');
  }
  return div;
}

// ── SVG SHAPES ────────────────────────────────────────────
function shapeEl(shape, status, optional, S) {
  const cx = S / 2, cy = S / 2, r = S / 2 - 1.5;
  const sc = status === 'complete' ? '#55ff55' : status === 'available' ? '#55ff55' : '#3a3a3a';
  const da = optional ? ' stroke-dasharray="4 3"' : '';
  const a  = `fill="#1e1e1e" stroke="${sc}" stroke-width="2" class="qshape"${da}`;
  const hex = (rr = r) => Array.from({ length: 6 }, (_, i) => { const ag = (i * 60 - 90) * Math.PI / 180; return `${(cx + rr * Math.cos(ag)).toFixed(1)},${(cy + rr * Math.sin(ag)).toFixed(1)}`; }).join(' ');
  const oct = (rr = r) => Array.from({ length: 8 }, (_, i) => { const ag = (i * 45 - 90) * Math.PI / 180; return `${(cx + rr * Math.cos(ag)).toFixed(1)},${(cy + rr * Math.sin(ag)).toFixed(1)}`; }).join(' ');
  function gear(r1 = r, r2 = r * .67, teeth = 8) { const pts = [], ta = Math.PI / teeth, ht = ta * .38; for (let i = 0; i < teeth; i++) { const ag = (i / teeth) * 2 * Math.PI - Math.PI / 2; pts.push([cx + r2 * Math.cos(ag - ht * 1.3), cy + r2 * Math.sin(ag - ht * 1.3)], [cx + r1 * Math.cos(ag - ht * .55), cy + r1 * Math.sin(ag - ht * .55)], [cx + r1 * Math.cos(ag + ht * .55), cy + r1 * Math.sin(ag + ht * .55)], [cx + r2 * Math.cos(ag + ht * 1.3), cy + r2 * Math.sin(ag + ht * 1.3)]); } return 'M ' + pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' L ') + ' Z'; }
  switch (shape) {
    case 'hexagon': return `<polygon ${a} points="${hex()}"/>`;
    case 'octagon': return `<polygon ${a} points="${oct()}"/>`;
    case 'diamond': return `<polygon ${a} points="${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}"/>`;
    case 'circle':  return `<circle  ${a} cx="${cx}" cy="${cy}" r="${r}"/>`;
    case 'rsquare': return `<rect    ${a} x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" rx="${r * .3}"/>`;
    case 'gear':    return `<path    ${a} d="${gear()}"/>`;
    case 'heart':   return `<path    ${a} d="M${cx},${cy + r * .85} C${cx - 1},${cy + r * .85} ${cx - r},${cy + r * .2} ${cx - r},${cy - r * .1} C${cx - r},${cy - r * .7} ${cx - r * .5},${cy - r} ${cx},${cy - r * .4} C${cx + r * .5},${cy - r} ${cx + r},${cy - r * .7} ${cx + r},${cy - r * .1} C${cx + r},${cy + r * .2} ${cx + 1},${cy + r * .85} ${cx},${cy + r * .85} Z"/>`;
    default:        return `<rect    ${a} x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" rx="3"/>`;
  }
}

// ── QUEST META (inline fallback) ──────────────────────────
function questMeta(q) {
  let iconId = null, customIconPath = null, title = null, taskIconId = null;
  const raw = q.icon;
  if (raw?.id === 'ftbquests:custom_icon') customIconPath = raw?.components?.['ftbquests:icon'] || null;
  else if (raw?.id) iconId = raw.id;
  else if (typeof raw === 'string' && raw.includes(':')) iconId = raw;
  const tasks = q.tasks || [];
  if (tasks.length) {
    const t = tasks[0]; taskIconId = getItemId(t.icon) || null; const tt = t.type || '';
    if (tt === 'item') { const iid = getItemId(t.item); if (iid === 'ftbfiltersystem:smart_filter') { const fi = parseFilter(t.item?.components?.['ftbfiltersystem:filter']); title = fi.name; taskIconId = taskIconId || fi.id; } else if (iid) { title = itemName(taskIconId || iid); taskIconId = taskIconId || iid; } }
    else if (tt === 'kill')  { const e = t.entity || ''; taskIconId = taskIconId || e; title = 'Kill ' + itemName(e); }
    else if (tt === 'biome') { const b = t.biome  || ''; taskIconId = taskIconId || b; title = 'Visit ' + itemName(b); }
    else if (tt === 'advancement') { const adv = t.advancement || ''; const ai = 'minecraft:' + adv.split('/').pop(); taskIconId = taskIconId || ai; title = itemName(ai); }
    else if (tt === 'checkmark') title = 'Optional Task';
  }
  if (customIconPath) return { iconId: null, customIconPath, title: title || 'Quest' };
  const idSrc = iconId || taskIconId || null;
  return { iconId: idSrc, customIconPath: null, title: title || itemName(idSrc || '') || 'Quest' };
}

// ── STATUS / LAYOUT ───────────────────────────────────────
function questStatus(q) {
  if (completed.has(q.id)) return 'complete';
  return (q.dependencies || []).every(d => completed.has(d)) ? 'available' : 'locked';
}
function computeLayout(quests) {
  const xs = quests.map(q => q.x || 0), ys = quests.map(q => q.y || 0);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  return {
    px: x => (x - minX) * SCALE + PAD + 60,
    py: y => (y - minY) * SCALE + PAD,
    W: (maxX - minX) * SCALE + PAD * 2 + 120,
    H: (maxY - minY) * SCALE + PAD * 2 + 80,
  };
}

// ── PAN / ZOOM ────────────────────────────────────────────
function applyTransform() {
  const t = `translate(${panX}px,${panY}px) scale(${zoom})`;
  document.getElementById('qcanvas').style.transform  = t;
  document.getElementById('bg-layer').style.transform = t;
  document.getElementById('zoom-label').textContent   = Math.round(zoom * 100) + '%';
}

function centerChapter(W, H) {
  const wrap = document.getElementById('qwrap');
  const vw = wrap.clientWidth, vh = wrap.clientHeight;
  // Start zoomed so nodes are comfortably visible — floor at 0.75
  const fitZoom = Math.min(vw / W, vh / H) * 1.0;
  zoom = Math.max(0.75, Math.min(1.1, fitZoom));
  panX = vw / 2 - (W / 2) * zoom;
  panY = vh / 2 - (H / 2) * zoom;
  applyTransform();
}

function setupPanZoom() {
  const wrap = document.getElementById('qwrap');
  wrap.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    isPanning = true; didPan = false; lastMX = e.clientX; lastMY = e.clientY;
    wrap.classList.add('panning');
  });
  document.addEventListener('mousemove', e => {
    if (!isPanning) return;
    const dx = e.clientX - lastMX, dy = e.clientY - lastMY;
    if (Math.abs(dx) + Math.abs(dy) > 3) didPan = true;
    panX += dx; panY += dy; lastMX = e.clientX; lastMY = e.clientY;
    applyTransform();
  });
  document.addEventListener('mouseup', () => { isPanning = false; document.getElementById('qwrap').classList.remove('panning'); });
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = wrap.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    const nz = Math.max(0.15, Math.min(5, zoom * delta));
    panX = mx - (mx - panX) * (nz / zoom); panY = my - (my - panY) * (nz / zoom); zoom = nz;
    applyTransform();
  }, { passive: false });
  document.getElementById('zoom-reset').addEventListener('click', () => {
    if (activeChap?._layout) centerChapter(activeChap._layout.W, activeChap._layout.H);
  });
}

// ── DEP CHAIN HIGHLIGHT (immediate deps only — no lag) ────
function highlightChain(questId) {
  const q = QUEST_MAP[questId];
  const immDeps = new Set(q?.dependencies || []);
  document.querySelectorAll('#depsvg .dl').forEach(l => {
    l.classList.toggle('chain', l.dataset.to === questId && immDeps.has(l.dataset.from));
  });
  document.querySelectorAll('.qnode').forEach(n => {
    n.classList.toggle('chain-ancestor', immDeps.has(n.dataset.id));
  });
}
function clearChain() {
  document.querySelectorAll('#depsvg .dl.chain').forEach(l => l.classList.remove('chain'));
  document.querySelectorAll('.qnode.chain-ancestor').forEach(n => n.classList.remove('chain-ancestor'));
}

// ── QUEST HOVER TOOLTIP ───────────────────────────────────
function showQuestTooltip(e, q) {
  const tt = document.getElementById('quest-tooltip');
  document.getElementById('qt-title').textContent = q._title || '';
  const desc = q.subtitle || q.description || '';
  const d = document.getElementById('qt-desc'); d.textContent = desc; d.style.display = desc ? 'block' : 'none';
  tt.classList.add('show'); moveQuestTooltip(e);
}
function hideQuestTooltip() { document.getElementById('quest-tooltip').classList.remove('show'); }
function moveQuestTooltip(e) {
  const tt = document.getElementById('quest-tooltip');
  let x = e.clientX + 16, y = e.clientY + 10;
  if (x + 310 > innerWidth) x = e.clientX - 320; if (y + 120 > innerHeight) y = e.clientY - 110;
  tt.style.left = x + 'px'; tt.style.top = y + 'px';
}
document.addEventListener('mousemove', e => { if (document.getElementById('quest-tooltip').classList.contains('show')) moveQuestTooltip(e); });

// ── INIT ──────────────────────────────────────────────────
async function init() {
  setLoading('Loading chapters...', 30);
  let chapData;
  try { const r = await fetch('data/chapters.json'); if (!r.ok) throw new Error(); chapData = await r.json(); }
  catch (e) { showError('⚠ No chapters found', 'data/chapters.json missing.', 'Run setup.py first.'); return; }
  CHAPTERS = chapData.chapters || [];
  if (!CHAPTERS.length) { showError('⚠ No chapters', 'chapters.json empty.', 'Run setup.py first.'); return; }
  document.getElementById('pack-name').textContent = chapData.pack_name || '';
  setLoading('Ready!', 100);
  setTimeout(() => document.getElementById('loading').classList.add('hidden'), 200);
  workerPool.push(getWorker());
  setupPanZoom();
  renderSidebar();
  loadChapter(CHAPTERS[0]);
}

// ── SIDEBAR ───────────────────────────────────────────────
function renderSidebar() {
  const list = document.getElementById('chaplist'); list.innerHTML = '';
  CHAPTERS.forEach(ch => {
    const btn = document.createElement('button');
    btn.className = 'cbtn' + (activeChap?.id === ch.id ? ' active' : ''); btn.dataset.id = ch.id;
    const ico = document.createElement('div'); ico.className = 'cbico';
    const icoSrc = ch.icon ? texSrc(ch.icon) : null;
    if (icoSrc) { const img = document.createElement('img'); img.src = icoSrc; img.style.cssText = 'width:100%;height:100%;object-fit:contain;image-rendering:pixelated;'; ico.appendChild(img); }
    else ico.textContent = ch.icon_emoji || '📖';
    const nm = document.createElement('span'); nm.className = 'cname'; nm.textContent = ch.title;
    btn.appendChild(ico); btn.appendChild(nm);
    btn.addEventListener('click', () => loadChapter(ch));
    list.appendChild(btn);
  });
}

// ── CHAPTER LOADING ───────────────────────────────────────
function showProgress(title, msg, pct) {
  document.getElementById('qhtitle').textContent = title;
  document.getElementById('qhdesc').innerHTML = `<span style="color:var(--yellow)">${msg}</span><span style="display:inline-block;width:90px;height:4px;background:rgba(0,0,0,.4);border:1px solid #555;margin-left:10px;vertical-align:middle"><span style="display:block;height:100%;background:var(--green);width:${pct}%"></span></span>`;
}

async function loadChapter(chDef) {
  if (!chDef || chDef._loading) return;
  activeChap = chDef; selQuest = null; closeDetail();
  document.querySelectorAll('.cbtn').forEach(b => b.classList.toggle('active', b.dataset.id === chDef.id));
  document.getElementById('qcanvas').querySelectorAll('.qnode').forEach(n => n.remove());
  document.getElementById('bg-layer').innerHTML = '';
  document.getElementById('depsvg').innerHTML = '';

  if (chDef._data) {
    document.getElementById('qhtitle').textContent = chDef.title;
    document.getElementById('qhdesc').textContent = chDef.description || '';
    QUEST_MAP = Object.fromEntries((chDef._data.quests || []).map(q => [q.id, q]));
    await renderQuests(chDef); return;
  }

  chDef._loading = true;
  showProgress(chDef.title, 'Fetching...', 5);
  let snbt;
  try {
    const r = await fetch(chDef.file); if (!r.ok) throw new Error(`HTTP ${r.status}`);
    snbt = await r.text();
  } catch (e) { chDef._loading = false; document.getElementById('qhdesc').textContent = `⚠ ${e.message}`; return; }

  showProgress(chDef.title, 'Parsing...', 20);
  let parsed;
  try {
    parsed = await parseWithWorker(chDef.id, snbt, (msg, pct) => showProgress(chDef.title, msg, 20 + pct * .45));
  } catch (e) { chDef._loading = false; document.getElementById('qhdesc').textContent = `⚠ Parse error: ${e.message}`; return; }

  chDef._data   = parsed.data;
  chDef._quests = (parsed.data.quests || []).filter(q => !q.invisible);
  chDef._loading = false;
  QUEST_MAP = Object.fromEntries((parsed.data.quests || []).map(q => [q.id, q]));

  renderSidebar();
  document.getElementById('qhdesc').textContent = chDef.description || '';
  await new Promise(r => requestAnimationFrame(r));
  await renderQuests(chDef);
  document.getElementById('qhtitle').textContent = chDef.title;
}

// ── RENDER QUEST GRID ─────────────────────────────────────
function renderBgImages(images, px, py) {
  const layer = document.getElementById('bg-layer'); layer.innerHTML = '';
  if (!images?.length) return;
  [...images].sort((a, b) => (a.order || 0) - (b.order || 0)).forEach(img => {
    const src = resolveImageSrc(img.image || '');
    const div = document.createElement('div'); div.className = 'bg-img';
    div.style.cssText = `left:${px(img.x || 0)}px;top:${py(img.y || 0)}px;width:${(img.width || 1) * SCALE}px;height:${(img.height || 1) * SCALE}px;transform:translate(-50%,-50%) translateZ(0) rotate(${img.rotation || 0}deg);z-index:${(img.order || 0) < 0 ? 0 : 2};`;
    if (src) { const el = document.createElement('img'); el.src = src; el.style.cssText = 'width:100%;height:100%;object-fit:contain;image-rendering:pixelated;display:block;'; div.appendChild(el); }
    layer.appendChild(div);
  });
}

// Lines are green ONLY when the source quest is marked complete — nothing else
function depLineClass(depId) {
  return completed.has(depId) ? 'done' : 'locked';
}

async function renderQuests(chDef) {
  const quests = chDef._quests || [];
  const { px, py, W, H } = computeLayout(quests);
  chDef._layout = { W, H };
  const canvas = document.getElementById('qcanvas');
  const svg    = document.getElementById('depsvg');

  canvas.querySelectorAll('.qnode').forEach(n => n.remove());
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  document.getElementById('bg-layer').style.width = W + 'px'; document.getElementById('bg-layer').style.height = H + 'px';
  svg.setAttribute('width', W); svg.setAttribute('height', H); svg.innerHTML = '';

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `<marker id="mda" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><polygon points="0,0 7,3.5 0,7" fill="#55ff55"/></marker><marker id="mdl" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><polygon points="0,0 7,3.5 0,7" fill="#444"/></marker>`;
  svg.appendChild(defs);

  quests.forEach(q => {
    (q.dependencies || []).forEach(depId => {
      const dep = QUEST_MAP[depId]; if (!dep || dep.invisible) return;
      const cls = depLineClass(depId);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', px(dep.x || 0)); line.setAttribute('y1', py(dep.y || 0));
      line.setAttribute('x2', px(q.x || 0));   line.setAttribute('y2', py(q.y || 0));
      line.setAttribute('class', `dl ${cls}`);
      line.setAttribute('marker-end', `url(#${cls === 'done' ? 'mda' : 'mdl'})`);
      line.dataset.from = depId; line.dataset.to = q.id;
      svg.appendChild(line);
    });
  });

  renderBgImages(chDef._data?.images, px, py);

  for (let i = 0; i < quests.length; i += CHUNK_SIZE) {
    quests.slice(i, i + CHUNK_SIZE).forEach(q => buildQuestNode(q, px, py, canvas));
    await new Promise(r => requestAnimationFrame(r));
  }

  centerChapter(W, H);
}

function buildQuestNode(q, px, py, canvas) {
  if (q.invisible) return;
  const status = questStatus(q);
  const size   = q.size || 1.0;
  const S      = Math.round(NODE_BASE * size);
  const ICO    = Math.round(S * 0.86);
  const off    = Math.round((S - ICO) / 2);

  if (q._iconId === undefined && q._customIconPath === undefined) {
    const m = questMeta(q); q._iconId = m.iconId; q._customIconPath = m.customIconPath; q._title = m.title;
  }

  const icon = resolveQuestIcon(q);

  const node = document.createElement('div');
  node.className = `qnode ${status}${q.optional ? ' optional' : ''}${selQuest?.id === q.id ? ' sel' : ''}`;
  node.style.cssText = `left:${px(q.x || 0)}px;top:${py(q.y || 0)}px;width:${S}px;height:${S}px;margin-left:${-S / 2}px;margin-top:${-S / 2}px;`;
  node.dataset.id = q.id;

  // Shape border SVG
  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgEl.setAttribute('width', S); svgEl.setAttribute('height', S); svgEl.setAttribute('viewBox', `0 0 ${S} ${S}`);
  svgEl.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;overflow:visible;';
  svgEl.innerHTML = shapeEl(q.shape || '', status, q.optional || false, S);
  node.appendChild(svgEl);

  // Icon
  if (icon.src && !icon.animated) {
    const img = document.createElement('img'); img.src = icon.src; img.draggable = false;
    img.style.cssText = `position:absolute;left:${off}px;top:${off}px;width:${ICO}px;height:${ICO}px;object-fit:contain;image-rendering:pixelated;`;
    node.appendChild(img);
  } else if (icon.animated) {
    const t = texEntry(icon.id);
    const wrap = document.createElement('div');
    wrap.style.cssText = `position:absolute;left:${off}px;top:${off}px;width:${ICO}px;height:${ICO}px;overflow:hidden;`;
    const img = document.createElement('img'); img.src = t.src; img.draggable = false;
    img.className = `iimg-anim anim-${t.frames}`;
    img.style.cssText = 'width:100%;height:auto;image-rendering:pixelated;display:block;';
    wrap.appendChild(img); node.appendChild(wrap);
  } else {
    const span = document.createElement('span');
    span.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:${Math.round(S * 0.42)}px;user-select:none;`;
    span.textContent = itemEmoji(icon.id || '');
    node.appendChild(span);
  }

  // Locked: subtle dark overlay only, no emoji
  if (status === 'locked') {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.5);pointer-events:none;';
    node.appendChild(ov);
  }

  // Badges
  if (status === 'available') {
    const b = document.createElement('div'); b.className = 'qbadge badge-available'; b.textContent = '!'; node.appendChild(b);
  } else if (status === 'complete') {
    const b = document.createElement('div'); b.className = 'qbadge badge-complete'; b.textContent = '✓'; node.appendChild(b);
  }

  node.addEventListener('mouseenter', e => { showQuestTooltip(e, q); highlightChain(q.id); });
  node.addEventListener('mouseleave', () => { hideQuestTooltip(); clearChain(); });
  node.addEventListener('click', () => { if (!didPan) selectQuest(q); });
  canvas.appendChild(node);
}

// ── DETAIL PANEL ──────────────────────────────────────────
function selectQuest(q) {
  selQuest = q;
  document.querySelectorAll('.qnode').forEach(n => n.classList.toggle('sel', n.dataset.id === q.id));
  renderDetail(q);
}

function renderDetail(q) {
  document.getElementById('dp-overlay').classList.add('open');
  const done   = questStatus(q) === 'complete';
  const status = questStatus(q);

  // Header icon via waterfall
  const icoWrap = document.getElementById('dp-icon-wrap'); icoWrap.innerHTML = '';
  const icon = resolveQuestIcon(q);
  if (icon.animated) {
    const t = texEntry(icon.id); const wrap = document.createElement('div');
    wrap.style.cssText = 'width:100%;height:100%;overflow:hidden;';
    const img = document.createElement('img'); img.src = t.src; img.className = `iimg-anim anim-${t.frames}`; img.style.cssText = 'width:100%;height:auto;image-rendering:pixelated;'; wrap.appendChild(img); icoWrap.appendChild(wrap);
  } else if (icon.src) {
    const img = document.createElement('img'); img.src = icon.src; img.className = 'iimg'; img.alt = ''; icoWrap.appendChild(img);
  } else {
    icoWrap.textContent = itemEmoji(icon.id || '');
  }

  document.getElementById('dp-title').textContent    = q._title || '';
  document.getElementById('dp-subtitle').textContent = q.subtitle || q.description || '';

  const btn = document.getElementById('dpcomplete');
  btn.className = done ? 'done' : ''; btn.textContent = done ? '✓ COMPLETED' : '[ MARK COMPLETE ]';
  btn.onclick = () => toggleDone(q.id);

  // Fill both tabs
  fillMainTab(q, done);
  fillRewardsTab(q);

  // Default to main tab
  switchTab('main', document.querySelector('.dp-tab[data-tab="main"]'));

  // Lock warning
  let warn = document.getElementById('dp-lock-warn'); if (warn) warn.remove();
  if (status === 'locked') {
    const w = document.createElement('div'); w.id = 'dp-lock-warn'; w.className = 'lock-warn';
    w.innerHTML = '🔒 Complete prerequisites first';
    document.getElementById('dp-footer').appendChild(w);
  }
}

function fillMainTab(q, done) {
  const pane = document.getElementById('tab-main'); pane.innerHTML = '';

  // ── PREREQUISITES (shown first — most important) ──────────
  const deps = q.dependencies || [];
  if (deps.length) {
    pane.appendChild(sectionLabel('PREREQUISITES'));
    deps.forEach(depId => {
      const dep = QUEST_MAP[depId]; if (!dep) return;
      const ds  = questStatus(dep);
      const dIcon = resolveQuestIcon(dep);
      const row = document.createElement('div'); row.className = 'dp-row dep-row';
      row.addEventListener('click', () => { closeDetail(); setTimeout(() => selectQuest(dep), 50); });
      const sl = makeSlot(dep._iconId || '', 44, dIcon.src || null);
      const inf = document.createElement('div'); inf.className = 'dp-row-info';
      inf.innerHTML = `<div class="dp-row-name dp-status-${ds}">${dep._title || ''}</div><div class="dp-row-sub">${ds}</div>`;
      row.appendChild(sl); row.appendChild(inf);
      pane.appendChild(row);
    });
  }

  // ── TASKS ─────────────────────────────────────────────────
  const tasks = q.tasks || [];
  if (tasks.length) {
    pane.appendChild(sectionLabel('TASKS'));
    tasks.forEach(t => {
      let iid = '', tname = '', tmod = '', ttype = t.type || '';
      if (t.type === 'item') {
        const raw = getItemId(t.item);
        if (raw === 'ftbfiltersystem:smart_filter') {
          const fi = parseFilter(t.item?.components?.['ftbfiltersystem:filter']);
          iid = fi.id || ''; tname = fi.name; tmod = fi.id ? itemMod(fi.id) : 'FTB Filter System';
        } else { iid = raw; tname = itemName(iid) + (t.count > 1 ? ` ×${t.count}` : ''); tmod = itemMod(iid); }
      } else if (t.type === 'kill')  { iid = getItemId(t.icon) || t.entity || ''; tname = `Kill ${itemName(t.entity || '')} ×${t.value || 1}`; tmod = itemMod(t.entity || ''); }
      else if (t.type === 'biome')   { iid = t.biome || ''; tname = `Visit ${itemName(iid)}`; tmod = 'Biome'; }
      else if (t.type === 'advancement') { const n = (t.advancement || '').split('/').pop()?.split('_').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ') || 'Advancement'; tname = n; tmod = t.advancement || ''; }
      else if (t.type === 'checkmark') { tname = 'Manual Checkmark'; tmod = 'Click complete to mark done'; }
      const row = document.createElement('div'); row.className = 'dp-row';
      const chk = document.createElement('div'); chk.className = 'chk' + (done ? ' done' : ''); if (done) chk.textContent = '✓';
      const inf = document.createElement('div'); inf.className = 'dp-row-info';
      inf.innerHTML = `<div class="dp-row-name">${tname}</div><div class="dp-row-sub">${tmod}${ttype && ttype !== 'item' ? ` · ${ttype}` : ''}</div>`;
      row.appendChild(makeSlot(iid, 44)); row.appendChild(inf); row.appendChild(chk);
      pane.appendChild(row);
    });
  }

  if (!deps.length && !tasks.length) pane.innerHTML = '<div class="empty-tab">No tasks or prerequisites.</div>';
}

function fillRewardsTab(q) {
  const pane = document.getElementById('tab-rewards'); pane.innerHTML = '';
  const rewards = q.rewards || [];
  if (!rewards.length) { pane.innerHTML = '<div class="empty-tab">No rewards for this quest.</div>'; return; }
  rewards.forEach(r => {
    if (r.type === 'xp') { const d = document.createElement('div'); d.className = 'xpbadge'; d.textContent = `✦ ${r.xp} XP`; pane.appendChild(d); return; }
    if (r.type === 'item') {
      const iid = getItemId(r.item); const cnt = (r.count || 1) > 1 ? ` ×${r.count}` : '';
      const row = document.createElement('div'); row.className = 'dp-row';
      const inf = document.createElement('div'); inf.className = 'dp-row-info';
      inf.innerHTML = `<div class="dp-row-name">${itemName(iid)}${cnt}</div><div class="dp-row-sub">${itemMod(iid)}</div>`;
      row.appendChild(makeSlot(iid, 44)); row.appendChild(inf);
      pane.appendChild(row); return;
    }
    if (r.type === 'loot' || r.type === 'random') {
      const row = document.createElement('div'); row.className = 'dp-row';
      const ico = document.createElement('div'); ico.className = 'islot'; ico.style.cssText = 'width:44px;height:44px;font-size:24px;flex-shrink:0;'; ico.textContent = '🎁';
      const inf = document.createElement('div'); inf.className = 'dp-row-info';
      inf.innerHTML = '<div class="dp-row-name">Random Loot</div><div class="dp-row-sub">Reward table</div>';
      row.appendChild(ico); row.appendChild(inf); pane.appendChild(row);
    }
  });
}

function sectionLabel(text) {
  const d = document.createElement('div'); d.className = 'dp-section-label'; d.textContent = text; return d;
}

function switchTab(name, el) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.dp-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${name}`)?.classList.add('active');
  if (el) el.classList.add('active');
}

function closeDetail() {
  document.getElementById('dp-overlay').classList.remove('open');
  document.querySelectorAll('.qnode').forEach(n => n.classList.remove('sel'));
  selQuest = null;
}

function toggleDone(id) {
  completed.has(id) ? completed.delete(id) : completed.add(id);
  localStorage.setItem('ftbq_done', JSON.stringify([...completed]));
  renderSidebar();
  if (activeChap) renderQuests(activeChap);
  if (selQuest?.id === id) renderDetail(selQuest);
}

document.getElementById('dp-overlay').addEventListener('click', e => { if (e.target === document.getElementById('dp-overlay')) closeDetail(); });

// ── HELPERS ───────────────────────────────────────────────
function setLoading(msg, pct) { document.getElementById('loading-msg').textContent = msg; document.getElementById('loading-bar').style.width = pct + '%'; }
function showError(title, msg, hint = '') {
  document.getElementById('loading').classList.add('hidden');
  let el = document.getElementById('error-screen');
  if (!el) { el = document.createElement('div'); el.id = 'error-screen'; el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#111;display:flex;align-items:center;justify-content:center;text-align:center;padding:40px;'; document.body.appendChild(el); }
  el.innerHTML = `<div><div style="color:#ff5555;font-size:9px;margin-bottom:16px;font-family:var(--font-pixel)">${title}</div><div style="color:#aaa;font-family:var(--font-body);font-size:20px;margin-bottom:12px">${msg}</div><div style="color:#666;font-family:var(--font-body);font-size:18px">${hint}</div></div>`;
}

document.addEventListener('keydown', e => { if (document.activeElement.tagName === 'INPUT') return; if (e.key === 'Escape') closeDetail(); });

if (typeof TEXTURES === 'undefined') window.TEXTURES = {};
init();
