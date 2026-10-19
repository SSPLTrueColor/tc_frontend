import { Navigate } from 'react-router-dom';
import type { AppRoute } from '../types';
import { ContractPrintPage } from './ContractPrintPage';
import { EditOrderPage } from './EditOrderPage';
import { NewOrderPage } from './NewOrderPage';
import { PaymentsDuePage } from './PaymentsDuePage';
import './orders.css';

/** Orders pages beyond the generic resource lists (/salesOrders, /paymentMilestones, /dispatches, /salesContracts). */
export const routes: AppRoute[] = [
  { path: '/orders', element: <Navigate to="/salesOrders" replace /> },
  { path: '/orders/new', element: <NewOrderPage /> },
  { path: '/salesOrders/new', element: <NewOrderPage /> },
  { path: '/orders/payments', element: <PaymentsDuePage /> },
  { path: '/orders/:id/edit', element: <EditOrderPage /> },
  { path: '/salesOrders/:recordId/edit', element: <EditOrderPage /> },
  { path: '/orders/:id/contract/print', element: <ContractPrintPage /> },
];
