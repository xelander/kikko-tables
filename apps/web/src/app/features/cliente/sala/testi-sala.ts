import type { Allergene, ErroreRegola } from '@kikko/shared';
import { ETICHETTE_ALLERGENI } from '@kikko/shared/browser';
import type { Lingua } from '../../../core/i18n/i18n.service';

const minuti = (ms: number) => Math.ceil(ms / 60_000);

/** "04:32" or "1:05:10". */
export function conto(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${String(m).padStart(2, '0')}:${sec}`;
}

export function prezzo(cent: number, lingua: Lingua): string {
  return new Intl.NumberFormat(lingua === 'it' ? 'it-IT' : 'en-GB', { style: 'currency', currency: 'EUR' }).format(
    cent / 100,
  );
}

export function nomeAllergene(a: Allergene, lingua: Lingua): string {
  return ETICHETTE_ALLERGENI[a][lingua];
}

export const TESTI_SALA = {
  it: {
    tavolo: 'Tavolo',
    menu: 'Menù',
    bevande: 'Bevande',
    filtri: 'Filtri',
    filtriAttivi: (n: number) => `Filtri (${n})`,
    escludiAllergeni: 'Escludi i piatti con',
    soloVegetariani: 'Solo vegetariani',
    soloSenzaGlutine: 'Solo senza glutine',
    azzeraFiltri: 'Azzera filtri',
    chiudi: 'Chiudi',
    nessunRisultato: 'Nessun piatto con questi filtri.',
    pezzi: (n: number) => `${n} pz`,
    vegetariano: 'Vegetariano',
    piccante: 'Piccante',
    senzaGlutine: 'Senza glutine',
    allergeni: 'Allergeni',
    nessunAllergene: 'Nessun allergene indicato',
    avvisoAllergeni:
      'Allergeni come indicati dal ristorante. Per allergie o intolleranze chiedi sempre al personale prima di ordinare.',
    massimoPersona: (n: number) => (n === 1 ? 'max 1 a persona' : `max ${n} a persona`),
    massimoGruppo: (n: number, nome: string) => `${nome}: max ${n} a persona in totale`,
    esaurito: 'Esaurito',
    aggiungi: (nome: string) => `Aggiungi ${nome}`,
    togli: (nome: string) => `Togli ${nome}`,
    quantita: (n: number) => `${n} nel tuo ordine`,
    alTavolo: 'al tavolo',
    giro: 'Questo giro',
    carrello: 'Ordine del tavolo',
    apriCarrello: 'Vedi ordine',
    carrelloVuoto: 'Il carrello è vuoto: aggiungi qualcosa dal menù.',
    extra: 'Extra a pagamento',
    totaleExtra: 'Totale extra',
    inviaGiro: 'Invia giro',
    inviaExtra: 'Ordina extra',
    invio: 'Invio…',
    inCoda: 'Sei offline: il giro partirà appena torna la connessione.',
    inviato: 'Giro inviato!',
    prossimoGiro: (c: string) => `Prossimo giro tra ${c}`,
    tempoRimasto: (m: number) => `${m} min rimasti`,
    tempoScaduto: 'Tempo scaduto',
    giriInviati: 'Giri inviati',
    statoGiro: { INVIATO: 'In attesa di conferma', APPROVATO: 'In preparazione', RIFIUTATO: 'Rifiutato' },
    giroN: (n: number) => `Giro ${n}`,
    giroApprovato: (n: number) => `Giro ${n} confermato: arriva in tavola!`,
    giroRifiutato: (n: number) => `Giro ${n} non accettato`,
    chiudiAvviso: 'Chiudi avviso',
    soloExtra: 'solo extra',
    erroreRete: 'Connessione assente. Riprova tra poco.',
    erroreCarrello: 'Modifica non salvata: controlla la connessione.',
    riprova: 'Riprova',
  },
  en: {
    tavolo: 'Table',
    menu: 'Menu',
    bevande: 'Drinks',
    filtri: 'Filters',
    filtriAttivi: (n: number) => `Filters (${n})`,
    escludiAllergeni: 'Hide dishes containing',
    soloVegetariani: 'Vegetarian only',
    soloSenzaGlutine: 'Gluten free only',
    azzeraFiltri: 'Clear filters',
    chiudi: 'Close',
    nessunRisultato: 'No dishes match these filters.',
    pezzi: (n: number) => `${n} pcs`,
    vegetariano: 'Vegetarian',
    piccante: 'Spicy',
    senzaGlutine: 'Gluten free',
    allergeni: 'Allergens',
    nessunAllergene: 'No allergens listed',
    avvisoAllergeni:
      'Allergens as listed by the restaurant. If you have allergies or intolerances, always ask the staff before ordering.',
    massimoPersona: (n: number) => (n === 1 ? 'max 1 per person' : `max ${n} per person`),
    massimoGruppo: (n: number, nome: string) => `${nome}: max ${n} per person in total`,
    esaurito: 'Sold out',
    aggiungi: (nome: string) => `Add ${nome}`,
    togli: (nome: string) => `Remove ${nome}`,
    quantita: (n: number) => `${n} in your order`,
    alTavolo: 'at the table',
    giro: 'This round',
    carrello: 'Table order',
    apriCarrello: 'View order',
    carrelloVuoto: 'The cart is empty: add something from the menu.',
    extra: 'Paid extras',
    totaleExtra: 'Extras total',
    inviaGiro: 'Send round',
    inviaExtra: 'Order extras',
    invio: 'Sending…',
    inCoda: 'You are offline: the round will be sent as soon as the connection is back.',
    inviato: 'Round sent!',
    prossimoGiro: (c: string) => `Next round in ${c}`,
    tempoRimasto: (m: number) => `${m} min left`,
    tempoScaduto: 'Time is up',
    giriInviati: 'Rounds sent',
    statoGiro: { INVIATO: 'Waiting for confirmation', APPROVATO: 'Being prepared', RIFIUTATO: 'Rejected' },
    giroN: (n: number) => `Round ${n}`,
    giroApprovato: (n: number) => `Round ${n} confirmed: on its way!`,
    giroRifiutato: (n: number) => `Round ${n} not accepted`,
    chiudiAvviso: 'Close notice',
    soloExtra: 'extras only',
    erroreRete: 'No connection. Please try again shortly.',
    erroreCarrello: 'Change not saved: check your connection.',
    riprova: 'Try again',
  },
} satisfies Record<Lingua, Record<string, unknown>>;

export type TestiSala = (typeof TESTI_SALA)['it'];

/** Explains a rule violation to the customer. */
export function messaggioRegola(
  e: ErroreRegola,
  lingua: Lingua,
  nome: (piattoId: string) => string,
  nomeGruppo: (gruppoId: string) => string,
  ora: number,
): string {
  const it = lingua === 'it';
  switch (e.codice) {
    case 'CARRELLO_VUOTO':
      return it ? 'Il carrello è vuoto.' : 'The cart is empty.';
    case 'QUANTITA_NON_VALIDA':
      return it ? `Quantità non valida per ${nome(e.piattoId)}.` : `Invalid quantity for ${nome(e.piattoId)}.`;
    case 'PIATTO_INESISTENTE':
    case 'PIATTO_NON_DISPONIBILE':
      return it
        ? `${nome(e.piattoId)} non è più disponibile: toglilo dal carrello.`
        : `${nome(e.piattoId)} is no longer available: remove it from the cart.`;
    case 'TEMPO_SCADUTO':
      return it
        ? 'Il tempo del tavolo è scaduto: chiedi al personale.'
        : 'Your table time is up: please ask the staff.';
    case 'ATTESA_TRA_GIRI': {
      const m = minuti(Date.parse(e.prossimoGiroIl) - ora);
      return it ? `Il prossimo giro si può inviare tra ${m} min.` : `The next round can be sent in ${m} min.`;
    }
    case 'MAX_GIRI':
      return it ? `Avete già fatto tutti i ${e.limite} giri previsti.` : `You have already had all ${e.limite} rounds.`;
    case 'LIMITE_GIRO':
      return it
        ? `Troppi piatti in questo giro: ${e.richiesti} su un massimo di ${e.limite}.`
        : `Too many dishes in this round: ${e.richiesti} out of a maximum of ${e.limite}.`;
    case 'MAX_PER_GIRO':
      return it
        ? `${nome(e.piattoId)}: massimo ${e.limite} per giro.`
        : `${nome(e.piattoId)}: at most ${e.limite} per round.`;
    case 'MAX_PER_PERSONA':
      return it
        ? `${nome(e.piattoId)}: già ordinati ${e.giaOrdinati}, il massimo per il tavolo è ${e.limite}.`
        : `${nome(e.piattoId)}: ${e.giaOrdinati} already ordered, the table maximum is ${e.limite}.`;
    case 'LIMITE_GRUPPO':
      return it
        ? `${nomeGruppo(e.gruppoId)}: già ordinati ${e.giaOrdinati}, il massimo per il tavolo è ${e.limite}.`
        : `${nomeGruppo(e.gruppoId)}: ${e.giaOrdinati} already ordered, the table maximum is ${e.limite}.`;
  }
}
