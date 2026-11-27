/** localStorage that never throws (private mode, blocked storage, SSR). */
export const archivio = {
  leggi(chiave: string): string | null {
    try {
      return globalThis.localStorage?.getItem(chiave) ?? null;
    } catch {
      return null;
    }
  },
  scrivi(chiave: string, valore: string): void {
    try {
      globalThis.localStorage?.setItem(chiave, valore);
    } catch {
      // ignored: storage is only a convenience
    }
  },
  rimuovi(chiave: string): void {
    try {
      globalThis.localStorage?.removeItem(chiave);
    } catch {
      // ignored
    }
  },
};
