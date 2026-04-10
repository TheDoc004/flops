export async function fetchLogForDate(date) {
  const res = await fetch(`/api/log?date=${date}`);
  if (!res.ok) throw new Error('Failed to fetch log');
  return res.json();
}

export async function fetchLogRange(start, end) {
  const res = await fetch(`/api/log?start=${start}&end=${end}`);
  if (!res.ok) throw new Error('Failed to fetch log range');
  return res.json();
}

export async function createLogEntry(data) {
  const res = await fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed to log meal'); }
  return res.json();
}

export async function deleteLogEntry(id) {
  const res = await fetch(`/api/log/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete log entry');
}
