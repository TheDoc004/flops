import { apiFetch, clearAuthToken, setAuthToken } from './base';

async function readJsonIfPresent(res) {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!text) return null;
  if (!contentType.toLowerCase().includes('application/json')) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function requestOtp(email) {
  const res = await apiFetch('/api/auth/request-otp', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to request code');
  }
  return res.json();
}

export async function verifyOtp(email, code) {
  const res = await apiFetch('/api/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Invalid or expired code');
  }
  const data = await res.json();
  if (data?.token) setAuthToken(data.token);
  return data;
}

export async function appleSignIn(payload) {
  const res = await apiFetch('/api/auth/apple', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Apple sign-in failed');
  }
  const data = await res.json();
  if (data?.token) setAuthToken(data.token);
  return data;
}

export async function fetchMe() {
  const res = await apiFetch('/api/auth/me');
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Not signed in');
  }
  return res.json();
}

export async function logout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } finally {
    clearAuthToken();
  }
}

export async function patchMe(body) {
  const res = await apiFetch('/api/auth/me', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to update profile');
  }
  return res.json();
}
