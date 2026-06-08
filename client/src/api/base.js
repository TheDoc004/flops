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

