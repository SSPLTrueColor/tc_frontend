import { ROUTES } from '../../constants/routes';
import type { AppRoute } from '../types';
import { AttendancePage, ExceptionDashboardPage, RouteMapPage, TeamAttendancePage } from './AttendancePages';
import { ActivityScorecardPage, LeaderboardsPage, PayrollExportPage, TargetVsActualPage } from './PerformancePages';
import { BeatPlanPage, FieldVisitsPage } from './VisitPages';
import './field.css';

/**
 * Field Force (4.11) and Targets & Recognition (4.12) pages. Attendance, Field Visits and Beat Plan
 * serve their resource's list URL; other lists (Attendance Regularisation, Expense Claims, Leave
 * Applications, Targets) and every record page (/<slug>/:id) use the generic resource routes.
 * Old paths redirect through LEGACY_REDIRECTS.
 */
export const routes: AppRoute[] = [
  { path: ROUTES.attendance, element: <AttendancePage /> },
  { path: ROUTES.teamAttendance, element: <TeamAttendancePage /> },
  { path: ROUTES.exceptionDashboard, element: <ExceptionDashboardPage /> },
  { path: ROUTES.routeMap, element: <RouteMapPage /> },
  { path: ROUTES.routeMapFor, element: <RouteMapPage /> },
  { path: ROUTES.fieldVisits, element: <FieldVisitsPage /> },
  { path: ROUTES.beatPlan, element: <BeatPlanPage /> },
  { path: ROUTES.payrollExport, element: <PayrollExportPage /> },
  { path: ROUTES.targetVsActual, element: <TargetVsActualPage /> },
  { path: ROUTES.activityScorecard, element: <ActivityScorecardPage /> },
  { path: ROUTES.leaderboards, element: <LeaderboardsPage /> },
];
