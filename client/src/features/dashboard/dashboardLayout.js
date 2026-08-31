export const DASH_LAYOUT_VERSION = 1;

export const DASH_CARD_IDS = ['macros', 'supplements', 'weight', 'weight_chart', 'meals'];

/** Card metadata for the layout editor and profile sync. */
export const DASH_CARD_META = {
  macros: { label: 'Macros', canHide: false },
  supplements: { label: 'Supplements', profileKey: 'dash_supplements_enabled' },
  weight: { label: 'Weight', profileKey: 'dash_weight_enabled' },
  weight_chart: { label: 'Weight trend', profileKey: 'dash_weight_chart_card_enabled', defaultOff: true },
  meals: { label: "Today's meals", profileKey: 'dash_meals_enabled' },
};

export function isProfileFlagOn(profile, key, defaultOn = true) {
  if (!key) return defaultOn;
  const v = profile[key];
  if (v === null || v === undefined || v === '') return defaultOn;
  return v !== 0 && v !== false && v !== '0';
}

/** Profile show/hide flags are authoritative for toggleable cards. */
export function applyProfileVisibility(cards, profile = {}) {
  for (const card of cards) {
    const meta = DASH_CARD_META[card.id];
    if (!meta?.profileKey) continue;
    const on = isProfileFlagOn(profile, meta.profileKey, !meta.defaultOff);
    card.visible = on;
  }
  return cards;
}

/** Build profile PUT fields from layout card visibility. */
export function profilePatchForLayout(layout) {
  const patch = {};
  for (const id of DASH_CARD_IDS) {
    const meta = DASH_CARD_META[id];
    if (!meta?.profileKey) continue;
    const card = layout?.cards?.find(c => c.id === id);
    patch[meta.profileKey] = card?.visible !== false ? 1 : 0;
  }
  return patch;
}

export function setCardVisible(layout, cardId, visible) {
  const cards = (layout?.cards || DEFAULT_DASH_LAYOUT).map(c =>
    (c.id === cardId ? { ...c, visible } : c),
  );
  return { version: DASH_LAYOUT_VERSION, cards };
}

/** Default desktop canvas layout (12-column grid). */
export const DEFAULT_DASH_LAYOUT = [
  { id: 'macros', x: 0, y: 0, w: 12, h: 4, visible: true },
  { id: 'supplements', x: 0, y: 4, w: 12, h: 3, visible: true },
  { id: 'weight', x: 0, y: 7, w: 6, h: 3, visible: true },
  { id: 'weight_chart', x: 6, y: 7, w: 6, h: 3, visible: false },
  { id: 'meals', x: 0, y: 10, w: 12, h: 8, visible: true },
];

function boolFlag(v, defaultOn = true) {
  if (v === null || v === undefined || v === '') return defaultOn;
  if (v === true || v === 1 || v === '1') return true;
  return false;
}

function savedCardList(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.cards)) return parsed.cards;
  return null;
}

/** Merge saved layout with defaults when new cards ship. */
export function mergeDashLayout(saved, profile = {}) {
  let parsed = saved;
  if (typeof saved === 'string') {
    try { parsed = JSON.parse(saved); } catch { parsed = null; }
  }
  const byId = new Map();
  const savedCards = savedCardList(parsed);
  if (savedCards) {
    for (const item of savedCards) {
      if (item && DASH_CARD_IDS.includes(item.id)) byId.set(item.id, { ...item });
    }
  }
  const merged = DEFAULT_DASH_LAYOUT.map(def => {
    const hit = byId.get(def.id);
    if (!hit) return { ...def };
    return {
      ...def,
      ...hit,
      id: def.id,
      visible: hit.visible !== false,
    };
  });

  applyProfileVisibility(merged, profile);
  // Legacy alias: dash_weight_chart_enabled also turns on the chart card.
  const chart = merged.find(c => c.id === 'weight_chart');
  if (chart && boolFlag(profile.dash_weight_chart_enabled, false)) {
    chart.visible = true;
  }

  return { version: DASH_LAYOUT_VERSION, cards: merged };
}

export function visibleCards(layout) {
  return (layout?.cards || DEFAULT_DASH_LAYOUT).filter(c => c.visible !== false);
}

export function mobileStackOrder(layout) {
  return visibleCards(layout)
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(c => c.id);
}

/** Row height (px) used in the layout editor grid. */
export const EDIT_GRID_ROW_HEIGHT = 36;

/** Default row counts per card — tuned to match natural Today stack heights. */
export const EDIT_DEFAULT_ROWS = {
  macros: 3,
  supplements: 4,
  weight: 3,
  weight_chart: 5,
  meals: 6,
};

/**
 * Seed edit-mode grid from the current Today stack so cards open at view-like
 * sizes (full-width column) instead of oversized saved grid cells.
 */
export function layoutForEditSession(layout, { mealCount = 0 } = {}) {
  const order = mobileStackOrder(layout);
  const byId = new Map((layout?.cards || DEFAULT_DASH_LAYOUT).map(c => [c.id, { ...c }]));
  let y = 0;
  for (const id of order) {
    const c = byId.get(id);
    if (!c || c.visible === false) continue;
    let h = EDIT_DEFAULT_ROWS[id] ?? 3;
    h = Math.max(h, EDIT_MIN_ROWS[id] ?? 2);
    if (id === 'meals') {
      h = Math.min(12, EDIT_DEFAULT_ROWS.meals + Math.ceil(mealCount / 2));
    }
    c.x = 0;
    c.w = 12;
    c.y = y;
    c.h = h;
    y += h;
  }
  return {
    version: DASH_LAYOUT_VERSION,
    cards: (layout?.cards || DEFAULT_DASH_LAYOUT).map(c => byId.get(c.id) || { ...c }),
  };
}

const CORNER_HANDLES = ['nw', 'ne', 'sw', 'se'];

/** Max row counts in the editor — prevents runaway saved heights from dominating the canvas. */
export const EDIT_MAX_ROWS = {
  macros: 6,
  supplements: 6,
  weight: 5,
  weight_chart: 8,
  meals: 14,
};

/**
 * Minimum grid rows per card — resize handles snap here; content stays readable.
 * Tuned for EDIT_GRID_ROW_HEIGHT (36px) + 12px vertical margin between rows.
 */
export const EDIT_MIN_ROWS = {
  macros: 4,
  supplements: 3,
  weight: 2,
  weight_chart: 4,
  meals: 3,
};

/** Lowest uniform scale applied in edit mode — below this, text/rings become illegible. */
export const EDIT_MIN_SCALE = {
  macros: 0.76,
  supplements: 0.78,
  weight: 0.76,
  weight_chart: 0.62,
  meals: 0.78,
};

/** Minimum grid columns (of 12) — prevents extreme horizontal wrap on text-heavy cards. */
export const EDIT_MIN_COLS = {
  macros: 10,
  supplements: 8,
  weight: 5,
  weight_chart: 6,
  meals: 8,
};

/** Minimum rendered typography in edit mode (px) — used to derive scale floors. */
export const EDIT_MIN_BODY_PX = 12;
export const EDIT_MIN_TITLE_PX = 16;

function clampEditCols(cardId, w) {
  const min = EDIT_MIN_COLS[cardId] ?? 4;
  const n = Number(w);
  if (!Number.isFinite(n)) return 12;
  return Math.min(12, Math.max(min, Math.round(n)));
}

function clampEditRows(cardId, h) {
  const max = EDIT_MAX_ROWS[cardId] ?? 10;
  const min = EDIT_MIN_ROWS[cardId] ?? 2;
  const n = Number(h);
  if (!Number.isFinite(n)) return EDIT_DEFAULT_ROWS[cardId] ?? 3;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function layoutToRgl(layout) {
  return visibleCards(layout).map(c => ({
    i: c.id,
    x: c.x,
    y: c.y,
    w: clampEditCols(c.id, c.w),
    h: clampEditRows(c.id, c.h),
    minW: EDIT_MIN_COLS[c.id] ?? 4,
    minH: EDIT_MIN_ROWS[c.id] ?? 2,
    maxH: EDIT_MAX_ROWS[c.id] ?? 10,
    resizeHandles: CORNER_HANDLES,
  }));
}

export function rglToLayout(prevLayout, nextItems) {
  const byId = new Map((prevLayout?.cards || DEFAULT_DASH_LAYOUT).map(c => [c.id, { ...c }]));
  for (const item of nextItems) {
    const prev = byId.get(item.i) || DEFAULT_DASH_LAYOUT.find(c => c.id === item.i);
    if (!prev) continue;
    byId.set(item.i, {
      ...prev,
      x: item.x,
      y: item.y,
      w: clampEditCols(item.i, item.w),
      h: clampEditRows(item.i, item.h),
      visible: prev.visible !== false,
    });
  }
  return {
    version: DASH_LAYOUT_VERSION,
    cards: DEFAULT_DASH_LAYOUT.map(def => byId.get(def.id) || { ...def }),
  };
}
