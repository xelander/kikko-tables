import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  CodaCassaDto,
  EstensioneTuttiDto,
  GiroCassaDto,
  PiattoCassaDto,
  PrecontoDto,
  TempoSedutaDto,
} from '@kikko/shared';
import { firstValueFrom } from 'rxjs';

/** Manager / till endpoints (F4). */
@Injectable({ providedIn: 'root' })
export class CassaApi {
  private readonly http = inject(HttpClient);

  coda(): Promise<CodaCassaDto> {
    return firstValueFrom(this.http.get<CodaCassaDto>('/api/cassa/giri'));
  }

  approva(giroId: string): Promise<GiroCassaDto> {
    return firstValueFrom(this.http.post<GiroCassaDto>(`/api/giri/${giroId}/approva`, {}));
  }

  rifiuta(giroId: string, motivo: string): Promise<GiroCassaDto> {
    return firstValueFrom(this.http.post<GiroCassaDto>(`/api/giri/${giroId}/rifiuta`, { motivo }));
  }

  piatti(): Promise<PiattoCassaDto[]> {
    return firstValueFrom(this.http.get<PiattoCassaDto[]>('/api/cassa/piatti'));
  }

  disponibilita(piattoId: string, disponibile: boolean): Promise<PiattoCassaDto> {
    return firstValueFrom(this.http.patch<PiattoCassaDto>(`/api/piatti/${piattoId}/disponibilita`, { disponibile }));
  }

  estendi(sedutaId: string, minuti: number): Promise<TempoSedutaDto> {
    return firstValueFrom(this.http.post<TempoSedutaDto>(`/api/sedute/${sedutaId}/tempo`, { minuti }));
  }

  estendiTutti(minuti: number): Promise<EstensioneTuttiDto> {
    return firstValueFrom(this.http.post<EstensioneTuttiDto>('/api/cassa/estendi-tutti', { minuti }));
  }

  preconto(sedutaId: string): Promise<PrecontoDto> {
    return firstValueFrom(this.http.post<PrecontoDto>(`/api/sedute/${sedutaId}/preconto`, {}));
  }
}
