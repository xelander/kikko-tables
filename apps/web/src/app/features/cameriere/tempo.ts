/** "1 h 05 min" / "12 min" / "scaduto" from milliseconds left. */
export function tempoRimanente(ms: number): string {
  if (ms <= 0) return 'scaduto';
  const minuti = Math.ceil(ms / 60_000);
  if (minuti < 60) return `${minuti} min`;
  return `${Math.floor(minuti / 60)} h ${String(minuti % 60).padStart(2, '0')} min`;
}

/** Minutes left under which a table is shown as "almost expired". */
export const SOGLIA_QUASI_SCADUTO_MIN = 15;
