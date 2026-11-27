import { ConflictException } from '@nestjs/common';
import type { Attore } from '../common/attore.js';
import type { RegistroTx } from '../eventi/eventi.service.js';
import { Prisma } from '../generated/prisma/client.js';

/** What a configuration change touched. `menu` changes make the open customer menus reload. */
export type AmbitoConfig = 'menu' | 'formule' | 'impostazioni' | 'tavoli' | 'utenti';
export type AzioneConfig = 'CREATO' | 'MODIFICATO' | 'ELIMINATO' | 'ARCHIVIATO' | 'RIPRISTINATO';

/** Records a CONFIG_MODIFICATA event in the same transaction as the change. */
export function registraConfig(
  registro: RegistroTx,
  attore: Attore,
  ambito: AmbitoConfig,
  azione: AzioneConfig,
  dettagli: Record<string, unknown> = {},
): Promise<void> {
  return registro.registra({ tipo: 'CONFIG_MODIFICATA', attore, payload: { ambito, azione, ...dettagli } });
}

/** Turns a unique-constraint violation into a readable 409 (e.g. a dish number already used). */
export async function senzaDuplicati<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const campi = (error.meta?.['target'] as string[] | string | undefined) ?? [];
      const campo = Array.isArray(campi) ? campi.join(',') : String(campi);
      throw new ConflictException({ codice: 'DUPLICATO', campo });
    }
    throw error;
  }
}

/** "Gyoza di gambero" → "gyoza-di-gambero". */
export function slug(testo: string): string {
  const s = testo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  return s || 'voce';
}
