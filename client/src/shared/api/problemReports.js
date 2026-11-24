import { apiFetch } from './base';

/** The server stamps the app version; the client sends only what was typed and where. */
export async function submitProblemReport({ text, route }) {
  const res = await apiFetch('/api/problem-reports', {
    method: 'POST',
    body: JSON.stringify({ text, route }),
  });
  if (!res.ok) {
    let message = 'Could not send the report.';
    try {
      message = (await res.json())?.error || message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  return res.json();
}
