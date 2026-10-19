import type { AppRoute } from '../types';
import { ROUTES } from '../../constants/routes';
import { ContactImportPage, ContactPoolPage, DuplicatesPage, TransferPage } from './pages';

/** Customers & Contacts pages that are not plain resource lists (resource lists are routed automatically). */
export const routes: AppRoute[] = [
  { path: ROUTES.contactPool, element: <ContactPoolPage /> },
  { path: ROUTES.contactPoolImport, element: <ContactImportPage /> },
  { path: ROUTES.duplicateMerge, element: <DuplicatesPage /> },
  { path: ROUTES.ownershipTransfer, element: <TransferPage /> },
];
