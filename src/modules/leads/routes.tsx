import { Navigate } from 'react-router-dom';
import type { AppRoute } from '../types';
import { FollowUpsPage } from './FollowUpsPage';
import { ImportLeadsPage } from './ImportLeadsPage';
import { NewLeadPage } from './NewLeadPage';

/** leads module pages that are not plain resource lists (resource lists are routed automatically). */
export const routes: AppRoute[] = [
  { path: '/leads/new', element: <NewLeadPage /> },
  { path: '/leads/import', element: <ImportLeadsPage /> },
  { path: '/follow-ups', element: <FollowUpsPage /> },
  // Documented admin URLs (REQUIREMENTS §3) → the rule lists (resource routes).
  { path: '/admin/assignment-rules', element: <Navigate to="/assignmentRules" replace /> },
  { path: '/admin/lead-scoring', element: <Navigate to="/leadScoringRules" replace /> },
];
