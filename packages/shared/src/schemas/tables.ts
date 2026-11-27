import { z } from 'zod';
import { CodiceSchema, InteroPositivoSchema } from './common.js';

export const TavoloSchema = z.object({
  numero: InteroPositivoSchema,
  /** Fixed identifier printed in the QR code (`/t/{slugQr}`). Grants no rights on its own. */
  slugQr: CodiceSchema,
  posti: InteroPositivoSchema,
  posX: z.number().int().nonnegative(),
  posY: z.number().int().nonnegative(),
});

export type Tavolo = z.infer<typeof TavoloSchema>;

/**
 * Builds the demo floor: `count` tables numbered from 1, laid out on a grid `columns` wide.
 * Slugs are zero-padded (`tavolo-01`) so they sort naturally.
 */
export function generaTavoliDemo(count = 24, columns = 6): Tavolo[] {
  return Array.from({ length: count }, (_, i) => {
    const numero = i + 1;
    return {
      numero,
      slugQr: `tavolo-${String(numero).padStart(2, '0')}`,
      posti: numero % 6 === 0 ? 6 : numero % 3 === 0 ? 2 : 4,
      posX: i % columns,
      posY: Math.floor(i / columns),
    };
  });
}
