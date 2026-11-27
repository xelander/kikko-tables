import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { StaffAuthService } from '../../core/auth/staff-auth.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { SalaApi, SalaApiStaff } from '../cliente/sala/sala.api';
import { SalaCliente } from '../cliente/sala/sala-cliente';

/**
 * A waiter orders on behalf of a table (customers without a phone): the same ordering screen as the
 * customers, talking to the staff endpoints of this session.
 */
@Component({
  selector: 'app-ordina-page',
  imports: [SalaCliente],
  providers: [
    {
      provide: SalaApi,
      useFactory: () => new SalaApiStaff(inject(HttpClient), inject(ActivatedRoute).snapshot.paramMap.get('sedutaId')!),
    },
  ],
  template: `<app-sala-cliente (indietro)="indietro()" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdinaPage {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  constructor() {
    const utente = inject(StaffAuthService).utente();
    if (utente) inject(RealtimeService).avvia({ modo: 'staff', chiave: utente.id });
  }

  protected indietro(): void {
    void this.router.navigate(['/staff/cameriere/sedute', this.route.snapshot.paramMap.get('sedutaId')]);
  }
}
