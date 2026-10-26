import { describe, expect, it } from 'vitest';
import {
  assertManualTransition,
  assertWorkflowTransition,
  isClosedStatus,
  isOpenStatus,
  manualStatusTargets,
  WorkflowPolicyError,
} from '../src/domain/casePolicy';
import {
  buildSlaSnapshot,
  caseDeadline,
  computeSlaDueDate,
  ruleMatches,
  selectSlaRule,
  type SlaRuleLike,
} from '../src/domain/slaPolicy';

const rule = (overrides: Partial<SlaRuleLike> = {}): SlaRuleLike => ({
  id: 'rule-1',
  name: 'Global rule',
  categoryId: null,
  bureauId: null,
  priority: null,
  slaDurationHours: 168,
  warningThresholdHours: 72,
  escalationThresholdHours: 24,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('case lifecycle policy', () => {
  it('allows ordinary review progression only through generic status updates', () => {
    expect(() => assertManualTransition('RECEIVED', 'UNDER_REVIEW')).not.toThrow();
    expect(() => assertManualTransition('UNDER_REVIEW', 'UNDER_PROCESS')).not.toThrow();
    expect(() => assertManualTransition('UNDER_PROCESS', 'UNDER_REVIEW')).not.toThrow();
  });

  it('rejects special operations through the generic status endpoint', () => {
    for (const status of ['TRANSFERRED', 'ESCALATED', 'DISPOSED', 'REOPENED']) {
      expect(() => assertManualTransition('UNDER_REVIEW', status)).toThrow(WorkflowPolicyError);
    }
  });

  it('rejects no-op and invalid generic transitions', () => {
    expect(() => assertManualTransition('RECEIVED', 'RECEIVED')).toThrow(/already/i);
    expect(() => assertManualTransition('RECEIVED', 'UNDER_PROCESS')).toThrow(/Invalid status transition/i);
    expect(() => assertManualTransition('DISPOSED', 'UNDER_REVIEW')).toThrow(/Invalid status transition/i);
  });

  it('validates workflow-specific transitions against the full table', () => {
    expect(() => assertWorkflowTransition('UNDER_REVIEW', 'DISPOSED', 'be disposed')).not.toThrow();
    expect(() => assertWorkflowTransition('DISPOSED', 'REOPENED', 'be reopened')).not.toThrow();
    expect(() => assertWorkflowTransition('DISPOSED', 'DISPOSED', 'be disposed')).toThrow(WorkflowPolicyError);
  });

  it('exposes only ordinary manual targets and correct open/closed classification', () => {
    expect(manualStatusTargets('RECEIVED')).toEqual(['UNDER_REVIEW']);
    expect(manualStatusTargets('DISPOSED')).toEqual([]);
    expect(isOpenStatus('TRANSFERRED')).toBe(true);
    expect(isOpenStatus('DISPOSED')).toBe(false);
    expect(isClosedStatus('DISPOSED')).toBe(true);
  });
});

describe('SLA policy', () => {
  it('selects the most specific matching active rule', () => {
    const global = rule({ id: 'global' });
    const category = rule({ id: 'category', categoryId: 'cat-1', slaDurationHours: 48 });
    const exact = rule({ id: 'exact', categoryId: 'cat-1', priority: 'HIGH', slaDurationHours: 12 });
    const inactive = rule({ id: 'inactive', categoryId: 'cat-1', priority: 'HIGH', isActive: false });

    const selected = selectSlaRule([global, category, exact, inactive], {
      categoryId: 'cat-1',
      priority: 'HIGH',
    });
    expect(selected?.id).toBe('exact');
  });

  it('never applies a rule for a different category, bureau or priority', () => {
    const category = rule({ categoryId: 'cat-1' });
    expect(ruleMatches(category, { categoryId: 'cat-2' })).toBe(false);
    expect(ruleMatches(rule({ bureauId: 'b1' }), { bureauId: 'b2' })).toBe(false);
    expect(ruleMatches(rule({ priority: 'HIGH' }), { priority: 'LOW' })).toBe(false);
    expect(selectSlaRule([category], { categoryId: null })).toBeNull();
  });

  it('computes the deadline from the configured duration', () => {
    const received = new Date('2026-01-01T00:00:00.000Z');
    expect(computeSlaDueDate(received, rule({ slaDurationHours: 24 }))?.toISOString()).toBe(
      '2026-01-02T00:00:00.000Z',
    );
    expect(computeSlaDueDate(received, null)).toBeNull();
  });

  it('uses slaDueDate first and nextActionDueDate as the documented fallback', () => {
    expect(
      caseDeadline({
        status: 'UNDER_REVIEW',
        slaDueDate: '2026-02-01T00:00:00.000Z',
        nextActionDueDate: '2026-03-01T00:00:00.000Z',
      })?.toISOString(),
    ).toBe('2026-02-01T00:00:00.000Z');
    expect(
      caseDeadline({
        status: 'UNDER_REVIEW',
        slaDueDate: null,
        nextActionDueDate: '2026-03-01T00:00:00.000Z',
      })?.toISOString(),
    ).toBe('2026-03-01T00:00:00.000Z');
  });

  it('reports overdue, approaching and on-track states from one policy', () => {
    const now = new Date('2026-01-10T00:00:00.000Z');
    const overdue = buildSlaSnapshot(
      { status: 'UNDER_REVIEW', slaDueDate: '2026-01-09T00:00:00.000Z' },
      [rule()],
      now,
    );
    const approaching = buildSlaSnapshot(
      { status: 'UNDER_REVIEW', slaDueDate: '2026-01-11T00:00:00.000Z' },
      [rule()],
      now,
    );
    const onTrack = buildSlaSnapshot(
      { status: 'UNDER_REVIEW', slaDueDate: '2026-01-20T00:00:00.000Z' },
      [rule()],
      now,
    );
    expect(overdue.isOverdue).toBe(true);
    expect(overdue.state).toBe('OVERDUE');
    expect(approaching.isApproaching).toBe(true);
    expect(approaching.state).toBe('APPROACHING');
    expect(onTrack.state).toBe('ON_TRACK');
  });

  it('never marks a disposed case overdue, even with a past deadline', () => {
    const snapshot = buildSlaSnapshot(
      { status: 'DISPOSED', slaDueDate: '2020-01-01T00:00:00.000Z' },
      [rule()],
      new Date('2026-01-10T00:00:00.000Z'),
    );
    expect(snapshot.state).toBe('NONE');
    expect(snapshot.isOverdue).toBe(false);
    expect(snapshot.isApproaching).toBe(false);
  });

  it('reports NONE when a case has no deadline and falls back to default thresholds', () => {
    const snapshot = buildSlaSnapshot({ status: 'RECEIVED' }, [], new Date('2026-01-10T00:00:00.000Z'));
    expect(snapshot.state).toBe('NONE');
    expect(snapshot.dueAt).toBeNull();
    expect(snapshot.warningThresholdHours).toBe(72);
    expect(snapshot.escalationThresholdHours).toBe(24);
  });
});
