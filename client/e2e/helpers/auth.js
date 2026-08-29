import { cfg } from './config.js';

/**
 * Login for E2E: FLOPS_E2E_TOKEN (production) or AUTH_DEV OTP (local).
 */
export async function getSessionToken(request) {
  if (cfg.authToken) return cfg.authToken;

  const otpRes = await request.post(`${cfg.apiBase}/api/auth/request-otp`, {
    data: { email: cfg.email },
  });
  if (!otpRes.ok()) {
    throw new Error(`request-otp failed: ${otpRes.status()} ${await otpRes.text()}`);
  }
  const otpBody = await otpRes.json();
  const code = otpBody.dev_code;
  if (!code) {
    throw new Error(
      'No dev_code from request-otp. Local: ensure AUTH_DEV=1 on API. '
      + 'Production: set FLOPS_E2E_TOKEN from browser localStorage (flops_auth_token).',
    );
  }
  const verifyRes = await request.post(`${cfg.apiBase}/api/auth/verify-otp`, {
    data: { email: cfg.email, code: String(code) },
  });
  if (!verifyRes.ok()) {
    throw new Error(`verify-otp failed: ${verifyRes.status()} ${await verifyRes.text()}`);
  }
  const { token } = await verifyRes.json();
  if (!token) throw new Error('verify-otp returned no token');

  await request.patch(`${cfg.apiBase}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { onboarding_completed: true, display_name: 'E2E User' },
  });

  return token;
}

/** Inject session token then open a path. */
export async function openAuthed(page, request, path) {
  const token = await getSessionToken(request);
  await page.addInitScript((t) => {
    localStorage.setItem('flops_auth_token', t);
  }, token);
  await page.goto(path);
  await page.waitForLoadState('domcontentloaded');
  await page.locator('main.app-main').waitFor({ state: 'visible', timeout: 30_000 });
}

/** Fetch profile layout JSON for diagnostics. */
export async function fetchProfileLayout(request) {
  const token = await getSessionToken(request);
  const res = await request.get(`${cfg.apiBase}/api/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok()) throw new Error(`GET /api/profile failed: ${res.status()}`);
  const profile = await res.json();
  let layout = profile.dash_layout_json;
  if (typeof layout === 'string') {
    try { layout = JSON.parse(layout); } catch { layout = null; }
  }
  return { profile, layout };
}
