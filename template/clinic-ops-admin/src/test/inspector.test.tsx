import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordInspector } from '../components/resource/RecordInspector';
import { ToastProvider } from '../components/primitives/feedback';
import { __setDb, createDb, getDb } from '../services/db';
import { getCommentDraft } from '../services/collab';
import { actorFor } from '../services/authz';
import '../domain/clinic/extensions';

beforeEach(() => {
  __setDb(createDb(new Date()));
});

function renderInspector(recordId: string) {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <RecordInspector resKey="patients" recordId={recordId} onClose={() => {}} />
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('Record Inspector — single persistent Quick Comment (UAB §9 / C4.1)', () => {
  it('keeps exactly one composer and the unsent draft across all four tabs', () => {
    const id = getDb().records.patients.find((p) => p.workspaceId === 'riverside')!.id;
    renderInspector(id);
    const composer = () => screen.getAllByLabelText(/Quick comment on/i);
    fireEvent.change(composer()[0], { target: { value: 'Unsent draft text' } });

    for (const name of ['Related', 'Activity', /^Comments/, 'Details', /^Comments/]) {
      fireEvent.click(screen.getByRole('tab', { name }));
      expect(composer()).toHaveLength(1);
      expect(composer()[0]).toHaveValue('Unsent draft text');
    }
    // The Comments tab renders the thread but never a second composer.
    expect(document.querySelectorAll('[data-testid="quick-comment"]')).toHaveLength(1);
  });

  it('autosaves the draft locally and restores it when the record is reopened', () => {
    vi.useFakeTimers();
    const id = getDb().records.patients.find((p) => p.workspaceId === 'riverside')!.id;
    const view = renderInspector(id);
    fireEvent.change(screen.getByLabelText(/Quick comment on/i), { target: { value: 'Persist me' } });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(getCommentDraft(actorFor('u_morgan', 'riverside'), 'patients', id)).toBe('Persist me');
    view.unmount();
    vi.useRealTimers();
    renderInspector(id);
    expect(screen.getByLabelText(/Quick comment on/i)).toHaveValue('Persist me');
  });

  it('shows masked contact data with a lock for a role without sensitive-data access', () => {
    const db = getDb();
    db.session = { userId: 'u_sam', workspaceId: 'riverside' };
    const id = db.records.patients.find((p) => p.workspaceId === 'riverside')!.id;
    renderInspector(id);
    expect(screen.getAllByLabelText('Masked for your role').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Reveal sensitive value')).toBeNull();
  });
});
