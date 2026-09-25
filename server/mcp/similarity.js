/**
 * Normalized name similarity for MCP duplicate guards.
 * Prefer simple Levenshtein over a dependency.
 */

function normalizeName(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const s = normalizeName(a);
  const t = normalizeName(b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const rows = s.length + 1;
  const cols = t.length + 1;
  const prev = new Array(cols);
  const cur = new Array(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i < rows; i++) {
    cur[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j < cols; j++) prev[j] = cur[j];
  }
  return prev[t.length];
}

/** Similarity in [0,1]; 1 = identical after normalize. */
function nameSimilarity(a, b) {
  const s = normalizeName(a);
  const t = normalizeName(b);
  if (!s && !t) return 1;
  if (!s || !t) return 0;
  if (s === t) return 1;
  // Contained names of similar length are near-duplicates ("olive oil" / "olive oils")
  if (s.includes(t) || t.includes(s)) {
    const ratio = Math.min(s.length, t.length) / Math.max(s.length, t.length);
    if (ratio >= 0.7) return Math.max(0.9, ratio);
  }
  const dist = levenshtein(s, t);
  const maxLen = Math.max(s.length, t.length);
  return Math.max(0, 1 - dist / maxLen);
}

/** High threshold: refuse create unless allow_duplicate. */
const DUPLICATE_SIMILARITY_THRESHOLD = 0.85;

function findDuplicateMatches(candidates, name, { threshold = DUPLICATE_SIMILARITY_THRESHOLD } = {}) {
  const scored = (candidates || [])
    .map(row => ({
      ...row,
      similarity: nameSimilarity(name, row.name),
    }))
    .filter(r => r.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity);
  return scored;
}

module.exports = {
  normalizeName,
  levenshtein,
  nameSimilarity,
  DUPLICATE_SIMILARITY_THRESHOLD,
  findDuplicateMatches,
};
