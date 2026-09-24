import { apiFetch } from './base';

export async function fetchRecentMcpWrites({ days = 1 } = {}) {
  const res = await apiFetch(`/api/mcp-writes/recent?days=${encodeURIComponent(days)}`);
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    throw new Error(e?.error || 'Failed to fetch MCP writes');
  }
  return res.json();
}

export async function bulkDeleteMcpWrites({ log_entry_ids = [], label_ingredient_ids = [] } = {}) {
  const res = await apiFetch('/api/mcp-writes/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ log_entry_ids, label_ingredient_ids }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    throw new Error(e?.error || 'Failed to delete MCP writes');
  }
  return res.json();
}
