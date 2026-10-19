import type { AppRoute } from '../types';
import { ROUTES } from '../../constants/routes';
import { EditOrderPage } from './EditOrderPage';
import { NewOrderPage } from './NewOrderPage';
import { OrderProcessingPage } from './OrderProcessingPage';
import { PaymentSchedulePage } from './PaymentSchedulePage';
import { SalesContractPdfPage } from './SalesContractPdfPage';
import './orders.css';

/**
 * Sales Orders & Contracts pages beyond the generic resource screens. The Sales Orders list and records
 * stay the generic resource pages at /sales-orders (one list experience); /payment-schedule is served by
 * the Payment Schedule page (milestone records keep /payment-schedule/:id). Old /orders… URLs redirect
 * centrally (LEGACY_REDIRECTS).
 */
export const routes: AppRoute[] = [
  { path: ROUTES.salesOrderNew, element: <NewOrderPage /> },
  { path: ROUTES.salesOrderEdit, element: <EditOrderPage /> },
  { path: ROUTES.salesContractPdf, element: <SalesContractPdfPage /> },
  { path: ROUTES.paymentSchedule, element: <PaymentSchedulePage /> },
  { path: ROUTES.orderProcessing, element: <OrderProcessingPage /> },
];
