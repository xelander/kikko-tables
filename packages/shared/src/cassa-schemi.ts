import { z } from 'zod';
import { MAX_MINUTI_EXTRA } from './cassa.js';

/** Reject a round: the reason is shown to the table. */
export const RifiutaGiroSchema = z.object({ motivo: z.string().trim().min(1).max(200) });
export type RifiutaGiroRichiesta = z.infer<typeof RifiutaGiroSchema>;

/** Extra minutes for one table or for every open table. */
export const EstendiTempoSchema = z.object({ minuti: z.number().int().min(1).max(MAX_MINUTI_EXTRA) });
export type EstendiTempoRichiesta = z.infer<typeof EstendiTempoSchema>;

/** Sold out / available again. */
export const DisponibilitaSchema = z.object({ disponibile: z.boolean() });
export type DisponibilitaRichiesta = z.infer<typeof DisponibilitaSchema>;
