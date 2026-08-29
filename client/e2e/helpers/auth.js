const API_BASE = process.env.PLAYWRIGHT_API_BASE || 'http://localhost:3001';

/**
 * Dev login via AUTH_DEV OTP (server returns dev_code). Sets flops_auth_token
 * before the first navigation when used with page.addInitScript.
 */
export async function devLogin(request, email = `e2e-${Date.now()}@example.com`) {
  const otpRes = await request.post(`${API_BASE}/api/auth/request-otp`, {
    data: { email },
  });
  if (!otpRes.ok()) {
    throw new Error(`request-otp failed: ${otpRes.status()} ${await otpRes.text()}`);
  }
  const otpBody = await otpRes.json();
  const code = otpBody.dev_code;
  if (!code) {
    throw new Error('AUTH_DEV=1 required for E2E login (dev_code missing from request-otp)');
  }
  const verifyRes = await request.post(`${API_BASE}/api/auth/verify-otp`, {
    data: { email, code: String(code) },
  });
  if (!verifyRes.ok()) {
    throw new Error(`verify-otp failed: ${verifyRes.status()} ${await verifyRes.text()}`);
  }
  const { token } = await verifyRes.json();
  if (!token) throw new Error('verify-otp returned no token');

  const meRes = await request.patch(`${API_BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { onboarding_completed: true, display_name: 'E2E User' },
  });
  if (!meRes.ok()) {
    throw new Error(`patch me failed: ${meRes.status()} ${await meRes.text()}`);
  }

  return { email, token };
}

/** Inject session token then open a path. */
export async function openAuthed(page, request, path) {
  const { token } = await devLogin(request);
  await page.addInitScript((t) => {
    localStorage.setItem('flops_auth_token', t);
  }, token);
  await page.goto(path);
  await page.waitForLoadState('domcontentloaded');
  await page.locator('.dash-edit-mode-banner, .dashboard-canvas--edit, .dashboard-stack').first().waitFor({
    state: 'visible',
    timeout: 30_000,
  });
}
