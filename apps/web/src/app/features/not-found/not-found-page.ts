import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PlaceholderPage } from '../../shared/ui/placeholder-page';

@Component({
  selector: 'app-not-found-page',
  imports: [PlaceholderPage],
  template: ` <app-placeholder-page heading="Pagina non trovata" description="L'indirizzo non esiste." phase="404" /> `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundPage {}
