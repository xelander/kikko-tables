import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PlaceholderPage } from '../../shared/ui/placeholder-page';

/** Customer entry point reached from the table QR code (`/t/:slug`). Built in F2. */
@Component({
  selector: 'app-tavolo-page',
  imports: [PlaceholderPage],
  template: `
    <app-placeholder-page
      [heading]="'Tavolo ' + slug()"
      description="Qui il cliente inserirà il PIN e vedrà il menù."
      phase="F2 · App cliente"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TavoloPage {
  /** Bound from the route parameter `:slug`. */
  readonly slug = input.required<string>();
}
