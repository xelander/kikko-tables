import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { GiroDto, MenuDto, SedutaClienteDto, VoceCarrelloDto } from '@kikko/shared';
import { firstValueFrom } from 'rxjs';

/**
 * How the ordering screen talks to the server. Customers use their device cookie (default);
 * a waiter ordering for a table uses the staff endpoints of that session (see SalaApiStaff).
 */
@Injectable({ providedIn: 'root', useFactory: () => new SalaApiCliente(inject(HttpClient)) })
export abstract class SalaApi {
  abstract readonly modo: 'cliente' | 'staff';
  abstract menu(): Promise<MenuDto>;
  abstract seduta(): Promise<SedutaClienteDto>;
  abstract impostaVoce(piattoId: string, quantita: number): Promise<VoceCarrelloDto[]>;
  abstract inviaGiro(chiaveIdempotenza: string): Promise<GiroDto>;
}

export class SalaApiCliente extends SalaApi {
  readonly modo = 'cliente';

  constructor(protected readonly http: HttpClient) {
    super();
  }

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

/** A waiter ordering on behalf of a table (same cart, same rules, recorded as the waiter). */
export class SalaApiStaff extends SalaApi {
  readonly modo = 'staff';

  constructor(
    private readonly http: HttpClient,
    private readonly sedutaId: string,
  ) {
    super();
  }

  menu(): Promise<MenuDto> {
    return firstValueFrom(this.http.get<MenuDto>('/api/menu'));
  }

  seduta(): Promise<SedutaClienteDto> {
    return firstValueFrom(this.http.get<SedutaClienteDto>(`/api/sedute/${this.sedutaId}/sala`));
  }

  impostaVoce(piattoId: string, quantita: number): Promise<VoceCarrelloDto[]> {
    return firstValueFrom(
      this.http.put<VoceCarrelloDto[]>(`/api/sedute/${this.sedutaId}/carrello/${piattoId}`, { quantita }),
    );
  }

  inviaGiro(chiaveIdempotenza: string): Promise<GiroDto> {
    return firstValueFrom(this.http.post<GiroDto>(`/api/sedute/${this.sedutaId}/giri`, { chiaveIdempotenza }));
  }
}
