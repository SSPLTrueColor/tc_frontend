import { Navigate, useLocation } from 'react-router-dom';
import type { AppRoute } from '../types';
import { ROUTES, slugOf } from '../../constants/routes';
import { EngineerCalendarPage } from './pages/EngineerCalendarPage';
import { JobCardPage } from './pages/JobCardPage';
import { KnowledgeBasePage } from './pages/KnowledgeBasePage';
import { MyJobPage } from './pages/MyJobPage';
import { MyJobsPage } from './pages/MyJobsPage';
import { PmSchedulePage } from './pages/PmSchedulePage';
import { FeedbackPage, PortalPage } from './pages/PublicPages';
import './service.css';

/** The PM visit and knowledge article lists are served by their pages; records stay at /<slug>/:id. */
function ListRedirect({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}

/**
 * Service Ticket Management pages (BRD 4.8). The Service Tickets list / Log Ticket form and the
 * Site Visits list are the generic resource routes (/service-tickets, /site-visits).
 */
export const routes: AppRoute[] = [
  { path: ROUTES.engineerCalendar, element: <EngineerCalendarPage /> },
  { path: ROUTES.myJobs, element: <MyJobsPage /> },
  { path: ROUTES.myJob, element: <MyJobPage /> },
  { path: ROUTES.pmSchedule, element: <PmSchedulePage /> },
  { path: `/${slugOf('pmVisits')}`, element: <ListRedirect to={ROUTES.pmSchedule} /> },
  { path: ROUTES.knowledgeBase, element: <KnowledgeBasePage /> },
  { path: `/${slugOf('knowledgeArticles')}`, element: <ListRedirect to={ROUTES.knowledgeBase} /> },
  { path: ROUTES.jobCard, element: <JobCardPage /> },
  { path: ROUTES.feedback, element: <FeedbackPage />, public: true },
  { path: ROUTES.portalLogTicket, element: <PortalPage />, public: true },
];
