import type { Routes } from '@angular/router';

export const CAMERIERE_ROUTES: Routes = [
  {
    path: '',
    title: 'Tavoli',
    loadComponent: () => import('./tavoli-page').then((m) => m.TavoliPage),
  },
  {
    path: 'sedute/:sedutaId',
    title: 'Tavolo',
    loadComponent: () => import('./seduta-page').then((m) => m.SedutaPage),
  },
  {
    path: 'sedute/:sedutaId/ordina',
    title: 'Ordina per il tavolo',
    loadComponent: () => import('./ordina-page').then((m) => m.OrdinaPage),
  },
];
