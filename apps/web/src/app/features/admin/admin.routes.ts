import type { Routes } from '@angular/router';
import { PlaceholderPage } from '../../shared/ui/placeholder-page';

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    title: 'Amministratore',
    component: PlaceholderPage,
    data: {
      heading: 'Amministratore',
      description: 'Formule, menù, tavoli, utenti, report e import Deliveroo.',
      phase: 'F5 · Amministratore',
    },
  },
];
