import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmHost, confirmDelete } from '../components/primitives/overlay';

describe('confirmDelete (shared alert before any delete)', () => {
  it('asks first; Cancel does nothing, Delete runs the action', () => {
    const onConfirm = vi.fn();
    render(<ConfirmHost />);
    act(() => confirmDelete({ title: 'Delete view "Mine"?', message: 'Gone for everyone.', confirmLabel: 'Delete view', onConfirm }));
    expect(screen.getByRole('alertdialog', { name: 'Delete view "Mine"?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    act(() => confirmDelete({ title: 'Delete view "Mine"?', message: 'Gone for everyone.', confirmLabel: 'Delete view', onConfirm }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete view' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
