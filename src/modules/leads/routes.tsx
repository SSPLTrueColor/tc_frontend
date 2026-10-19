import type { AppRoute } from '../types';
import { ROUTES } from '../../constants/routes';
import { FollowUpsPage } from './FollowUpsPage';
import { ImportLeadsPage } from './ImportLeadsPage';
import { NewLeadPage } from './NewLeadPage';
import { NotAttendedLeadsPage } from './NotAttendedLeadsPage';

/**
 * Lead Management (BRD 4.2) pages that are not plain resource lists (resource lists are routed automatically).
 * Lead Assignment Rules / Lead Scoring Rules are resource lists whose slugs equal ROUTES.leadAssignmentRules and
 * ROUTES.leadScoringRules, so the admin resource route serves them; old URLs redirect via LEGACY_REDIRECTS.
 */
export const routes: AppRoute[] = [
  { path: ROUTES.leadNew, element: <NewLeadPage /> },
  { path: ROUTES.importLeads, element: <ImportLeadsPage /> },
  { path: ROUTES.followUps, element: <FollowUpsPage /> },
  { path: ROUTES.notAttendedLeads, element: <NotAttendedLeadsPage /> },
];
