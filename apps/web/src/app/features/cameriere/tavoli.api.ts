import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { ApriTavoloRichiesta, FormuleDisponibili, SedutaConPin, TavoloStato } from '@kikko/shared';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class TavoliApi {
  private readonly http = inject(HttpClient);

  elenco(): Promise<TavoloStato[]> {
    return firstValueFrom(this.http.get<TavoloStato[]>('/api/tavoli'));
  }

  formule(): Promise<FormuleDisponibili> {
    return firstValueFrom(this.http.get<FormuleDisponibili>('/api/formule'));
  }

  apri(tavoloId: string, richiesta: ApriTavoloRichiesta): Promise<SedutaConPin> {
    return firstValueFrom(this.http.post<SedutaConPin>(`/api/tavoli/${tavoloId}/apri`, richiesta));
  }

  rigeneraPin(sedutaId: string): Promise<SedutaConPin> {
    return firstValueFrom(this.http.post<SedutaConPin>(`/api/sedute/${sedutaId}/pin`, {}));
  }

  chiudi(sedutaId: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`/api/sedute/${sedutaId}/chiudi`, {}));
  }
}
