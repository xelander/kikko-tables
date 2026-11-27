import type { Routes } from '@angular/router';
import { CassaLayout } from './cassa-layout';
import { CassaStore } from './cassa.store';

export const CASSA_ROUTES: Routes = [
  {
    path: '',
    component: CassaLayout,
    providers: [CassaStore],
    children: [
      {
        path: '',
        title: 'Cassa · Giri',
        loadComponent: () => import('./giri-page').then((m) => m.GiriPage),
      },
      {
        path: 'tavoli',
        title: 'Cassa · Tavoli',
        loadComponent: () => import('./tavoli-cassa-page').then((m) => m.TavoliCassaPage),
      },
      {
        path: 'esauriti',
        title: 'Cassa · Esauriti',
        loadComponent: () => import('./esauriti-page').then((m) => m.EsauritiPage),
      },
      {
        path: 'sedute/:sedutaId/preconto',
        title: 'Pre-conto',
        loadComponent: () => import('./preconto-page').then((m) => m.PrecontoPage),
      },
    ],
  },
];
