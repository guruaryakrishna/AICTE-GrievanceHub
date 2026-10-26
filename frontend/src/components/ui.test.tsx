import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Badge,
  Pagination,
  PriorityBadge,
  SlaBadge,
  StatusBadge,
  statusTone,
} from './ui';
import type { SlaSnapshot } from '../services/types';

function sla(overrides: Partial<SlaSnapshot> = {}): SlaSnapshot {
  return {
    dueAt: '2026-10-30T10:00:00.000Z',
    state: 'ON_TRACK',
    isOverdue: false,
    isApproaching: false,
    hoursRemaining: 120,
    warningThresholdHours: 72,
    escalationThresholdHours: 24,
    ruleId: 'rule-1',
    ruleName: 'Standard',
    ...overrides,
  };
}

describe('UI primitives', () => {
  it('renders status and priority badges with readable labels', () => {
    render(
      <>
        <StatusBadge status="UNDER_REVIEW" />
        <PriorityBadge priority="URGENT" />
      </>,
    );
    expect(screen.getByText('Under Review')).toBeInTheDocument();
    expect(screen.getByText('Urgent')).toBeInTheDocument();
  });

  it('maps terminal and coordination statuses to distinct tones', () => {
    expect(statusTone('DISPOSED')).toBe('emerald');
    expect(statusTone('RESOLVED')).toBe('emerald');
    expect(statusTone('COORDINATION_REQUIRED')).toBe('teal');
    expect(statusTone('ESCALATED')).toBe('red');
  });

  it('shows an explicit state when no SLA deadline exists', () => {
    render(<SlaBadge sla={sla({ state: 'NONE', hoursRemaining: null })} />);
    expect(screen.getByText('No deadline')).toBeInTheDocument();
  });

  it('describes overdue and approaching deadlines', () => {
    const { rerender } = render(<SlaBadge sla={sla({ state: 'OVERDUE', isOverdue: true, hoursRemaining: -20 })} />);
    expect(screen.getByText('Overdue 20h')).toBeInTheDocument();
    rerender(<SlaBadge sla={sla({ state: 'APPROACHING', isApproaching: true, hoursRemaining: 18 })} />);
    expect(screen.getByText('Due 18h')).toBeInTheDocument();
  });

  it('renders children inside a badge', () => {
    render(<Badge tone="teal">Coordination</Badge>);
    expect(screen.getByText('Coordination')).toBeInTheDocument();
  });

  it('paginates forward and backward with correct bounds', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pagination
        page={2}
        pageSize={20}
        total={55}
        onPageChange={onPageChange}
      />,
    );

    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 21–40 of 55');
    expect(screen.getByText('2 / 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('disables pagination at the edges', () => {
    render(<Pagination page={1} pageSize={20} total={10} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});
