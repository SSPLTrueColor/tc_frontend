/** Field Force merged pages render on the demo seed: the Field Visits list mode embeds the generic list. */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { L } from '../constants/labels';
import { ROUTES } from '../constants/routes';
import { createDb, __setDb, getDb } from '../services/db';
import { routes } from '../modules/field/routes';
import '../domain/extensions/index';

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div id="topbar-title" />
      <Routes>
        {routes.map((r) => (
          <Route key={r.path} path={r.path} element={r.element} />
        ))}
      </Routes>
    </MemoryRouter>,
  );

describe('field force pages', () => {
  beforeAll(() => {
    __setDb(createDb());
    getDb().demo.latencyMin = 0;
    getDb().demo.latencyMax = 0;
    getDb().demo.failureRate = 0;
  });

  it('Field Visits list mode shows the generic list for fieldVisits', async () => {
    at(`${ROUTES.fieldVisits}?mode=list`);
    expect(await screen.findByRole('radio', { name: L.field.pages.fieldVisits.modes.list })).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByLabelText(`Search ${L.field.records.fieldVisits.many.toLowerCase()}`)).toBeInTheDocument();
  });

  it('Beat Plan list mode shows the generic list for beatPlans', async () => {
    at(`${ROUTES.beatPlan}?mode=list`);
    expect(await screen.findByLabelText(`Search ${L.field.records.beatPlans.many.toLowerCase()}`)).toBeInTheDocument();
  });

  it('Route Map landing lists people for a manager', async () => {
    at(ROUTES.routeMap);
    expect(await screen.findAllByText(L.field.actions.viewRoute)).not.toHaveLength(0);
  });
});
