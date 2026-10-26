import { prisma } from '../../config/prisma';
import {
  normalizeInstitutionName,
  similarityRatio,
  tokenJaccard,
} from '../../utils/normalize';

export interface MatchEvidence {
  type: string;
  detail: string;
  weight: number;
}

export interface InstitutionCandidate {
  institution: {
    id: string;
    aictePermanentId: string;
    name: string;
    city: string | null;
    district: string | null;
    state: string | null;
    pinCode: string | null;
    regionId: string | null;
  };
  score: number;
  requiresReview: boolean;
  autoLink: boolean;
  evidence: MatchEvidence[];
  reasoning: string;
}

export interface MatchQuery {
  name: string;
  aictePermanentId?: string | null;
  pinCode?: string | null;
  district?: string | null;
  state?: string | null;
  city?: string | null;
}

type InstitutionForScoring = {
  id: string;
  aictePermanentId: string;
  name: string;
  normalizedName?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  pinCode?: string | null;
  regionId?: string | null;
};

export const MATCH_THRESHOLDS = {
  /** Minimum score to display as candidate */
  candidate: Number(process.env.MATCH_CANDIDATE_THRESHOLD || 0.45),
  /** Score above which human review is required (unless exact ID) */
  review: Number(process.env.MATCH_REVIEW_THRESHOLD || 0.6),
  /** Score above which a record may be automatically linked if ID is exact */
  autoLink: Number(process.env.MATCH_AUTOLINK_THRESHOLD || 0.9),
};

/**
 * Deterministic, explainable institution matcher.
 *
 * Scoring summary:
 * - Exact AICTE Permanent ID: score 1.0, auto-link.
 * - Exact normalized name: 0.60 base + corroboration (PIN/state/district) up to 0.20.
 * - Exact alias: 0.58 base + corroboration.
 * - Fuzzy name: 0.45 * token Jaccard + 0.25 * edit-distance ratio + corroboration.
 * A name match alone never auto-links; uncertain matches require an authorized decision.
 */
export function scoreInstitution(
  query: MatchQuery,
  institution: InstitutionForScoring,
  aliases: string[] = [],
): InstitutionCandidate {
  const inst: any = institution;
  const evidence: MatchEvidence[] = [];
  const queryId = query.aictePermanentId?.trim().toLowerCase();
  const dbId = institution.aictePermanentId.trim().toLowerCase();

  if (queryId && queryId === dbId) {
    evidence.push({
      type: 'AICTE_PERMANENT_ID',
      detail: `Exact AICTE Permanent ID match (${institution.aictePermanentId})`,
      weight: 1,
    });
    return {
      institution: institution as any,
      score: 1,
      requiresReview: false,
      autoLink: true,
      evidence,
      reasoning: 'Exact AICTE Permanent ID match provides conclusive identity evidence.',
    };
  }

  const normalizedQuery = normalizeInstitutionName(query.name);
  const normalizedDb = ((inst.normalizedName as string | undefined) || normalizeInstitutionName(institution.name)) as string;
  let score = 0;

  if (normalizedQuery && normalizedQuery === normalizedDb) {
    score += 0.6;
    evidence.push({
      type: 'NAME_EXACT',
      detail: `Normalized name exactly matches "${institution.name}"`,
      weight: 0.6,
    });
  } else {
    const aliasMatch = aliases.find((alias) => normalizeInstitutionName(alias) === normalizedQuery);
    if (aliasMatch) {
      score += 0.58;
      evidence.push({
        type: 'ALIAS_EXACT',
        detail: `Matches known alias "${aliasMatch}"`,
        weight: 0.58,
      });
    } else {
      const jaccard = tokenJaccard(query.name, institution.name);
      const ratio = similarityRatio(normalizedQuery, normalizedDb);
      const nameScore = jaccard * 0.45 + ratio * 0.25;
      if (nameScore > 0) {
        score += nameScore;
        evidence.push({
          type: 'NAME_FUZZY',
          detail: `Fuzzy name similarity: token overlap ${(jaccard * 100).toFixed(0)}%, edit similarity ${(ratio * 100).toFixed(0)}%`,
          weight: Math.round(nameScore * 1000) / 1000,
        });
      }
    }
  }

  // Corroborating location evidence (weighted, capped).
  let locationBonus = 0;
  if (query.pinCode && institution.pinCode && query.pinCode.trim() === institution.pinCode.trim()) {
    locationBonus += 0.1;
    evidence.push({ type: 'PIN_CODE', detail: `PIN code matches (${query.pinCode})`, weight: 0.1 });
  }
  if (query.district && institution.district &&
      query.district.trim().toLowerCase() === institution.district.trim().toLowerCase()) {
    locationBonus += 0.05;
    evidence.push({ type: 'DISTRICT', detail: `District matches (${institution.district})`, weight: 0.05 });
  }
  if (query.state && institution.state &&
      query.state.trim().toLowerCase() === institution.state.trim().toLowerCase()) {
    locationBonus += 0.05;
    evidence.push({ type: 'STATE', detail: `State matches (${institution.state})`, weight: 0.05 });
  }
  score += Math.min(locationBonus, 0.2);

  // Conflicting official identifier is strong negative evidence.
  if (queryId && queryId !== dbId) {
    score = Math.max(0, score - 0.35);
    evidence.push({
      type: 'CONFLICTING_ID',
      detail: `Supplied AICTE ID (${query.aictePermanentId}) differs from this record (${institution.aictePermanentId})`,
      weight: -0.35,
    });
  }

  score = Math.max(0, Math.min(0.99, score));
  const exactName = evidence.some((e) => e.type === 'NAME_EXACT' || e.type === 'ALIAS_EXACT');
  const corroborated = locationBonus > 0;
  const requiresReview = score >= MATCH_THRESHOLDS.review || exactName;
  const autoLink = false; // Identity without a verified permanent ID always requires review.

  let reasoning: string;
  if (score < MATCH_THRESHOLDS.candidate) {
    reasoning = 'Insufficient similarity evidence to suggest a match.';
  } else if (exactName && !corroborated) {
    reasoning = 'Name matches but no identifier or location corroboration; authorized review required.';
  } else if (requiresReview) {
    reasoning = 'Similar identity evidence found; authorized review required before linking.';
  } else {
    reasoning = 'Weak identity evidence; not recommended for linking.';
  }

  return { institution: institution as any, score: Math.round(score * 100) / 100, requiresReview, autoLink, evidence, reasoning };
}

export async function findInstitutionCandidates(query: MatchQuery, limit = 10): Promise<InstitutionCandidate[]> {
  if (!query.name?.trim() && !query.aictePermanentId?.trim()) return [];

  const tokens = normalizeInstitutionName(query.name)
    .split(' ')
    .filter((t) => t.length > 2)
    .slice(0, 4);

  const institutions = await prisma.institution.findMany({
    where: query.aictePermanentId
      ? {
          OR: [
            { aictePermanentId: { equals: query.aictePermanentId.trim() } },
            ...(tokens.length
              ? tokens.map((token) => ({ normalizedName: { contains: token } }))
              : []),
          ],
        }
      : {
          OR: tokens.length
            ? tokens.map((token) => ({ normalizedName: { contains: token } }))
            : [{ isActive: true }],
        },
    include: { aliases: true },
    take: 100,
  });

  const scored = institutions.map((inst) =>
    scoreInstitution(query, inst as InstitutionForScoring, inst.aliases.map((a: any) => a.alias)),
  );

  return scored
    .filter((candidate) => candidate.score >= MATCH_THRESHOLDS.candidate)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function findBestInstitutionMatch(query: MatchQuery): Promise<InstitutionCandidate | null> {
  const candidates = await findInstitutionCandidates(query, 1);
  return candidates[0] ?? null;
}
