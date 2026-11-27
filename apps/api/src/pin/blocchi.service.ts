import { Injectable } from '@nestjs/common';
import type { Tx } from '../eventi/eventi.service.js';
import {
  STATO_INIZIALE,
  type StatoBlocco,
  normalizza,
  registraFallimento,
  secondiBlocco,
  tentativiRimasti,
} from './blocco.js';

export interface EsitoFallimento {
  /** Attempts left on the most restrictive key (0 when a lock just started). */
  tentativiRimasti: number;
  /** Seconds of lock now in force on the most restrictive key (0 if none). */
  secondiBlocco: number;
}

/**
 * Database-backed PIN lockout counters (table TentativoPin), one row per key.
 * Keys are locked with a transaction-scoped advisory lock, so concurrent attempts are counted exactly.
 * Always call `blocca` before writing events (the event log lock comes last, avoiding deadlocks).
 */
@Injectable()
export class BlocchiService {
  async blocca(tx: Tx, chiavi: readonly string[]): Promise<void> {
    for (const chiave of [...chiavi].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'pin:' + chiave}))`;
    }
  }

  async stato(tx: Tx, chiave: string, ora: Date): Promise<StatoBlocco> {
    const riga = await tx.tentativoPin.findUnique({ where: { chiave } });
    if (!riga) return { ...STATO_INIZIALE };
    return normalizza(
      {
        falliti: riga.falliti,
        blocchi: riga.blocchi,
        bloccatoFino: riga.bloccatoFino,
        aggiornatoIl: riga.aggiornatoIl,
      },
      ora,
    );
  }

  /** Longest lock in force among the keys, in seconds (0 if none). */
  async secondiBlocco(tx: Tx, chiavi: readonly string[], ora: Date): Promise<number> {
    let max = 0;
    for (const chiave of chiavi) max = Math.max(max, secondiBlocco(await this.stato(tx, chiave, ora), ora));
    return max;
  }

  async registraFallimento(tx: Tx, chiavi: readonly string[], ora: Date): Promise<EsitoFallimento> {
    let rimasti = Number.POSITIVE_INFINITY;
    let blocco = 0;
    for (const chiave of chiavi) {
      const nuovo = registraFallimento(await this.stato(tx, chiave, ora), ora);
      const dati = { falliti: nuovo.falliti, blocchi: nuovo.blocchi, bloccatoFino: nuovo.bloccatoFino };
      await tx.tentativoPin.upsert({ where: { chiave }, create: { chiave, ...dati }, update: dati });
      const secondi = secondiBlocco(nuovo, ora);
      blocco = Math.max(blocco, secondi);
      rimasti = Math.min(rimasti, secondi > 0 ? 0 : tentativiRimasti(nuovo));
    }
    return { tentativiRimasti: rimasti, secondiBlocco: blocco };
  }

  async azzera(tx: Tx, chiavi: readonly string[]): Promise<void> {
    await tx.tentativoPin.deleteMany({ where: { chiave: { in: [...chiavi] } } });
  }
}

export const chiaveTavolo = (tavoloId: string) => `tavolo:${tavoloId}`;
export const chiaveDispositivo = (idDispositivo: string) => `dispositivo:${idDispositivo}`;
export const chiaveIp = (ip: string) => `ip:${ip}`;
export const chiaveStaffPin = (utenteId: string) => `staff-pin:${utenteId}`;
export const chiaveLogin = (username: string) => `login:${username.toLowerCase()}`;
