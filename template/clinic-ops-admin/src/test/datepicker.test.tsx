import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DatePicker } from '../components/primitives/DatePicker';

describe('DatePicker (custom, replaces native date inputs)', () => {
  it('shows the project date format and picks a day from the calendar', () => {
    const onChange = vi.fn();
    render(<DatePicker label="Due date" value="2026-07-23" onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: /Due date: 23 Jul, 2026/ });
    fireEvent.click(trigger);
    expect(screen.getByRole('grid', { name: 'July 2026' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('gridcell', { name: '25 Jul, 2026' }));
    expect(onChange).toHaveBeenCalledWith('2026-07-25');
  });

  it('supports keyboard navigation and keeps the time for date-time values', () => {
    const onChange = vi.fn();
    render(<DatePicker label="Start" withTime value="2026-07-23T14:30" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Start: 23 Jul, 2026 02:30 PM/ }));
    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('2026-07-24T14:30');
  });
});
