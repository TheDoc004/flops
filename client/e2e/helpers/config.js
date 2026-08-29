/**
 * Layout-editor verification thresholds and targets.
 * Override via environment variables — see docs/verify-dashboard-editor.md
 */

function num(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const cfg = {
  baseURL: process.env.FLOPS_BASE_URL || process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
  apiBase: process.env.FLOPS_API_BASE || process.env.PLAYWRIGHT_API_BASE || 'http://localhost:3001',
  /** Skip spawning local dev servers when testing a deployed URL */
  external: process.env.FLOPS_E2E_EXTERNAL === '1' || process.env.FLOPS_E2E_EXTERNAL === 'true',
  /** Bearer token for production/staging (copy from localStorage flops_auth_token) */
  authToken: process.env.FLOPS_E2E_TOKEN || '',
  /** Dev login email when AUTH_DEV=1 */
  email: process.env.FLOPS_E2E_EMAIL || `e2e-${Date.now()}@example.com`,
  editPath: process.env.FLOPS_EDIT_PATH || '/?editLayout=1',
  thresholds: {
    macrosMaxHeightPx: num('FLOPS_LAYOUT_MACROS_MAX_HEIGHT', 280),
    minDragDeltaPx: num('FLOPS_LAYOUT_MIN_DRAG_DELTA', 20),
    maxHorizontalOverflowPx: num('FLOPS_LAYOUT_MAX_H_SCROLL', 4),
  },
  viewports: {
    desktop: { width: 1280, height: 900 },
    mobile: { width: 390, height: 844 },
  },
};

export function isProductionTarget() {
  return !cfg.baseURL.includes('localhost') && !cfg.baseURL.includes('127.0.0.1');
}
