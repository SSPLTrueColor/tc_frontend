import { Navigate } from 'react-router-dom';
import type { AppRoute } from '../types';
import { ExceptionsPage, MyDayPage, RoutePage, TeamAttendancePage } from './AttendancePages';
import { AchievementPage, LeaderboardPage, PayrollExportPage, ScorecardPage } from './PerformancePages';
import { BeatPlanPage, MyVisitsPage } from './VisitPages';
import './field.css';

/** Field & performance pages. Resource lists (/fieldVisits, /expenseClaims, /leaves, /targets …) are routed automatically. */
export const routes: AppRoute[] = [
  { path: '/attendance', element: <MyDayPage /> },
  { path: '/attendance/team', element: <TeamAttendancePage /> },
  { path: '/attendance/exceptions', element: <ExceptionsPage /> },
  { path: '/attendance/:staffId/route', element: <RoutePage /> },
  { path: '/visits', element: <MyVisitsPage /> },
  { path: '/visits/plan', element: <BeatPlanPage /> },
  { path: '/expenses', element: <Navigate to="/expenseClaims" replace /> },
  { path: '/expenseClaims/payroll-export', element: <PayrollExportPage /> },
  { path: '/targets/achievement', element: <AchievementPage /> },
  { path: '/scorecard', element: <ScorecardPage /> },
  { path: '/leaderboard', element: <LeaderboardPage /> },
];
