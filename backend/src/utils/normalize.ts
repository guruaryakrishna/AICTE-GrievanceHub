/**
 * Shared text normalization for institution identity matching.
 * Removes punctuation, collapses whitespace, lowercases, and normalizes
 * common institution-name abbreviations.
 */
const ABBREVIATIONS: Record<string, string> = {
  engg: 'engineering',
  eng: 'engineering',
  inst: 'institute',
  instt: 'institute',
  tech: 'technology',
  techno: 'technology',
  univ: 'university',
  coll: 'college',
  clg: 'college',
  govt: 'government',
  mgmt: 'management',
  sci: 'science',
  res: 'research',
};

export function normalizeText(input: string): string {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeInstitutionName(input: string): string {
  return normalizeText(input)
    .split(' ')
    .map((token) => ABBREVIATIONS[token] ?? token)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(input: string): string[] {
  return normalizeInstitutionName(input)
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

const STOPWORDS = new Set([
  'the', 'of', 'and', 'for', 'at', 'in', 'on', 'a', 'an', 'to', 'by', 'with',
]);

/** Levenshtein distance (iterative, O(mn)). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        last + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      last = temp;
    }
  }
  return prev[b.length];
}

/** Similarity ratio between 0 and 1 based on edit distance. */
export function similarityRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

/** Jaccard similarity of token sets. */
export function tokenJaccard(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function jaccardSets<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  return intersection / (a.size + b.size - intersection);
}
