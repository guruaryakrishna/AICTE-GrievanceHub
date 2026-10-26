import { describe, expect, it } from 'vitest';
import {
  formatHours,
  formatDate,
  getErrorMessage,
  initials,
  percent,
  pluralize,
  roleLabel,
  safeParseJson,
  titleize,
} from './format';

describe('format helpers', () => {
  it('formats dates consistently and tolerates empty values', () => {
    expect(formatDate('2026-10-25T10:00:00.000Z')).toMatch(/2026/);
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });

  it('formats hours in hours and days', () => {
    expect(formatHours(23.6)).toBe('24h');
    expect(formatHours(72)).toBe('3d');
    expect(formatHours(null)).toBe('—');
  });

  it('turns enum-like values into readable labels', () => {
    expect(titleize('UNDER_PROCESS')).toBe('Under Process');
    expect(roleLabel('BUREAU_OFFICER')).toBe('Bureau / Cell Officer');
    expect(roleLabel('READ_ONLY')).toBe('Read-only Viewer');
    expect(initials('Asha', 'Rao')).toBe('AR');
    expect(initials()).toBe('?');
  });

  it('formats percentages and plural nouns', () => {
    expect(percent(72.4)).toBe('72%');
    expect(percent(null)).toBe('—');
    expect(pluralize(1, 'case')).toBe('1 case');
    expect(pluralize(3, 'case')).toBe('3 cases');
  });

  it('parses JSON defensively', () => {
    expect(safeParseJson('{"a":1}')).toEqual({ a: 1 });
    expect(safeParseJson('not json')).toBe('not json');
    expect(safeParseJson({ a: 1 })).toEqual({ a: 1 });
  });

  it('returns readable messages for unknown errors', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
    expect(getErrorMessage(undefined)).toBe('Something went wrong');
  });
});
