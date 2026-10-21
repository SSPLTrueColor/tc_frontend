/** ClickUp-style filter panel (NotionFilters FilterButton): rows apply instantly, count on the button, no default highlight. */
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FilterGroup } from '../metadata/types';
import { L } from '../constants/labels';
import { actorFor } from '../services/authz';
import { createDb, __setDb } from '../services/db';
import { activeMasterValues, getResource } from '../services/registry';
import { newGroup } from '../services/filter';
import { FilterBar, FilterButton } from '../components/resource/NotionFilters';
import '../domain/extensions/index';

const LS = L.common.list;

function Harness({ onApply }: { onApply: (g: FilterGroup) => void }) {
  const [filter, setFilter] = useState<FilterGroup>(newGroup('and'));
  const res = getResource('leads');
  const actor = actorFor('u_rahul', 'tc');
  const change = (g: FilterGroup) => {
    setFilter(g);
    onApply(g);
  };
  return (
    <>
      <FilterBar res={res} actor={actor} filter={filter} onChange={change} />
      <FilterButton res={res} actor={actor} filter={filter} onChange={change} />
    </>
  );
}

const statusLabels = () => activeMasterValues(getResource('leads').fields.find((f) => f.key === 'status')!.master!).map((o) => o.label);

describe('filter panel', () => {
  beforeEach(() => __setDb(createDb()));

  it('opens with one blank "Where" row and its field picker open, nothing highlighted', async () => {
    render(<Harness onApply={() => {}} />);
    const btn = screen.getByRole('button', { name: LS.filters });
    // icon-only funnel; its label is the tooltip
    expect(btn).toHaveClass('filter-btn', 'is-icon-only');
    expect(btn).toHaveAttribute('data-tooltip', LS.filters);
    expect(btn.textContent).toBe('');
    // no pill bar until a filter exists
    expect(screen.queryByRole('region', { name: LS.filterBar })).not.toBeInTheDocument();
    fireEvent.click(btn);
    const panel = await screen.findByRole('dialog', { name: LS.filters });
    expect(within(panel).getByText(LS.where)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: LS.clearAllFilters })).toBeDisabled();
    // field picker opens on its own, search focused, no option highlighted
    const list = await screen.findByRole('listbox', { name: LS.field });
    await waitFor(() => expect(screen.getByRole('textbox', { name: L.common.pickers.searchIn(LS.field) })).toHaveFocus());
    expect(list.querySelectorAll('.is-hi')).toHaveLength(0);
    // keyboard mode highlights the first option only after ArrowDown
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(list.querySelectorAll('.is-hi')).toHaveLength(1);
    expect(list).toHaveClass('is-kbd');
  });

  it('add row → pick field → pick values applies at once; count shows; clear all resets', async () => {
    const applied: FilterGroup[] = [];
    const user = userEvent.setup();
    render(<Harness onApply={(g) => applied.push(g)} />);
    await user.click(screen.getByRole('button', { name: LS.filters }));
    await screen.findByRole('listbox', { name: LS.field });
    await user.type(screen.getByRole('textbox', { name: L.common.pickers.searchIn(LS.field) }), 'Status');
    await user.click(screen.getByRole('option', { name: 'Status' }));
    // an incomplete row (no value yet) is not applied
    expect(applied).toHaveLength(0);

    const [first, second] = statusLabels();
    await user.click(screen.getByRole('button', { name: `Status: ${LS.selectOption}` }));
    const values = await screen.findByRole('listbox', { name: 'Status' });
    expect(values.querySelectorAll('.is-hi')).toHaveLength(0);
    await user.click(within(values).getByRole('option', { name: first }));
    await user.click(within(values).getByRole('option', { name: second }));
    const last = applied[applied.length - 1];
    expect(last.children).toHaveLength(1);
    expect(last.children[0]).toMatchObject({ kind: 'condition', field: 'status', operator: 'in' });
    expect((last.children[0] as { value: string[] }).value).toHaveLength(2);
    const active = screen.getByRole('button', { name: LS.filtersActive(1) });
    expect(active).toHaveTextContent('1');
    expect(active).toHaveAttribute('data-tooltip', LS.filtersActive(1));
    expect(active).toHaveClass('is-active');
    // the applied filter shows as a pill under the toolbar (same filter model)
    const bar = screen.getByRole('region', { name: LS.filterBar });
    expect(bar).toHaveTextContent('Status');
    expect(within(bar).getByRole('button', { name: L.common.views.addFilter })).toBeInTheDocument();
    // chips inside the value control can be removed
    expect(screen.getByRole('button', { name: LS.removeValue(first) })).toBeInTheDocument();

    // "+ Add filter" adds a second row with its field picker open; the join selector appears on row 2
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: LS.addFilterRow }));
    await screen.findByRole('listbox', { name: LS.field });
    expect(screen.getByRole('button', { name: `${LS.match}: ${LS.joinAnd}` })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    // "+ Add filter group" adds a nested group box
    await user.click(screen.getByRole('button', { name: LS.addFilterGroup }));
    expect(await screen.findByRole('group', { name: LS.filterGroupLabel })).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: LS.clearAllFilters }));
    expect(applied[applied.length - 1].children).toHaveLength(0);
    expect(screen.getByRole('button', { name: LS.filters })).not.toHaveClass('is-active');
    expect(screen.queryByRole('region', { name: LS.filterBar })).not.toBeInTheDocument();
  });

  it('closing the panel returns focus to the Filter button', async () => {
    const user = userEvent.setup();
    render(<Harness onApply={() => {}} />);
    const btn = screen.getByRole('button', { name: LS.filters });
    await user.click(btn);
    await screen.findByRole('listbox', { name: LS.field });
    await user.keyboard('{Escape}'); // field picker
    await user.keyboard('{Escape}'); // panel
    await waitFor(() => expect(screen.queryByRole('dialog', { name: LS.filters })).not.toBeInTheDocument());
    await waitFor(() => expect(btn).toHaveFocus());
  });
});
