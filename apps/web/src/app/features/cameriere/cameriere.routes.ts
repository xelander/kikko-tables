import type { Routes } from '@angular/router';
import { PlaceholderPage } from '../../shared/ui/placeholder-page';

export const CAMERIERE_ROUTES: Routes = [
  {
    path: '',
    title: 'Cameriere',
    component: PlaceholderPage,
    data: {
      heading: 'Cameriere',
      description: 'Mappa dei tavoli, apertura con coperti e formula, PIN del tavolo.',
      phase: 'F3 · App cameriere',
    },
  },
];
