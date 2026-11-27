import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { DispositivoClienteDto, JoinRichiesta, StatoTavoloCliente } from '@kikko/shared';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ClienteApi {
  private readonly http = inject(HttpClient);

  stato(slug: string): Promise<StatoTavoloCliente> {
    return firstValueFrom(this.http.get<StatoTavoloCliente>(`/api/t/${encodeURIComponent(slug)}`));
  }

  unisciti(slug: string, richiesta: JoinRichiesta): Promise<DispositivoClienteDto> {
    return firstValueFrom(this.http.post<DispositivoClienteDto>(`/api/t/${encodeURIComponent(slug)}/join`, richiesta));
  }
}
