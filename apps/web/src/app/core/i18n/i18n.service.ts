import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';
import { archivio } from '../storage';

export type Lingua = 'it' | 'en';
export const LINGUE: readonly Lingua[] = ['it', 'en'];
const CHIAVE = 'kk_lingua';

/** Chooses Italian for Italian browsers, English for everyone else (CLAUDE.md §10). */
export function linguaDelBrowser(preferenze: readonly string[]): Lingua {
  for (const p of preferenze) {
    const base = p.toLowerCase().slice(0, 2);
    if (base === 'it') return 'it';
    if (base === 'en') return 'en';
  }
  return preferenze.length === 0 ? 'it' : 'en';
}

/** Language of the customer area: remembered choice, otherwise the browser language. */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly document = inject(DOCUMENT);
  readonly lingua = signal<Lingua>(this.iniziale());

  constructor() {
    effect(() => {
      this.document.documentElement.lang = this.lingua();
    });
  }

  imposta(lingua: Lingua): void {
    this.lingua.set(lingua);
    archivio.scrivi(CHIAVE, lingua);
  }

  /** Picks the text for the current language. */
  scegli<T>(testi: Record<Lingua, T>): T {
    return testi[this.lingua()];
  }

  private iniziale(): Lingua {
    const salvata = archivio.leggi(CHIAVE);
    if (salvata === 'it' || salvata === 'en') return salvata;
    const nav = globalThis.navigator;
    return linguaDelBrowser(nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : []);
  }
}
