import { ROUTES } from '../../constants/routes';
import type { AppRoute } from '../types';
import { CompareVersionsPage } from './CompareVersionsPage';
import { PendingApprovalsPage } from './PendingApprovalsPage';
import { QuotationPdfPage } from './QuotationPdfPage';
import { QuoteEditorPage } from './QuoteEditorPage';
import './quotations.css';

/** Quotations pages beyond the generic list and record views (old /quotations/:id/print redirects centrally). */
export const routes: AppRoute[] = [
  { path: ROUTES.quotationPendingApprovals, element: <PendingApprovalsPage /> },
  { path: ROUTES.quotationNew, element: <QuoteEditorPage /> },
  { path: ROUTES.quotationEdit, element: <QuoteEditorPage /> },
  { path: ROUTES.quotationPdf, element: <QuotationPdfPage /> },
  { path: ROUTES.quotationCompare, element: <CompareVersionsPage /> },
];
