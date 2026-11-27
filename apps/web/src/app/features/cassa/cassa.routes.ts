import type { Routes } from '@angular/router';
import { PlaceholderPage } from '../../shared/ui/placeholder-page';

export const CASSA_ROUTES: Routes = [
  {
    path: '',
    title: 'Cassa',
    component: PlaceholderPage,
    data: {
      heading: 'Cassa',
      description: 'Coda dei giri da approvare, piatti esauriti, pre-conto e chiusura.',
      phase: 'F4 · App capo',
    },
  },
];
