const TOKEN_KEY = 'flops_auth_token';

export function apiUrl(path) {
  const p = String(path || '');
  if (!p.startsWith('/')) throw new Error(`apiUrl expected an absolute path, got: ${p}`);

  const configured = import.meta?.env?.VITE_API_BASE_URL;
  if (configured) return `${configured}${p}`;

  // In dev, call the API directly (CORS is enabled on the server). The Vite
  // proxy can hang on some setups; preview/production still use the fallback below.
  if (import.meta.env.DEV) {
    return `http://localhost:3001${p}`;
  }

  if (typeof window !== 'undefined') {
    const port = window.location?.port;
    if (port && port !== '5173') return `http://localhost:3001${p}`;
  }
  return p;
}

export function getAuthToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearAuthToken() {
  setAuthToken(null);
}

/**
 * Authenticated fetch against the FLOPS API.
 * Adds Bearer token when present and Content-Type for JSON string bodies.
 * On 401, clears the stored token and dispatches `flops:auth-expired`.
 */
export async function apiFetch(path, options = {}) {
  const opts = { ...options };
  const headers = new Headers(opts.headers || {});
  const token = getAuthToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (
    opts.body != null &&
    typeof opts.body === 'string' &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }
  opts.headers = headers;

  const res = await fetch(apiUrl(path), opts);
  if (res.status === 401) {
    clearAuthToken();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('flops:auth-expired'));
    }
  }
  return res;
}
