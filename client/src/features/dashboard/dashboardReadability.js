import { EDIT_MIN_BODY_PX, EDIT_MIN_SCALE, EDIT_MIN_TITLE_PX } from './dashboardLayout';

const TITLE_SELECTOR = '.section-title, .subsection-title, h2, h3';

/** Minimum drawable chart area (px) — Y-axis ticks + trend line must stay visible. */
const GRAPH_MIN_CHART_PX = 100;

function isTitleNode(el) {
  return el.matches?.(TITLE_SELECTOR);
}

/** Typography floor shared by text-heavy cards. */
function typographyScaleFloor(root, cardId, { bodyPx = EDIT_MIN_BODY_PX, titlePx = EDIT_MIN_TITLE_PX } = {}) {
  let floor = EDIT_MIN_SCALE[cardId] ?? 0.65;
  const nodes = root.querySelectorAll('*');
  for (let i = 0; i < nodes.length; i += 1) {
    const el = nodes[i];
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (!Number.isFinite(fs) || fs <= 0) continue;
    const minPx = isTitleNode(el) ? titlePx : bodyPx;
    floor = Math.max(floor, minPx / fs);
  }
  const rootFs = parseFloat(getComputedStyle(root).fontSize);
  if (Number.isFinite(rootFs) && rootFs > 0) floor = Math.max(floor, bodyPx / rootFs);
  return floor;
}

/** Weight trend — horizontal squeeze is fine; vertical must keep the full plot legible. */
export function graphReadabilityFloor(root) {
  let floor = typographyScaleFloor(root, 'weight_chart');
  const chart = root.querySelector('.recharts-responsive-container');
  if (chart) {
    const h = chart.offsetHeight || chart.getBoundingClientRect().height;
    if (h > 0) floor = Math.max(floor, GRAPH_MIN_CHART_PX / h);
  }
  return floor;
}

/** Macros rings — current thresholds work well; keep as-is. */
export function macrosReadabilityFloor(root) {
  return typographyScaleFloor(root, 'macros');
}

/** Supplement chips — same as macros; vertical min rows prevent hiding the section. */
export function supplementsReadabilityFloor(root) {
  return typographyScaleFloor(root, 'supplements');
}

/** Compact meal list — allow tighter uniform scale; typography floor is the hard stop. */
export function mealsListReadabilityFloor(root) {
  return typographyScaleFloor(root, 'meals', { bodyPx: EDIT_MIN_BODY_PX });
}

/** Weight row — single-line numeric entry. */
export function weightReadabilityFloor(root) {
  return typographyScaleFloor(root, 'weight');
}

const FLOOR_BY_CARD = {
  weight_chart: graphReadabilityFloor,
  macros: macrosReadabilityFloor,
  supplements: supplementsReadabilityFloor,
  meals: mealsListReadabilityFloor,
  weight: weightReadabilityFloor,
};

/** Per-card scale floor for DashboardCardScale — replaces one global readability check. */
export function readabilityScaleFloor(cardId, root) {
  const fn = FLOOR_BY_CARD[cardId];
  if (fn) return fn(root);
  return typographyScaleFloor(root, cardId);
}
