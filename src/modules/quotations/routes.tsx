import type { AppRoute } from '../types';
import { QuoteComparePage } from './QuoteComparePage';
import { QuoteEditorPage } from './QuoteEditorPage';
import { QuotePrintPage } from './QuotePrintPage';
import './quotations.css';

/** Quotations pages beyond the generic list (/quotations) and record views. */
export const routes: AppRoute[] = [
  { path: '/quotations/new', element: <QuoteEditorPage /> },
  { path: '/quotations/:recordId/edit', element: <QuoteEditorPage /> },
  { path: '/quotations/:recordId/print', element: <QuotePrintPage /> },
  { path: '/quotations/:recordId/compare', element: <QuoteComparePage /> },
];
