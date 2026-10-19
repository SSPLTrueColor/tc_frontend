import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DateText, EmptyValue } from '../components/primitives/display';
import { TooltipLayer } from '../components/primitives/TooltipLayer';
import { formatDate, formatDateTime, formatWeekdayFull } from '../lib/dates';

describe('date format (owner rule)', () => {
  it('formats dates as "23 Jul 2026" and date-times as "23 Jul 2026 09:07 PM"', () => {
    expect(formatDate('2026-07-23')).toBe('23 Jul, 2026');
    expect(formatDateTime('2026-07-23T21:07')).toBe('23 Jul 2026 09:07 PM');
    expect(formatDateTime('2026-07-23T08:30')).toBe('23 Jul 2026 08:30 AM');
    expect(formatWeekdayFull('2026-07-23')).toBe('Thu, 23 Jul 2026');
  });

  it('DateText shows the date only and the full date-time as its tooltip', () => {
    render(<DateText value="2026-07-23T21:07" />);
    const t = screen.getByText('23 Jul, 2026');
    expect(t).toHaveAttribute('data-tooltip', 'Thu, 23 Jul 2026 09:07 PM');
  });
});

describe('EmptyValue', () => {
  it('renders italic N/A (no icon) with an accessible name', () => {
    const { container } = render(<EmptyValue />);
    expect(screen.getByLabelText('Not available')).toHaveTextContent('N/A');
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('TooltipLayer', () => {
  it('shows a portal tooltip on hover and hides it on Escape', () => {
    vi.useFakeTimers();
    render(
      <>
        <TooltipLayer />
        <button type="button" data-tooltip="View A-1001">
          eye
        </button>
      </>,
    );
    fireEvent.mouseOver(screen.getByText('eye'));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('View A-1001');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    vi.useRealTimers();
  });
});
