import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MultiSelectMenu } from '../components/primitives/MultiSelectMenu';

function Harness() {
  const [v, setV] = useState<string[]>([]);
  return (
    <MultiSelectMenu
      label="Status"
      emptyLabel="All"
      values={v}
      onChange={setV}
      options={[
        { value: 'scheduled', label: 'Scheduled' },
        { value: 'confirmed', label: 'Confirmed' },
        { value: 'completed', label: 'Completed' },
      ]}
    />
  );
}

describe('MultiSelectMenu', () => {
  it('toggles options with checkboxes, stays open, and summarises the selection', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Status: All' }));
    fireEvent.click(screen.getByRole('option', { name: 'Scheduled' }));
    fireEvent.click(screen.getByRole('option', { name: 'Confirmed' }));
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true');
    expect(screen.getByRole('option', { name: 'Scheduled' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Status: Scheduled, Confirmed' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Select all' })).toHaveAttribute('aria-checked', 'mixed');
    fireEvent.click(screen.getByRole('option', { name: 'Select all' }));
    expect(screen.getByRole('option', { name: 'Deselect all' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.getByRole('button', { name: 'Status: All' })).toBeInTheDocument();
  });
});
