import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { GiroDto, MenuDto, SedutaClienteDto, VoceCarrelloDto } from '@kikko/shared';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SalaApi {
  private readonly http = inject(HttpClient);

  /** The browser revalidates with the ETag: unchanged menus come from the HTTP cache. */
  menu(): Promise<MenuDto> {
    return firstValueFrom(this.http.get<MenuDto>('/api/menu'));
  }

  seduta(): Promise<SedutaClienteDto> {
    return firstValueFrom(this.http.get<SedutaClienteDto>('/api/cliente/seduta'));
  }

  impostaVoce(piattoId: string, quantita: number): Promise<VoceCarrelloDto[]> {
    return firstValueFrom(this.http.put<VoceCarrelloDto[]>(`/api/cliente/carrello/${piattoId}`, { quantita }));
  }

  inviaGiro(chiaveIdempotenza: string): Promise<GiroDto> {
    return firstValueFrom(this.http.post<GiroDto>('/api/cliente/giri', { chiaveIdempotenza }));
  }
}
