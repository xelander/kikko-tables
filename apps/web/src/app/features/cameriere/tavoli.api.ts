import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  ApriTavoloRichiesta,
  CopertiRichiesta,
  FormuleDisponibili,
  MenuDto,
  SedutaConPin,
  SedutaDettaglioDto,
  SedutaRiepilogo,
  TavoloStato,
} from '@kikko/shared';
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

  dettaglio(sedutaId: string): Promise<SedutaDettaglioDto> {
    return firstValueFrom(this.http.get<SedutaDettaglioDto>(`/api/sedute/${sedutaId}`));
  }

  menu(): Promise<MenuDto> {
    return firstValueFrom(this.http.get<MenuDto>('/api/menu'));
  }

  coperti(sedutaId: string, coperti: CopertiRichiesta): Promise<SedutaRiepilogo> {
    return firstValueFrom(this.http.patch<SedutaRiepilogo>(`/api/sedute/${sedutaId}/coperti`, coperti));
  }

  sposta(sedutaId: string, daTavoloId: string, aTavoloId: string): Promise<SedutaRiepilogo> {
    return firstValueFrom(this.http.post<SedutaRiepilogo>(`/api/sedute/${sedutaId}/sposta`, { daTavoloId, aTavoloId }));
  }

  aggiungiTavolo(sedutaId: string, tavoloId: string): Promise<SedutaRiepilogo> {
    return firstValueFrom(this.http.post<SedutaRiepilogo>(`/api/sedute/${sedutaId}/tavoli`, { tavoloId }));
  }

  unisci(sedutaId: string, altraSedutaId: string): Promise<SedutaRiepilogo> {
    return firstValueFrom(
      this.http.post<SedutaRiepilogo>(`/api/sedute/${sedutaId}/unisci`, { sedutaId: altraSedutaId }),
    );
  }

  rigeneraPin(sedutaId: string): Promise<SedutaConPin> {
    return firstValueFrom(this.http.post<SedutaConPin>(`/api/sedute/${sedutaId}/pin`, {}));
  }

  chiudi(sedutaId: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`/api/sedute/${sedutaId}/chiudi`, {}));
  }
}
