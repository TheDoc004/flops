/** Shared small utilities (time helpers still used by log UI / legacy flows). */

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function parseHHMMToTimeMin(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

export function timeMinToHHMM(timeMin) {
  if (timeMin == null) return '';
  const t = Number(timeMin);
  if (!Number.isFinite(t) || t < 0 || t > 1439) return '';
  const h = String(Math.floor(t / 60)).padStart(2, '0');
  const m = String(t % 60).padStart(2, '0');
  return `${h}:${m}`;
}

export function minutesSinceMidnightLocal(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes();
}

