import type { Routes } from '@angular/router';

export const CAMERIERE_ROUTES: Routes = [
  {
    path: '',
    title: 'Tavoli',
    loadComponent: () => import('./tavoli-page').then((m) => m.TavoliPage),
  },
];
