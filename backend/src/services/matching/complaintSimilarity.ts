import { normalizeText, tokenize, similarityRatio } from '../../utils/normalize';

export interface ComplaintLike {
  id?: string;
  title: string;
  description: string;
  categoryId?: string | null;
  categoryName?: string | null;
  institutionId?: string | null;
  dateReceived?: Date | null;
}

export interface SimilarityEvidence {
  type: string;
  detail: string;
  contribution: number;
}

export interface ComplaintSimilarityResult {
  score: number; // 0-1
  matchingKeywords: string[];
  evidence: SimilarityEvidence[];
  categoryMatch: boolean;
  sameInstitution: boolean;
  reasoning: string;
  isPotentialDuplicate: boolean;
}

export const SIMILARITY_THRESHOLDS = {
  /** Minimum score to surface a related-complaint suggestion */
  suggest: Number(process.env.SIMILARITY_SUGGEST_THRESHOLD || 0.45),
  /** Minimum score to classify as a potential duplicate */
  duplicate: Number(process.env.SIMILARITY_DUPLICATE_THRESHOLD || 0.55),
  /** Minimum score for management-level review flag */
  strong: Number(process.env.SIMILARITY_STRONG_THRESHOLD || 0.72),
};

const DESCRIPTION_STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'are', 'was',
  'were', 'been', 'being', 'about', 'into', 'regarding', 'related', 'concern',
  'concerns', 'complaint', 'complaints', 'institution', 'college', 'students',
  'also', 'which', 'their', 'there', 'these', 'those', 'not', 'but', 'its', 'our',
  'due', 'per', 'has', 'had', 'will', 'would', 'should', 'could', 'may', 'more',
]);

export function keywordSet(text: string): Set<string> {
  return new Set(
    normalizeText(text)
      .split(' ')
      .filter((t) => t.length > 2 && !DESCRIPTION_STOPWORDS.has(t)),
  );
}

/**
 * Transparent complaint similarity scoring.
 *
 * Weights:
 * - Same verified institution: 0.25
 * - Same complaint category: 0.15
 * - Title similarity (token Jaccard 60% + edit similarity 40%): up to 0.25
 * - Description similarity (token Jaccard): up to 0.30
 * - Date proximity (within 30 days): up to 0.05
 *
 * If institutions are different and both are known, score is capped at 0.25;
 * this deliberately prevents unrelated institutions from being flagged as
 * duplicates merely for using similar words.
 */
export function computeComplaintSimilarity(
  a: ComplaintLike,
  b: ComplaintLike,
): ComplaintSimilarityResult {
  const evidence: SimilarityEvidence[] = [];
  const aWords = keywordSet(a.description);
  const bWords = keywordSet(b.description);
  const matched = [...aWords].filter((w) => bWords.has(w));

  const sameInstitution = Boolean(a.institutionId && b.institutionId && a.institutionId === b.institutionId);
  const knownDifferentInstitution = Boolean(
    a.institutionId && b.institutionId && a.institutionId !== b.institutionId,
  );
  const categoryMatch = Boolean(
    (a.categoryId && b.categoryId && a.categoryId === b.categoryId) ||
    (a.categoryName && b.categoryName && a.categoryName === b.categoryName),
  );

  let score = 0;
  if (sameInstitution) {
    score += 0.25;
    evidence.push({
      type: 'SAME_INSTITUTION',
      detail: 'Both complaints concern the same verified institution',
      contribution: 0.25,
    });
  }
  if (categoryMatch) {
    score += 0.15;
    evidence.push({
      type: 'CATEGORY_MATCH',
      detail: `Same complaint category (${a.categoryName || b.categoryName || 'category'})`,
      contribution: 0.15,
    });
  }

  const titleJaccard = jaccard(keywordSet(a.title), keywordSet(b.title));
  const titleRatio = similarityRatio(normalizeText(a.title), normalizeText(b.title));
  const titleScore = (titleJaccard * 0.6 + titleRatio * 0.4) * 0.25;
  score += titleScore;
  if (titleScore > 0.02) {
    evidence.push({
      type: 'TITLE_SIMILARITY',
      detail: `Title similarity ${(titleScore / 0.25 * 100).toFixed(0)}% (shared terms: ${[...keywordSet(a.title)].filter((w) => keywordSet(b.title).has(w)).slice(0, 6).join(', ') || 'none'})`,
      contribution: round(titleScore),
    });
  }

  const descJaccard = jaccard(aWords, bWords);
  const descScore = descJaccard * 0.3;
  score += descScore;
  if (descScore > 0.01) {
    evidence.push({
      type: 'DESCRIPTION_SIMILARITY',
      detail: `${(descJaccard * 100).toFixed(0)}% description token overlap (${matched.slice(0, 8).join(', ') || 'no shared keywords'})`,
      contribution: round(descScore),
    });
  }

  if (a.dateReceived && b.dateReceived) {
    const days = Math.abs(a.dateReceived.getTime() - b.dateReceived.getTime()) / 86_400_000;
    if (days <= 30) {
      const dateScore = 0.05 * (1 - days / 30);
      score += dateScore;
      evidence.push({
        type: 'DATE_PROXIMITY',
        detail: `Received ${Math.round(days)} day(s) apart`,
        contribution: round(dateScore),
      });
    }
  }

  if (knownDifferentInstitution) {
    score = Math.min(score, 0.25);
    evidence.push({
      type: 'DIFFERENT_INSTITUTION',
      detail: 'Complaints concern different verified institutions; capped to avoid a false duplicate suggestion',
      contribution: 0,
    });
  }

  score = round(Math.min(1, score));
  const isPotentialDuplicate = score >= SIMILARITY_THRESHOLDS.duplicate && !knownDifferentInstitution;

  return {
    score,
    matchingKeywords: matched.slice(0, 15),
    evidence,
    categoryMatch,
    sameInstitution,
    reasoning: isPotentialDuplicate
      ? 'Shared institution/category and text evidence suggest review for possible duplication. This is a suggestion, not a definitive duplicate finding.'
      : score >= SIMILARITY_THRESHOLDS.suggest
        ? 'Some similarity was detected, but the evidence is weak. Review only if operationally relevant.'
        : 'Insufficient similarity for a duplicate suggestion.',
    isPotentialDuplicate,
  };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Fallback provider abstraction so a future AI text provider can be added. */
export interface ComplaintSimilarityProvider {
  name: string;
  compare(a: ComplaintLike, b: ComplaintLike): Promise<ComplaintSimilarityResult> | ComplaintSimilarityResult;
}

export const ruleBasedSimilarityProvider: ComplaintSimilarityProvider = {
  name: 'rule-based-local',
  compare: computeComplaintSimilarity,
};

export const activeSimilarityProvider: ComplaintSimilarityProvider = ruleBasedSimilarityProvider;
