import { ROUTES } from '../../constants/routes';
import type { AppRoute } from '../types';
import { DataProtectionPage } from './DataProtectionPage';
import { NotificationPreferencesPage } from './NotificationPreferencesPage';
import { ProfilePage } from './ProfilePage';
import { SecurityPage } from './SecurityPage';

/** Settings pages for every role: My account (profile, notifications, security) and Data Protection. */
export const routes: AppRoute[] = [
  { path: ROUTES.profile, element: <ProfilePage /> },
  { path: ROUTES.notificationPreferences, element: <NotificationPreferencesPage /> },
  { path: ROUTES.security, element: <SecurityPage /> },
  { path: ROUTES.dataProtection, element: <DataProtectionPage /> },
];
