import { Injectable } from '@angular/core';

type Tipo = 'giro' | 'allarme';

/** Notes (Hz) and duration (s) of each sound: a short "ding-dong" for a new round, three beeps for an alarm. */
const MELODIE: Record<Tipo, { note: number[]; durata: number }> = {
  giro: { note: [880, 660], durata: 0.18 },
  allarme: { note: [990, 990, 990], durata: 0.12 },
};

/**
 * Sounds generated with the Web Audio API (no audio files to download or cache).
 * Browsers only allow sound after a tap: `sblocca()` must run inside a user gesture,
 * and again after every reload of the page.
 */
@Injectable({ providedIn: 'root' })
export class Suono {
  private contesto: AudioContext | null = null;

  /** True once a tap has unlocked audio in this page. */
  get pronto(): boolean {
    return this.contesto?.state === 'running';
  }

  sblocca(): void {
    const Ctor = globalThis.AudioContext;
    if (!Ctor) return;
    this.contesto ??= new Ctor();
    void this.contesto.resume().catch(() => undefined);
  }

  suona(tipo: Tipo): void {
    const ctx = this.contesto;
    if (!ctx || ctx.state !== 'running') return;
    const { note, durata } = MELODIE[tipo];
    let t = ctx.currentTime;
    for (const frequenza of note) {
      const osc = ctx.createOscillator();
      const volume = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequenza;
      volume.gain.setValueAtTime(0.0001, t);
      volume.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.0001, t + durata);
      osc.connect(volume).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + durata + 0.02);
      t += durata + 0.06;
    }
  }
}
