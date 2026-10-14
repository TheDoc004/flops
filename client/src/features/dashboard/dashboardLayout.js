/**
 * Today card order + show/hide. The drag/resize layout editor was vaulted
 * (Oct 2026) — it lives on the branch `archive/dashboard-layout-editor`.
 * Until it returns, order is fixed here and any saved `dash_layout_json`
 * positions are ignored; profile flags still decide which cards show.
 */

export const DASH_CARD_IDS = ['supplements', 'macros', 'weight', 'weight_chart', 'meals'];

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

/**
 * Cards in stack order, visibility resolved from profile flags. Supplements sit
 * first so they can be checked off without scrolling.
 */
export function dashboardCards(profile = {}) {
  const cards = DASH_CARD_IDS.map(id => {
    const meta = DASH_CARD_META[id];
    const visible = meta.profileKey ? isProfileFlagOn(profile, meta.profileKey, !meta.defaultOff) : true;
    return { id, visible };
  });
  // Legacy alias: dash_weight_chart_enabled also turns on the chart card.
  if (isProfileFlagOn(profile, 'dash_weight_chart_enabled', false)) {
    cards.find(c => c.id === 'weight_chart').visible = true;
  }
  return cards;
}

export function visibleCardIds(cards) {
  return cards.filter(c => c.visible).map(c => c.id);
}
