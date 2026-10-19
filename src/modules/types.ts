import type { ReactElement } from 'react';

/**
 * A routed page. Paths are absolute, e.g. "/sales-forecast". Static paths win over the
 * generic "/:resource/:recordId" route. `public: true` renders without the app shell and
 * without sign-in (e.g. the customer feedback link).
 */
export interface AppRoute {
  path: string;
  element: ReactElement;
  public?: true;
}
