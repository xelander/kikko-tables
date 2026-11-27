import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import type { Allergene, CategoriaMenuDto, PiattoMenuDto } from '@kikko/shared';
import { ALLERGENI } from '@kikko/shared/browser';
import { I18nService, LINGUE, type Lingua } from '../../../core/i18n/i18n.service';
import { ConnessioneBanner } from '../../../core/realtime/connessione-banner';
import { archivio } from '../../../core/storage';
import { SchedaPiatto } from './scheda-piatto';
import { SalaStore } from './sala.store';
import { Stepper } from './stepper';
import { TESTI_SALA, conto, messaggioRegola, nomeAllergene, prezzo } from './testi-sala';

interface Filtri {
  esclusi: Allergene[];
  soloVegetariani: boolean;
  soloSenzaGlutine: boolean;
}

const FILTRI_VUOTI: Filtri = { esclusi: [], soloVegetariani: false, soloSenzaGlutine: false };
const CHIAVE_FILTRI = 'kk_filtri';

function filtriSalvati(): Filtri {
  try {
    const f = JSON.parse(archivio.leggi(CHIAVE_FILTRI) ?? 'null') as Filtri | null;
    return f && Array.isArray(f.esclusi) ? f : FILTRI_VUOTI;
  } catch {
    return FILTRI_VUOTI;
  }
}

/** Customer ordering screen: menu, drinks, filters, dish details, shared cart and rounds. */
@Component({
  selector: 'app-sala-cliente',
  imports: [ConnessioneBanner, SchedaPiatto, Stepper],
  providers: [SalaStore],
  templateUrl: './sala-cliente.html',
  styleUrl: './sala-cliente.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SalaCliente {
  protected readonly store = inject(SalaStore);
  protected readonly i18n = inject(I18nService);

  protected readonly lingua = this.i18n.lingua;
  protected readonly testiSala = computed(() => TESTI_SALA[this.lingua()]);
  protected readonly lingue = LINGUE;
  protected readonly allergeni = ALLERGENI;

  protected readonly sezione = signal<'MENU' | 'BEVANDE'>('MENU');
  protected readonly filtri = signal<Filtri>(filtriSalvati());
  protected readonly dettaglio = signal<PiattoMenuDto | null>(null);

  private readonly dialogoFiltri = viewChild<ElementRef<HTMLDialogElement>>('dialogoFiltri');
  private readonly dialogoDettaglio = viewChild<ElementRef<HTMLDialogElement>>('dialogoDettaglio');
  private readonly dialogoCarrello = viewChild<ElementRef<HTMLDialogElement>>('dialogoCarrello');

  protected readonly numeroFiltri = computed(() => {
    const f = this.filtri();
    return f.esclusi.length + (f.soloVegetariani ? 1 : 0) + (f.soloSenzaGlutine ? 1 : 0);
  });

  /** Categories of the current section with their visible dishes. */
  protected readonly sezioni = computed(() => {
    const menu = this.store.menu();
    if (!menu) return [];
    const f = this.filtri();
    const esclusi = new Set(f.esclusi);
    const visibile = (p: PiattoMenuDto) =>
      !p.allergeni.some((a) => esclusi.has(a)) &&
      (!f.soloVegetariani || p.vegetariano) &&
      (!f.soloSenzaGlutine || p.senzaGlutine);
    return menu.categorie
      .filter((c) => c.sezione === this.sezione())
      .map((c) => ({ categoria: c, piatti: menu.piatti.filter((p) => p.categoriaId === c.id && visibile(p)) }))
      .filter((s) => s.piatti.length > 0);
  });

  /** Cart lines grouped by dish, with who added what. */
  protected readonly righeCarrello = computed(() => {
    const perPiatto = new Map<string, { piatto: PiattoMenuDto; totale: number; chi: string[] }>();
    const emoji = new Map((this.store.seduta()?.dispositivi ?? []).map((d) => [d.id, d.emoji]));
    for (const r of this.store.carrello()) {
      const piatto = this.store.piatto(r.piattoId);
      if (!piatto) continue;
      const riga = perPiatto.get(r.piattoId) ?? { piatto, totale: 0, chi: [] };
      riga.totale += r.quantita;
      riga.chi.push(`${emoji.get(r.dispositivoId) ?? '🙂'} ${r.quantita}`);
      perPiatto.set(r.piattoId, riga);
    }
    return [...perPiatto.values()];
  });

  protected readonly messaggiErrore = computed(() => {
    const lingua = this.lingua();
    const nome = (id: string) => this.store.piatto(id)?.nome[lingua] ?? '?';
    const gruppo = (id: string) => this.store.menu()?.gruppi.find((g) => g.id === id)?.nome[lingua] ?? '?';
    return this.store.erroriGiro().map((e) => messaggioRegola(e, lingua, nome, gruppo, Date.now()));
  });

  protected readonly conto = conto;
  protected readonly Math = Math;
  protected readonly nomeAllergene = nomeAllergene;

  constructor() {
    void this.store.carica();
  }

  protected scegliLingua(l: Lingua): void {
    this.i18n.imposta(l);
  }

  protected nomeCategoria(c: CategoriaMenuDto): string {
    return c.nome[this.lingua()];
  }

  protected vaiA(categoriaId: string): void {
    document.getElementById(`cat-${categoriaId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** "🦊 2 · 🐼 1" for the other phones that have this dish in the cart. */
  protected altri(piattoId: string): string {
    const io = this.store.io()?.id;
    const emoji = new Map((this.store.seduta()?.dispositivi ?? []).map((d) => [d.id, d.emoji]));
    return this.store
      .carrello()
      .filter((r) => r.piattoId === piattoId && r.dispositivoId !== io)
      .map((r) => `${emoji.get(r.dispositivoId) ?? '🙂'} ${r.quantita}`)
      .join(' · ');
  }

  protected prezzo(cent: number): string {
    return prezzo(cent, this.lingua());
  }

  protected apriDettaglio(p: PiattoMenuDto): void {
    this.dettaglio.set(p);
    this.dialogoDettaglio()?.nativeElement.showModal();
  }

  protected apriFiltri(): void {
    this.dialogoFiltri()?.nativeElement.showModal();
  }

  protected apriCarrello(): void {
    this.dialogoCarrello()?.nativeElement.showModal();
  }

  protected chiudi(dialogo: HTMLDialogElement): void {
    dialogo.close();
  }

  protected escludi(a: Allergene, attivo: boolean): void {
    this.aggiornaFiltri((f) => ({
      ...f,
      esclusi: attivo ? [...new Set([...f.esclusi, a])] : f.esclusi.filter((x) => x !== a),
    }));
  }

  protected impostaFiltro(chiave: 'soloVegetariani' | 'soloSenzaGlutine', valore: boolean): void {
    this.aggiornaFiltri((f) => ({ ...f, [chiave]: valore }));
  }

  protected azzeraFiltri(): void {
    this.aggiornaFiltri(() => FILTRI_VUOTI);
  }

  protected async invia(): Promise<void> {
    await this.store.inviaGiro();
  }

  private aggiornaFiltri(fn: (f: Filtri) => Filtri): void {
    this.filtri.update(fn);
    archivio.scrivi(CHIAVE_FILTRI, JSON.stringify(this.filtri()));
  }
}
