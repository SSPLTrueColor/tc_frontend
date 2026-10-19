import type { AppRoute } from '../types';
import { ContactImportPage, DuplicatesPage, TransferPage } from './pages';

/** Customers module pages that are not plain resource lists (resource lists are routed automatically). */
export const routes: AppRoute[] = [
  { path: '/contacts/import', element: <ContactImportPage /> },
  { path: '/admin/duplicates', element: <DuplicatesPage /> },
  { path: '/admin/transfer', element: <TransferPage /> },
];
