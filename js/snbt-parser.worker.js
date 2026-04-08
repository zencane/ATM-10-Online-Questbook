// ═══════════════════════════════════════════════════════════
//  snbt-parser.worker.js
// ═══════════════════════════════════════════════════════════

function parseSNBT(str) {
  let p = 0;
  const L = str.length;

  const ws = () => { while (p < L && ' \t\r\n'.includes(str[p])) p++; };

  const parseVal = () => {
    ws();
    if (p >= L) return null;
    const c = str[p];
    if (c === '{') return parseObj();
    if (c === '[') return parseArr();
    if (c === '"') return parseStr();
    if (str.startsWith('true',  p)) { p += 4; return true;  }
    if (str.startsWith('false', p)) { p += 5; return false; }
    return parseNum();
  };

  const parseObj = () => {
    p++; const o = {};
    while (p < L) {
      ws();
      if (str[p] === '}') { p++; break; }
      if (str[p] === ',') { p++; continue; }
      // Safety guard — if nothing consumed, advance to prevent infinite loop
      const before = p;
      let k;
      if (str[p] === '"') k = parseStr();
      else {
        let s = p;
        while (p < L && !':,\n\r \t}'.includes(str[p])) p++;
        k = str.slice(s, p).trim();
      }
      ws(); if (p < L && str[p] === ':') p++;
      o[k] = parseVal();
      if (p === before) p++; // safety advance
    }
    return o;
  };

  const parseArr = () => {
    p++; const a = [];
    // Handle NBT typed array prefixes: [B; [I; [L;
    // e.g. [L;256000000L,512000000L]
    ws();
    if (p < L && 'BILbil'.includes(str[p]) && p + 1 < L && str[p + 1] === ';') {
      p += 2; // skip the type prefix entirely — treat as regular array
    }
    while (p < L) {
      ws();
      if (str[p] === ']') { p++; break; }
      if (str[p] === ',') { p++; continue; }
      const before = p;
      a.push(parseVal());
      // Safety guard — if parseVal didn't advance, skip the character
      // This prevents infinite loops on any unrecognised syntax
      if (p === before) p++;
    }
    return a;
  };

  const parseStr = () => {
    p++; let s = '';
    while (p < L && str[p] !== '"') {
      if (str[p] === '\\') { p++; s += str[p] ?? ''; }
      else s += str[p];
      p++;
    }
    p++; return s;
  };

  const parseNum = () => {
    const s = p;
    if (p < L && str[p] === '-') p++;
    while (p < L && '0123456789.'.includes(str[p])) p++;
    // consume numeric suffix (L, d, f, b, s, etc.)
    if (p < L && 'dDlLfFbBsS'.includes(str[p])) p++;
    const raw = str.slice(s, p).replace(/[dDlLfFbBsS]$/, '');
    if (raw === '' || raw === '-') { return 0; }
    const n = parseFloat(raw);
    return isNaN(n) ? 0 : n;
  };

  return parseVal();
}

// ── HELPERS ───────────────────────────────────────────────
function toTitle(id) {
  if (!id) return 'Quest';
  return id.split(':').pop().split('_').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ');
}

function resolveFilter(f) {
  if (!f) return null;
  const t = f.match(/item_tag\(([^)]+)\)/);
  if (t) return t[1].replace('ftbfiltersystem:', '');
  const it = f.match(/item\(([^)]+)\)/);
  if (it) return it[1];
  return null;
}

function questMeta(q) {
  let iconId = null, customIconPath = null, title = null, taskIconId = null;

  const raw = q.icon;
  if (raw?.id === 'ftbquests:custom_icon') {
    customIconPath = raw?.components?.['ftbquests:icon'] || null;
  } else if (raw?.id) {
    iconId = raw.id;
  }

  const tasks = q.tasks || [];
  if (tasks.length) {
    const t = tasks[0];
    taskIconId = t.icon?.id || null;
    const ttype = t.type || '';

    if (ttype === 'item') {
      const iid = t.item?.id || '';
      if (iid === 'ftbfiltersystem:smart_filter') {
        const fs  = t.item?.components?.['ftbfiltersystem:filter'] || '';
        const res = resolveFilter(fs);
        title = toTitle(res || 'item');
        taskIconId = taskIconId || res;
      } else if (iid) {
        const disp = taskIconId || iid;
        title = toTitle(disp);
        taskIconId = disp;
      }
    } else if (ttype === 'kill') {
      const ent = t.entity || '';
      taskIconId = taskIconId || ent;
      title = 'Kill ' + toTitle(ent);
    } else if (ttype === 'biome') {
      const bio = t.biome || '';
      taskIconId = taskIconId || bio;
      title = 'Visit ' + toTitle(bio);
    } else if (ttype === 'advancement') {
      const adv = t.advancement || '';
      const ai  = 'minecraft:' + adv.split('/').pop();
      taskIconId = taskIconId || ai;
      title = toTitle(adv.split('/').pop());
    } else if (ttype === 'checkmark') {
      title = 'Optional Task';
      taskIconId = null;
    }
  }

  return {
    iconId:         iconId || taskIconId || null,
    customIconPath: customIconPath,
    title:          title || toTitle(iconId || taskIconId || 'quest'),
  };
}

// ── MESSAGE HANDLER ───────────────────────────────────────
self.onmessage = function(e) {
  const { snbt, chapterId } = e.data;
  try {
    self.postMessage({ type: 'progress', chapterId, msg: 'Parsing...', pct: 10 });
    const t0   = Date.now();
    const data = parseSNBT(snbt);
    const ms   = Date.now() - t0;
    self.postMessage({ type: 'progress', chapterId, msg: 'Attaching metadata...', pct: 70 });

    (data.quests || []).forEach(q => {
      const m = questMeta(q);
      q._iconId         = m.iconId;
      q._customIconPath = m.customIconPath;
      q._title          = m.title;
    });

    self.postMessage({ type: 'done', chapterId, data: {
      id:       data.id,
      filename: data.filename,
      images:   data.images   || [],
      quests:   data.quests   || [],
      progression_mode: data.progression_mode,
    }, parseMs: ms });

  } catch(err) {
    self.postMessage({ type: 'error', chapterId, error: err.message });
  }
};
