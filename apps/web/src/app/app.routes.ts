import type { Routes } from '@angular/router';

/**
 * Every area is lazy loaded, so a customer scanning the QR code
 * downloads only the customer code (CLAUDE.md §11).
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Kikko',
    loadComponent: () => import('./features/home/home-page').then((m) => m.HomePage),
  },
  {
    path: 't/:slug',
    loadChildren: () => import('./features/cliente/cliente.routes').then((m) => m.CLIENTE_ROUTES),
  },
  {
    path: 'staff/cameriere',
    loadChildren: () => import('./features/cameriere/cameriere.routes').then((m) => m.CAMERIERE_ROUTES),
  },
  {
    path: 'staff/cassa',
    loadChildren: () => import('./features/cassa/cassa.routes').then((m) => m.CASSA_ROUTES),
  },
  {
    path: 'admin',
    loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },
  {
    path: 'monitor',
    loadChildren: () => import('./features/monitor/monitor.routes').then((m) => m.MONITOR_ROUTES),
  },
  {
    path: '**',
    title: 'Pagina non trovata',
    loadComponent: () => import('./features/not-found/not-found-page').then((m) => m.NotFoundPage),
  },
];
