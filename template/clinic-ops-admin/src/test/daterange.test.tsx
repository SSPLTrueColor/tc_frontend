import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DateRangePicker, monthWeeks } from '../components/primitives/DateRangePicker';

describe('DateRangePicker (two months, Sunday-first)', () => {
  it('builds Sunday-first weeks with only the rows the month needs', () => {
    const oct = monthWeeks('2026-10'); // 1 Oct 2026 is a Thursday
    expect(oct[0]).toBe('2026-09-27');
    expect(oct.length).toBe(35);
  });

  it('shows two months with year/month navigation and picks a range', () => {
    const onChange = vi.fn();
    render(<DateRangePicker label="Start" value={{ from: '2026-10-05' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Start:/ }));
    expect(screen.getByRole('grid', { name: 'Oct 2026' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Nov 2026' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next year' }));
    expect(screen.getByRole('grid', { name: 'Oct 2027' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }));
    fireEvent.click(screen.getAllByRole('gridcell', { name: '3 Oct, 2026' })[0]);
    expect(onChange).toHaveBeenCalledWith({ from: '2026-10-03', to: '2026-10-05' });
  });
});
