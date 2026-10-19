import { Navigate } from 'react-router-dom';
import type { AppRoute } from '../types';
import { DispatchBoardPage } from './pages/DispatchBoardPage';
import { JobCardPage } from './pages/JobCardPage';
import { MyJobPage } from './pages/MyJobPage';
import { MyJobsPage } from './pages/MyJobsPage';
import { PmSchedulePage } from './pages/PmSchedulePage';
import { FeedbackPage, PortalPage } from './pages/PublicPages';
import './service.css';

/** Service module pages (resource lists /tickets, /pmVisits, /serviceVisits, /knowledgeArticles are automatic). */
export const routes: AppRoute[] = [
  { path: '/dispatch-board', element: <DispatchBoardPage /> },
  { path: '/my-jobs', element: <MyJobsPage /> },
  { path: '/my-jobs/:recordId', element: <MyJobPage /> },
  { path: '/pm-schedule', element: <PmSchedulePage /> },
  { path: '/tickets/:recordId/job-card', element: <JobCardPage /> },
  { path: '/knowledge-base', element: <Navigate to="/knowledgeArticles" replace /> },
  { path: '/feedback/:token', element: <FeedbackPage />, public: true },
  { path: '/portal/new-ticket', element: <PortalPage />, public: true },
];
