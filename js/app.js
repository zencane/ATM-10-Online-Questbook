// ═══════════════════════════════════════════════════════════
//  FTB Questbook — app.js
//  Textures are in the global TEXTURES dict (data/textures.js).
// ═══════════════════════════════════════════════════════════

// ── GLOBALS ───────────────────────────────────────────────
let CHAPTERS   = [];
let QUEST_MAP  = {};
let completed  = new Set(JSON.parse(localStorage.getItem('ftbq_done') || '[]'));
let selQuest   = null;
let activeChap = null;

// Pan / zoom state
let zoom = 1, panX = 0, panY = 0;
let isPanning = false, lastMX = 0, lastMY = 0;
let didPan    = false;

const SCALE      = 110;
const PAD        = 80;
const CHUNK_SIZE = 25;

// ── WEB WORKER ────────────────────────────────────────────
const workerPool  = [];
const workerQueue = new Map();
function getWorker() {
  if (workerPool.length) return workerPool.pop();
  const w = new Worker('js/snbt-parser.worker.js');
  w.onmessage = ({ data: msg }) => {
    const p = workerQueue.get(msg.chapterId); if (!p) return;
    if (msg.type==='progress') p.onProgress?.(msg.msg, msg.pct);
    else if (msg.type==='done')  { workerQueue.delete(msg.chapterId); workerPool.push(w); p.resolve(msg); }
    else if (msg.type==='error') { workerQueue.delete(msg.chapterId); workerPool.push(w); p.reject(new Error(msg.error)); }
  };
  return w;
}
function parseWithWorker(chapterId, snbt, onProgress) {
  return new Promise((resolve, reject) => {
    workerQueue.set(chapterId, { resolve, reject, onProgress });
    getWorker().postMessage({ snbt, chapterId });
  });
}

// ── ITEM DATABASE (emoji fallbacks + display names) ───────
const IDB = {
  "minecraft:oak_log":              ["🌲","Oak Log","Minecraft"],
  "minecraft:crafting_table":       ["📋","Crafting Table","Minecraft"],
  "minecraft:wooden_pickaxe":       ["⛏","Wooden Pickaxe","Minecraft"],
  "crafting_on_a_stick:crafting_table":["📋","Crafting On A Stick","Crafting On A Stick"],
  "minecraft:furnace":              ["🧱","Furnace","Minecraft"],
  "minecraft:coal":                 ["⬛","Coal","Minecraft"],
  "ironfurnaces:iron_furnace":      ["🔥","Iron Furnace","Iron Furnaces"],
  "ironfurnaces:copper_furnace":    ["🟤","Copper Furnace","Iron Furnaces"],
  "ironfurnaces:upgrade_iron":      ["⬆","Iron Furnace Upgrade","Iron Furnaces"],
  "ironfurnaces:upgrade_copper":    ["⬆","Copper Furnace Upgrade","Iron Furnaces"],
  "ironfurnaces:augment_blasting":  ["💣","Blasting Augment","Iron Furnaces"],
  "ironfurnaces:augment_smoking":   ["💨","Smoking Augment","Iron Furnaces"],
  "ironfurnaces:augment_factory":   ["🏭","Factory Augment","Iron Furnaces"],
  "ironfurnaces:augment_generator": ["⚡","Generator Augment","Iron Furnaces"],
  "ironfurnaces:augment_speed":     ["⚡","Speed Augment","Iron Furnaces"],
  "ironfurnaces:augment_fuel":      ["🛢","Fuel Augment","Iron Furnaces"],
  "minecraft:iron_ingot":           ["⬜","Iron Ingot","Minecraft"],
  "minecraft:copper_ingot":         ["🟤","Copper Ingot","Minecraft"],
  "minecraft:iron_pickaxe":         ["⛏","Iron Pickaxe","Minecraft"],
  "minecraft:redstone":             ["🔴","Redstone Dust","Minecraft"],
  "minecraft:redstone_block":       ["🔴","Block of Redstone","Minecraft"],
  "minecraft:diamond":              ["💎","Diamond","Minecraft"],
  "minecraft:obsidian":             ["🟣","Obsidian","Minecraft"],
  "minecraft:flint_and_steel":      ["🔥","Flint and Steel","Minecraft"],
  "minecraft:ender_eye":            ["👁","Eye of Ender","Minecraft"],
  "minecraft:ender_pearl":          ["🟢","Ender Pearl","Minecraft"],
  "minecraft:netherite_ingot":      ["🖤","Netherite Ingot","Minecraft"],
  "minecraft:netherite_scrap":      ["🖤","Netherite Scrap","Minecraft"],
  "minecraft:netherite_upgrade_smithing_template":["📜","Netherite Upgrade","Minecraft"],
  "minecraft:wither_skeleton_skull":["💀","Wither Skeleton Skull","Minecraft"],
  "minecraft:soul_sand":            ["🟫","Soul Sand","Minecraft"],
  "minecraft:golden_chestplate":    ["🥇","Golden Chestplate","Minecraft"],
  "minecraft:brush":                ["🖌","Brush","Minecraft"],
  "minecraft:sniffer_egg":          ["🥚","Sniffer Egg","Minecraft"],
  "minecraft:sculk_shrieker":       ["📢","Sculk Shrieker","Minecraft"],
  "minecraft:sculk":                ["🫧","Sculk","Minecraft"],
  "minecraft:lava_bucket":          ["🪣","Lava Bucket","Minecraft"],
  "minecraft:crying_obsidian":      ["💜","Crying Obsidian","Minecraft"],
  "minecraft:torch":                ["🕯","Torch","Minecraft"],
  "minecraft:cooked_beef":          ["🥩","Cooked Beef","Minecraft"],
  "minecraft:coal_block":           ["⬛","Coal Block","Minecraft"],
  "minecraft:bucket":               ["🪣","Bucket","Minecraft"],
  "minecraft:dragon_egg":           ["🥚","Dragon Egg","Minecraft"],
  "minecraft:warden":               ["👹","Warden","Minecraft"],
  "minecraft:wither":               ["💀","The Wither","Minecraft"],
  "minecraft:deep_dark":            ["🌑","Deep Dark","Minecraft"],
  "minecraft:diamond_pickaxe":      ["💎","Diamond Pickaxe","Minecraft"],
  "minecraft:diamond_sword":        ["💎","Diamond Sword","Minecraft"],
  "minecraft:diamond_helmet":       ["💎","Diamond Helmet","Minecraft"],
  "minecraft:diamond_chestplate":   ["💎","Diamond Chestplate","Minecraft"],
  "minecraft:diamond_leggings":     ["💎","Diamond Leggings","Minecraft"],
  "minecraft:diamond_boots":        ["💎","Diamond Boots","Minecraft"],
  "minecraft:netherite_pickaxe":    ["🖤","Netherite Pickaxe","Minecraft"],
  "minecraft:netherite_sword":      ["🖤","Netherite Sword","Minecraft"],
  "minecraft:netherite_helmet":     ["🖤","Netherite Helmet","Minecraft"],
  "minecraft:netherite_chestplate": ["🖤","Netherite Chestplate","Minecraft"],
  "minecraft:netherite_leggings":   ["🖤","Netherite Leggings","Minecraft"],
  "minecraft:netherite_boots":      ["🖤","Netherite Boots","Minecraft"],
  "alltheores:iron_dust":           ["⚪","Iron Dust","All The Ores"],
  "alltheores:copper_dust":         ["🟠","Copper Dust","All The Ores"],
  "alltheores:ore_hammers":         ["🔨","Ore Hammer","All The Ores"],
  "mekanism:osmium_ingot":          ["🔵","Osmium Ingot","Mekanism"],
  "mekanism:control_circuit":       ["🔌","Basic Control Circuit","Mekanism"],
  "mekanism:alloy_infused":         ["🔶","Infused Alloy","Mekanism"],
  "mekanism:jetpack":               ["🚀","Jetpack","Mekanism"],
  "mekanism:basic_universal_cable": ["🔌","Basic Universal Cable","Mekanism"],
  "mekanism:ultimate_universal_cable":["⚡","Ultimate Universal Cable","Mekanism"],
  "mekanism:digital_miner":         ["⛏","Digital Miner","Mekanism"],
  "mekanism:basic_energy_cube":     ["🔋","Basic Energy Cube","Mekanism"],
  "mekanismgenerators:wind_generator":["🌬","Wind Generator","Mekanism Generators"],
  "mekanismgenerators:solar_generator":["☀","Solar Generator","Mekanism Generators"],
  "powah:energy_cell_starter":      ["🔋","Starter Energy Cell","Powah"],
  "powah:magmator_basic":           ["🌋","Basic Magmator","Powah"],
  "powah:magmator_starter":         ["🌋","Starter Magmator","Powah"],
  "powah:solar_panel_basic":        ["☀","Basic Solar Panel","Powah"],
  "powah:energy_cable_basic":       ["🔌","Basic Energy Cable","Powah"],
  "pipez:energy_pipe":              ["🔌","Energy Pipe","Pipez"],
  "generatorgalore:copper_generator":    ["⚡","Copper Generator","Generator Galore"],
  "generatorgalore:magmatic_generator":  ["🌋","Magmatic Generator","Generator Galore"],
  "generatorgalore:enchantment_generator":["✨","Enchantment Generator","Generator Galore"],
  "generatorgalore:halitosis_generator":  ["💨","Halitosis Generator","Generator Galore"],
  "generatorgalore:netherstar_generator": ["⭐","Nether Star Generator","Generator Galore"],
  "generatorgalore:potion_generator":     ["🧪","Potion Generator","Generator Galore"],
};
const MOD_NAMES = {
  minecraft:'Minecraft', mekanism:'Mekanism', mekanismgenerators:'Mekanism Generators',
  powah:'Powah', generatorgalore:'Generator Galore', pipez:'Pipez',
  alltheores:'All The Ores', ironfurnaces:'Iron Furnaces',
  crafting_on_a_stick:'Crafting On A Stick', ftbfiltersystem:'FTB Filter System',
  atm:'All the Mods', create:'Create', botania:'Botania', ae2:'Applied Energistics 2',
};
function itemName(id)  { return IDB[id]?.[1] || id.split(':').pop().split('_').map(w=>w[0]?.toUpperCase()+w.slice(1)).join(' '); }
function itemEmoji(id) { return IDB[id]?.[0] || '📦'; }
function itemMod(id)   { return IDB[id]?.[2] || MOD_NAMES[id?.split(':')[0]] || id?.split(':')[0] || ''; }

function parseFilter(f) {
  if (!f) return { name:'Smart Filter', id:null };
  const t = f.match(/item_tag\(([^)]+)\)/);
  if (t) { const tid=t[1].replace('ftbfiltersystem:',''); return { name:itemName(tid), id:tid }; }
  const it = f.match(/item\(([^)]+)\)/);
  if (it) return { name:itemName(it[1]), id:it[1] };
  return { name:'Smart Filter', id:null };
}

// ── TEXTURE RESOLUTION ────────────────────────────────────
function texEntry(id) {
  if (!id || typeof TEXTURES === 'undefined') return null;
  return TEXTURES[id] || null;
}
function texSrc(id) {
  const t = texEntry(id);
  if (!t) return null;
  return typeof t === 'string' ? t : t.src;
}
function isAnimated(id) {
  const t = texEntry(id);
  return t && typeof t === 'object' && t.frames;
}

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

// ── SLOT BUILDER ──────────────────────────────────────────
function makeSlot(itemId, cls='slot-sm', customSrc=null) {
  const div = document.createElement('div');
  div.className = `islot ${cls}`;

  if (customSrc) {
    // questpic path — static image
    const img = document.createElement('img');
    img.src = customSrc; img.className='iimg'; img.alt=''; img.draggable=false;
    div.appendChild(img);
  } else if (isAnimated(itemId)) {
    // Animated strip — clip to one frame, animate with CSS
    const t = texEntry(itemId);
    div.style.overflow = 'hidden';
    const img = document.createElement('img');
    img.src = t.src;
    img.className = `iimg-anim anim-${t.frames}`;
    img.alt = ''; img.draggable = false;
    div.appendChild(img);
  } else {
    const src = texSrc(itemId);
    if (src) {
      const img = document.createElement('img');
      img.src = src; img.className='iimg'; img.alt=''; img.draggable=false;
      div.appendChild(img);
    } else {
      const s = document.createElement('span');
      s.textContent = itemEmoji(itemId || '');
      div.appendChild(s);
    }
  }
  return div;
}

// ── SVG SHAPES ────────────────────────────────────────────
const CX=32, CY=32, R=28;
const hexP=(r=R)=>Array.from({length:6},(_,i)=>{const a=(i*60-90)*Math.PI/180;return`${(CX+r*Math.cos(a)).toFixed(1)},${(CY+r*Math.sin(a)).toFixed(1)}`}).join(' ');
const octP=(r=R)=>Array.from({length:8},(_,i)=>{const a=(i*45-90)*Math.PI/180;return`${(CX+r*Math.cos(a)).toFixed(1)},${(CY+r*Math.sin(a)).toFixed(1)}`}).join(' ');
function gearD(r1=R,r2=R*.67,teeth=8){const pts=[],ta=Math.PI/teeth,ht=ta*.38;for(let i=0;i<teeth;i++){const a=(i/teeth)*2*Math.PI-Math.PI/2;pts.push([CX+r2*Math.cos(a-ht*1.3),CY+r2*Math.sin(a-ht*1.3)],[CX+r1*Math.cos(a-ht*.55),CY+r1*Math.sin(a-ht*.55)],[CX+r1*Math.cos(a+ht*.55),CY+r1*Math.sin(a+ht*.55)],[CX+r2*Math.cos(a+ht*1.3),CY+r2*Math.sin(a+ht*1.3)]);}return 'M '+pts.map(p=>p.map(v=>v.toFixed(1)).join(',')).join(' L ')+' Z';}
function shapeEl(shape, status, optional=false) {
  const sc = status==='complete'?'#55ff55':status==='available'?'#55ff55':'#444444';
  const da = optional?' stroke-dasharray="4 3"':'';
  const a  = `fill="#2a2a2a" stroke="${sc}" stroke-width="2" class="qshape"${da}`;
  switch(shape) {
    case'hexagon': return `<polygon ${a} points="${hexP()}"/>`;
    case'octagon': return `<polygon ${a} points="${octP()}"/>`;
    case'diamond': return `<polygon ${a} points="${CX},${CY-R} ${CX+R},${CY} ${CX},${CY+R} ${CX-R},${CY}"/>`;
    case'circle':  return `<circle  ${a} cx="${CX}" cy="${CY}" r="${R}"/>`;
    case'rsquare': return `<rect    ${a} x="${CX-R}" y="${CY-R}" width="${R*2}" height="${R*2}" rx="12"/>`;
    case'gear':    return `<path    ${a} d="${gearD()}"/>`;
    case'heart':   return `<path    ${a} d="M${CX},${CY+R*.85} C${CX-1},${CY+R*.85} ${CX-R},${CY+R*.2} ${CX-R},${CY-R*.1} C${CX-R},${CY-R*.7} ${CX-R*.5},${CY-R} ${CX},${CY-R*.4} C${CX+R*.5},${CY-R} ${CX+R},${CY-R*.7} ${CX+R},${CY-R*.1} C${CX+R},${CY+R*.2} ${CX+1},${CY+R*.85} ${CX},${CY+R*.85} Z"/>`;
    default:       return `<rect    ${a} x="${CX-R}" y="${CY-R}" width="${R*2}" height="${R*2}" rx="4"/>`;
  }
}

// ── QUEST META (fallback if worker didn't annotate) ───────
function questMeta(q) {
  let iconId=null, customIconPath=null, title=null, taskIconId=null;
  const raw=q.icon;
  if (raw?.id==='ftbquests:custom_icon') { customIconPath=raw?.components?.['ftbquests:icon']||null; }
  else if (raw?.id) iconId=raw.id;
  const tasks=q.tasks||[];
  if (tasks.length) {
    const t=tasks[0]; taskIconId=t.icon?.id||null; const ttype=t.type||'';
    if(ttype==='item'){const iid=t.item?.id||'';if(iid==='ftbfiltersystem:smart_filter'){const fi=parseFilter(t.item?.components?.['ftbfiltersystem:filter']);title=fi.name;taskIconId=taskIconId||fi.id;}else if(iid){const d=taskIconId||iid;title=itemName(d);taskIconId=d;}}
    else if(ttype==='kill'){const e=t.entity||'';taskIconId=taskIconId||e;title='Kill '+itemName(e);}
    else if(ttype==='biome'){const b=t.biome||'';taskIconId=taskIconId||b;title='Visit '+itemName(b);}
    else if(ttype==='advancement'){const adv=t.advancement||'';const ai='minecraft:'+adv.split('/').pop();taskIconId=taskIconId||ai;title=itemName(ai);}
    else if(ttype==='checkmark'){title='Optional Task';}
  }
  if(customIconPath)return{iconId:null,customIconPath,title:title||'Quest'};
  const idSrc=iconId||taskIconId||null;
  return{iconId:idSrc,customIconPath:null,title:title||itemName(idSrc||'')||'Quest'};
}

// ── STATUS / LAYOUT ───────────────────────────────────────
function questStatus(q) {
  if (completed.has(q.id)) return 'complete';
  return (q.dependencies||[]).every(d=>completed.has(d)) ? 'available' : 'locked';
}
function computeLayout(quests) {
  const xs=quests.map(q=>q.x||0), ys=quests.map(q=>q.y||0);
  const minX=Math.min(...xs), minY=Math.min(...ys), maxX=Math.max(...xs), maxY=Math.max(...ys);
  return { px:x=>(x-minX)*SCALE+PAD+60, py:y=>(y-minY)*SCALE+PAD, W:(maxX-minX)*SCALE+PAD*2+120, H:(maxY-minY)*SCALE+PAD*2+80 };
}

// ── PAN / ZOOM ────────────────────────────────────────────
function applyTransform() {
  const t = `translate(${panX}px,${panY}px) scale(${zoom})`;
  document.getElementById('qcanvas').style.transform  = t;
  document.getElementById('bg-layer').style.transform = t;
  document.getElementById('zoom-label').textContent   = Math.round(zoom*100)+'%';
}

function centerChapter(W, H) {
  const wrap = document.getElementById('qwrap');
  const vw = wrap.clientWidth, vh = wrap.clientHeight;
  zoom = Math.min(0.85, Math.min(vw/W, vh/H) * 0.9);
  panX = vw/2 - (W/2)*zoom;
  panY = vh/2 - (H/2)*zoom;
  applyTransform();
}

function setupPanZoom() {
  const wrap = document.getElementById('qwrap');
  wrap.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    isPanning=true; didPan=false; lastMX=e.clientX; lastMY=e.clientY;
    wrap.classList.add('panning');
  });
  document.addEventListener('mousemove', e => {
    if (!isPanning) return;
    const dx=e.clientX-lastMX, dy=e.clientY-lastMY;
    if (Math.abs(dx)+Math.abs(dy)>3) didPan=true;
    panX+=dx; panY+=dy; lastMX=e.clientX; lastMY=e.clientY;
    applyTransform();
  });
  document.addEventListener('mouseup', () => {
    isPanning=false; document.getElementById('qwrap').classList.remove('panning');
  });
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const rect=wrap.getBoundingClientRect(), mx=e.clientX-rect.left, my=e.clientY-rect.top;
    const delta=e.deltaY<0?1.1:0.9;
    const nz=Math.max(0.2,Math.min(4,zoom*delta));
    panX=mx-(mx-panX)*(nz/zoom); panY=my-(my-panY)*(nz/zoom); zoom=nz;
    applyTransform();
  }, { passive:false });
  document.getElementById('zoom-reset').addEventListener('click', () => {
    if (activeChap?._layout) centerChapter(activeChap._layout.W, activeChap._layout.H);
  });
}

// ── DEP CHAIN HIGHLIGHT ───────────────────────────────────
function getAncestors(questId) {
  const result=new Set(), queue=[questId];
  while(queue.length){ const id=queue.shift(); const q=QUEST_MAP[id]; if(!q)continue; (q.dependencies||[]).forEach(d=>{if(!result.has(d)){result.add(d);queue.push(d);}}); }
  return result;
}
function highlightChain(questId) {
  const anc = getAncestors(questId);
  document.querySelectorAll('#depsvg .dl').forEach(l => {
    const inChain = l.dataset.to===questId || (anc.has(l.dataset.from)&&anc.has(l.dataset.to)) || (anc.has(l.dataset.from)&&l.dataset.to===questId);
    l.classList.toggle('chain', inChain);
  });
  document.querySelectorAll('.qnode').forEach(n => n.classList.toggle('chain-ancestor', anc.has(n.dataset.id)));
}
function clearChain() {
  document.querySelectorAll('#depsvg .dl.chain').forEach(l=>l.classList.remove('chain'));
  document.querySelectorAll('.qnode.chain-ancestor').forEach(n=>n.classList.remove('chain-ancestor'));
}

// ── QUEST HOVER TOOLTIP ───────────────────────────────────
function showQuestTooltip(e, q) {
  const tt=document.getElementById('quest-tooltip');
  document.getElementById('qt-title').textContent = q._title||'';
  const desc = q.subtitle||q.description||'';
  const d = document.getElementById('qt-desc');
  d.textContent=desc; d.style.display=desc?'block':'none';
  tt.classList.add('show'); moveQuestTooltip(e);
}
function hideQuestTooltip() { document.getElementById('quest-tooltip').classList.remove('show'); }
function moveQuestTooltip(e) {
  const tt=document.getElementById('quest-tooltip');
  let x=e.clientX+16, y=e.clientY+10;
  if(x+310>innerWidth)x=e.clientX-320; if(y+120>innerHeight)y=e.clientY-110;
  tt.style.left=x+'px'; tt.style.top=y+'px';
}
document.addEventListener('mousemove', e=>{ if(document.getElementById('quest-tooltip').classList.contains('show'))moveQuestTooltip(e); });

// ── INIT ──────────────────────────────────────────────────
async function init() {
  setLoading('Loading chapters...', 30);
  let chapData;
  try { const r=await fetch('data/chapters.json'); if(!r.ok)throw new Error(); chapData=await r.json(); }
  catch(e) { showError('⚠ No chapters found','data/chapters.json missing.','Run setup.py first.'); return; }

  CHAPTERS=chapData.chapters||[];
  if (!CHAPTERS.length) { showError('⚠ No chapters','chapters.json is empty.','Run setup.py first.'); return; }

  document.getElementById('pack-name').textContent=chapData.pack_name||'';
  setLoading('Ready!',100);
  setTimeout(()=>document.getElementById('loading').classList.add('hidden'),200);

  workerPool.push(getWorker());
  setupPanZoom();
  renderSidebar();
  loadChapter(CHAPTERS[0]);
}

// ── SIDEBAR ───────────────────────────────────────────────
function renderSidebar() {
  const list=document.getElementById('chaplist'); list.innerHTML='';
  CHAPTERS.forEach(ch=>{
    const btn=document.createElement('button');
    btn.className='cbtn'+(activeChap?.id===ch.id?' active':''); btn.dataset.id=ch.id;
    const ico=document.createElement('div'); ico.className='cbico';
    const icoSrc=ch.icon?texSrc(ch.icon):null;
    if(icoSrc){const img=document.createElement('img');img.src=icoSrc;ico.appendChild(img);}
    else ico.textContent=ch.icon_emoji||'📖';
    const nm=document.createElement('span'); nm.className='cname'; nm.textContent=ch.title;
    btn.appendChild(ico); btn.appendChild(nm);
    btn.addEventListener('click',()=>loadChapter(ch));
    list.appendChild(btn);
  });
}

// ── CHAPTER LOADING ───────────────────────────────────────
function showProgress(title,msg,pct) {
  document.getElementById('qhtitle').textContent=title;
  document.getElementById('qhdesc').innerHTML=`<span style="color:var(--yellow)">${msg}</span><span style="display:inline-block;width:90px;height:4px;background:rgba(0,0,0,.4);border:1px solid #555;margin-left:10px;vertical-align:middle"><span style="display:block;height:100%;background:var(--green);width:${pct}%"></span></span>`;
}

async function loadChapter(chDef) {
  if (!chDef||chDef._loading) return;
  activeChap=chDef; selQuest=null; closeDetail();
  document.querySelectorAll('.cbtn').forEach(b=>b.classList.toggle('active',b.dataset.id===chDef.id));
  document.getElementById('qcanvas').querySelectorAll('.qnode').forEach(n=>n.remove());
  document.getElementById('bg-layer').innerHTML='';
  document.getElementById('depsvg').innerHTML='';

  if (chDef._data) {
    document.getElementById('qhtitle').textContent=chDef.title;
    document.getElementById('qhdesc').textContent=chDef.description||'';
    QUEST_MAP=Object.fromEntries((chDef._data.quests||[]).map(q=>[q.id,q]));
    await renderQuests(chDef); return;
  }

  chDef._loading=true;
  showProgress(chDef.title,'Fetching...',5);
  console.time(`[FTB] ${chDef.title}`);

  let snbt;
  try {
    const r=await fetch(chDef.file); if(!r.ok) throw new Error(`HTTP ${r.status}`);
    snbt=await r.text();
    console.log(`[FTB]   ${(snbt.length/1024).toFixed(1)}KB`);
  } catch(e) { chDef._loading=false; document.getElementById('qhdesc').textContent=`⚠ ${e.message}`; return; }

  showProgress(chDef.title,'Parsing...',20);
  let parsed;
  try {
    console.time('[FTB]   parse');
    parsed=await parseWithWorker(chDef.id,snbt,(msg,pct)=>showProgress(chDef.title,msg,20+pct*.45));
    console.timeEnd('[FTB]   parse');
    console.log(`[FTB]   ${parsed.data.quests?.length} quests, ${parsed.parseMs}ms`);
  } catch(e) { chDef._loading=false; document.getElementById('qhdesc').textContent=`⚠ Parse error: ${e.message}`; return; }

  chDef._data   = parsed.data;
  chDef._quests = (parsed.data.quests||[]).filter(q=>!q.invisible);
  chDef._loading = false;
  QUEST_MAP = Object.fromEntries((parsed.data.quests||[]).map(q=>[q.id,q]));

  renderSidebar();
  document.getElementById('qhdesc').textContent=chDef.description||'';
  await new Promise(r=>requestAnimationFrame(r));

  console.time('[FTB]   render');
  await renderQuests(chDef);
  console.timeEnd('[FTB]   render');
  console.timeEnd(`[FTB] ${chDef.title}`);
  document.getElementById('qhtitle').textContent=chDef.title;
}

// ── RENDER QUEST GRID ─────────────────────────────────────
function renderBgImages(images, px, py) {
  const layer=document.getElementById('bg-layer'); layer.innerHTML='';
  if (!images?.length) return;
  [...images].sort((a,b)=>(a.order||0)-(b.order||0)).forEach(img=>{
    const src=resolveImageSrc(img.image||'');
    const div=document.createElement('div'); div.className='bg-img';
    div.style.cssText=`left:${px(img.x||0)}px;top:${py(img.y||0)}px;width:${(img.width||1)*SCALE}px;height:${(img.height||1)*SCALE}px;transform:translate(-50%,-50%) translateZ(0) rotate(${img.rotation||0}deg);z-index:${(img.order||0)<0?0:2};`;
    if(src){const el=document.createElement('img');el.src=src;el.style.cssText='width:100%;height:100%;object-fit:contain;image-rendering:pixelated;display:block;';div.appendChild(el);}
    else if(img.image?.includes('outline')) div.style.border='1px solid rgba(255,255,255,0.08)';
    layer.appendChild(div);
  });
}

function depLineClass(depId) {
  if (completed.has(depId)) return 'done';
  const dep=QUEST_MAP[depId]; if(!dep) return 'locked';
  return questStatus(dep)==='locked'?'locked':'available';
}

async function renderQuests(chDef) {
  const quests=chDef._quests||[];
  const {px,py,W,H}=computeLayout(quests);
  chDef._layout={W,H};
  const canvas=document.getElementById('qcanvas');
  const svg=document.getElementById('depsvg');

  canvas.querySelectorAll('.qnode').forEach(n=>n.remove());
  canvas.style.width=W+'px'; canvas.style.height=H+'px';

  // Also size the bg-layer the same way (it shares the same transform)
  const bgLayer=document.getElementById('bg-layer');
  bgLayer.style.width=W+'px'; bgLayer.style.height=H+'px';

  svg.setAttribute('width',W); svg.setAttribute('height',H); svg.innerHTML='';

  // Dep line markers
  const defs=document.createElementNS('http://www.w3.org/2000/svg','defs');
  defs.innerHTML=`<marker id="mda" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><polygon points="0,0 8,4 0,8" fill="#55ff55"/></marker><marker id="mdav" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><polygon points="0,0 8,4 0,8" fill="#55ff55" opacity=".55"/></marker><marker id="mdl" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><polygon points="0,0 8,4 0,8" fill="#4a4a4a"/></marker>`;
  svg.appendChild(defs);

  // Dep lines
  quests.forEach(q=>{
    (q.dependencies||[]).forEach(depId=>{
      const dep=QUEST_MAP[depId]; if(!dep||dep.invisible) return;
      const cls=depLineClass(depId);
      const markers={done:'mda',available:'mdav',locked:'mdl'};
      const line=document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1',px(dep.x||0)); line.setAttribute('y1',py(dep.y||0));
      line.setAttribute('x2',px(q.x||0));   line.setAttribute('y2',py(q.y||0));
      line.setAttribute('class',`dl ${cls}`);
      line.setAttribute('marker-end',`url(#${markers[cls]||'mdl'})`);
      line.dataset.from=depId; line.dataset.to=q.id;
      svg.appendChild(line);
    });
  });

  // Bg images in isolated layer (no flicker)
  renderBgImages(chDef._data?.images,px,py);

  // Quest nodes — chunked
  for (let i=0;i<quests.length;i+=CHUNK_SIZE) {
    quests.slice(i,i+CHUNK_SIZE).forEach(q=>buildQuestNode(q,px,py,canvas));
    await new Promise(r=>requestAnimationFrame(r));
  }

  centerChapter(W,H);
}

function buildQuestNode(q,px,py,canvas) {
  if (q.invisible) return;
  const status=questStatus(q);
  const size=q.size||1.0;
  const svgSize=Math.round(64*size);
  const icoSize=Math.round(44*size);

  // Ensure metadata
  if (q._iconId===undefined&&q._customIconPath===undefined) {
    const m=questMeta(q); q._iconId=m.iconId; q._customIconPath=m.customIconPath; q._title=m.title;
  }

  const customSrc=q._customIconPath?resolveImageSrc(q._customIconPath):null;

  // Build icon SVG content
  let iconContent;
  if (customSrc) {
    const off=Math.round((svgSize-icoSize)/2);
    iconContent=`<image href="${customSrc}" x="${off}" y="${off}" width="${icoSize}" height="${icoSize}" style="image-rendering:pixelated"/>`;
  } else if (isAnimated(q._iconId)) {
    // Animated — use foreignObject to embed the CSS animation
    const t=texEntry(q._iconId);
    const off=Math.round((svgSize-icoSize)/2);
    iconContent=`<foreignObject x="${off}" y="${off}" width="${icoSize}" height="${icoSize}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;overflow:hidden"><img src="${t.src}" class="iimg-anim anim-${t.frames}" style="width:100%;height:auto;image-rendering:pixelated"/></div></foreignObject>`;
  } else {
    const src=q._iconId?texSrc(q._iconId):null;
    if (src) {
      const off=Math.round((svgSize-icoSize)/2);
      iconContent=`<image href="${src}" x="${off}" y="${off}" width="${icoSize}" height="${icoSize}" style="image-rendering:pixelated"/>`;
    } else {
      iconContent=`<text x="${svgSize/2}" y="${svgSize/2+1}" text-anchor="middle" dominant-baseline="central" font-size="${Math.round(22*size)}" style="user-select:none">${itemEmoji(q._iconId||'')}</text>`;
    }
  }

  const badgeMap={complete:['badge-complete','✓'],available:['badge-available','!'],locked:['badge-locked','🔒']};
  const [bCls,bTxt]=badgeMap[status];
  const badge=`<div class="qbadge ${bCls}">${bTxt}</div>`;

  const node=document.createElement('div');
  node.className=`qnode ${status}${q.optional?' optional':''}${selQuest?.id===q.id?' sel':''}`;
  node.style.left=px(q.x||0)+'px'; node.style.top=py(q.y||0)+'px'; node.dataset.id=q.id;
  node.innerHTML=`<svg width="${svgSize}" height="${svgSize}" viewBox="0 0 ${svgSize} ${svgSize}">${shapeEl(q.shape||'',status,q.optional||false)}${iconContent}</svg>${badge}`;

  node.addEventListener('mouseenter', e=>{ showQuestTooltip(e,q); highlightChain(q.id); });
  node.addEventListener('mouseleave', ()=>{ hideQuestTooltip(); clearChain(); });
  node.addEventListener('click', ()=>{ if(!didPan) selectQuest(q); });
  canvas.appendChild(node);
}

// ── DETAIL PANEL ──────────────────────────────────────────
function selectQuest(q) {
  selQuest=q;
  document.querySelectorAll('.qnode').forEach(n=>n.classList.toggle('sel',n.dataset.id===q.id));
  renderDetail(q);
}

function renderDetail(q) {
  document.getElementById('dp-overlay').classList.add('open');
  const done=questStatus(q)==='complete';

  // Header icon
  const icoWrap=document.getElementById('dp-icon-wrap'); icoWrap.innerHTML='';
  const customSrc=q._customIconPath?resolveImageSrc(q._customIconPath):null;
  icoWrap.appendChild(makeSlot(q._iconId||'','',customSrc));
  document.getElementById('dp-title').textContent=q._title||'';
  document.getElementById('dp-subtitle').textContent=q.subtitle||q.description||'';

  // Complete button
  const btn=document.getElementById('dpcomplete');
  btn.className=done?'done':''; btn.textContent=done?'✓ COMPLETED':'[ MARK COMPLETE ]';
  btn.onclick=()=>toggleDone(q.id);

  fillTasksTab(q,done);
  fillRewardsTab(q);
  fillPrereqsTab(q);
  switchTab('tasks',document.querySelector('.dp-tab[data-tab="tasks"]'));

  let warn=document.getElementById('dp-lock-warn');
  if(questStatus(q)==='locked'){
    if(!warn){warn=document.createElement('div');warn.id='dp-lock-warn';warn.className='lock-warn';document.getElementById('dp-footer').appendChild(warn);}
    warn.textContent='🔒 Complete prerequisites first';
  } else if(warn) warn.remove();
}

function fillTasksTab(q,done) {
  const pane=document.getElementById('tab-tasks'); pane.innerHTML='';
  if(!q.tasks?.length){pane.innerHTML='<div class="empty-tab">No tasks.</div>';return;}
  q.tasks.forEach(t=>{
    const row=document.createElement('div'); row.className='task-row';
    let iid='',tname='',tmod='',ttype=t.type;
    if(t.type==='item'){iid=t.item?.id||'';if(iid==='ftbfiltersystem:smart_filter'){const fi=parseFilter(t.item?.components?.['ftbfiltersystem:filter']);iid=fi.id||'';tname=fi.name;tmod=fi.id?itemMod(fi.id):'FTB Filter System';}else{const cnt=t.count>1?` ×${t.count}`:'';tname=itemName(iid)+cnt;tmod=itemMod(iid);}}
    else if(t.type==='kill'){iid=t.icon?.id||t.entity||'';tname=`Kill ${itemName(t.entity||'')} ×${t.value||1}`;tmod=itemMod(t.entity||'');}
    else if(t.type==='biome'){iid=t.icon?.id||t.biome||'';tname=`Visit ${itemName(t.biome||'')}`;tmod='Biome';}
    else if(t.type==='advancement'){const n=(t.advancement||'').split('/').pop()?.split('_').map(w=>w[0]?.toUpperCase()+w.slice(1)).join(' ')||'Advancement';tname=n;tmod=t.advancement||'';}
    else if(t.type==='checkmark'){tname='Manual Checkmark';tmod='Click complete to finish';}
    const chk=document.createElement('div');chk.className='chk'+(done?' done':'');if(done)chk.textContent='✓';
    row.appendChild(makeSlot(iid,'slot-sm'));
    row.appendChild(mkInfo(tname,tmod,ttype));
    row.appendChild(chk);
    pane.appendChild(row);
  });
}

function fillRewardsTab(q) {
  const pane=document.getElementById('tab-rewards'); pane.innerHTML='';
  if(!q.rewards?.length){pane.innerHTML='<div class="empty-tab">No rewards.</div>';return;}
  q.rewards.forEach(r=>{
    if(r.type==='xp'){const d=document.createElement('div');d.className='xpbadge';d.textContent=`✦ ${r.xp} XP`;pane.appendChild(d);return;}
    if(r.type==='item'){const iid=r.item?.id||'';const cnt=(r.count||1)>1?` ×${r.count}`:'';const row=document.createElement('div');row.className='rew-row';row.appendChild(makeSlot(iid,'slot-sm'));row.appendChild(mkInfo(itemName(iid)+cnt,itemMod(iid)));pane.appendChild(row);return;}
    if(r.type==='loot'||r.type==='random'){const row=document.createElement('div');row.className='rew-row';row.innerHTML='<div class="islot slot-sm"><span>🎁</span></div>';row.appendChild(mkInfo('Random Loot','Reward table'));pane.appendChild(row);}
  });
}

function fillPrereqsTab(q) {
  const pane=document.getElementById('tab-prereqs'); pane.innerHTML='';
  const deps=q.dependencies||[];
  if(!deps.length){pane.innerHTML='<div class="empty-tab">No prerequisites.</div>';return;}
  deps.forEach(depId=>{
    const dep=QUEST_MAP[depId]; if(!dep) return;
    const ds=questStatus(dep);
    const row=document.createElement('div'); row.className='dep-row';
    row.addEventListener('click',()=>{closeDetail();setTimeout(()=>selectQuest(dep),50);});
    const customSrc2=dep._customIconPath?resolveImageSrc(dep._customIconPath):null;
    row.appendChild(makeSlot(dep._iconId||'','slot-sm',customSrc2));
    const info=document.createElement('div'); info.className='iinfo';
    info.innerHTML=`<div class="iname dep-status-${ds}">${dep._title||''}</div><div class="imod">${ds}</div>`;
    row.appendChild(info);
    pane.appendChild(row);
  });
}

function switchTab(name,el) {
  document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.dp-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  if(el)el.classList.add('active');
}

function closeDetail() {
  document.getElementById('dp-overlay').classList.remove('open');
  document.querySelectorAll('.qnode').forEach(n=>n.classList.remove('sel'));
  selQuest=null;
}

function toggleDone(id) {
  completed.has(id)?completed.delete(id):completed.add(id);
  localStorage.setItem('ftbq_done',JSON.stringify([...completed]));
  renderSidebar();
  if(activeChap)renderQuests(activeChap);
  if(selQuest?.id===id)renderDetail(selQuest);
}

document.getElementById('dp-overlay').addEventListener('click',e=>{if(e.target===document.getElementById('dp-overlay'))closeDetail();});

// ── HELPERS ───────────────────────────────────────────────
function mkInfo(name,mod='',type='') {
  const d=document.createElement('div'); d.className='iinfo';
  d.innerHTML=`<div class="iname">${name}</div>${mod?`<div class="imod">${mod}</div>`:''}${type?`<div class="tasktype">${type}</div>`:''}`;
  return d;
}

// ── KEYBOARD ──────────────────────────────────────────────
document.addEventListener('keydown',e=>{if(document.activeElement.tagName==='INPUT')return;if(e.key==='Escape')closeDetail();});

// ── LOADING HELPERS ───────────────────────────────────────
function setLoading(msg,pct){document.getElementById('loading-msg').textContent=msg;document.getElementById('loading-bar').style.width=pct+'%';}
function showError(title,msg,hint=''){
  document.getElementById('loading').classList.add('hidden');
  let el=document.getElementById('error-screen');
  if(!el){el=document.createElement('div');el.id='error-screen';el.style.cssText='position:fixed;inset:0;z-index:9999;background:#111;display:flex;align-items:center;justify-content:center;text-align:center;padding:40px';document.body.appendChild(el);}
  el.innerHTML=`<div><div style="color:#ff5555;font-size:9px;margin-bottom:16px;font-family:\'Press Start 2P\'">${title}</div><div style="color:#aaa;font-family:VT323,monospace;font-size:18px;margin-bottom:12px">${msg}</div><div style="color:#666;font-family:VT323,monospace;font-size:16px">${hint}</div></div>`;
}

// ── BOOT ──────────────────────────────────────────────────
if (typeof TEXTURES === 'undefined') window.TEXTURES = {};
init();
