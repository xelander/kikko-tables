import { HttpErrorResponse } from '@angular/common/http';

const MESSAGGI: Record<string, string> = {
  TAVOLO_GIA_APERTO: 'Il tavolo è già stato aperto da un collega.',
  TAVOLO_OCCUPATO: 'Quel tavolo è stato appena occupato: scegline un altro.',
  SEDUTA_CHIUSA: 'Il tavolo è già stato chiuso.',
  FORMULE_DIVERSE: 'Si possono unire solo tavoli con la stessa formula.',
  TAVOLO_NON_DELLA_SEDUTA: 'Il tavolo da spostare non appartiene a questa seduta.',
  DATI_NON_VALIDI: 'Dati non validi.',
};

/** Italian message for a failed staff action. */
export function messaggioErroreStaff(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'Nessuna connessione con il server.';
    const codice = (error.error as { codice?: string } | null)?.codice;
    if (codice && MESSAGGI[codice]) return MESSAGGI[codice];
    if (error.status === 403) return 'Non hai i permessi per questa operazione.';
  }
  return 'Operazione non riuscita, riprova.';
}
