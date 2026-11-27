import type { Routes } from '@angular/router';
import { PlaceholderPage } from '../../shared/ui/placeholder-page';

export const MONITOR_ROUTES: Routes = [
  {
    path: '',
    title: 'Monitor',
    component: PlaceholderPage,
    data: {
      heading: 'Monitor',
      description: 'Flusso eventi live, mappa degli stati e allarmi.',
      phase: 'F6 · Monitor',
    },
  },
];
