import type { RuoloAttore } from '@kikko/shared';

/** Who is performing an action, as recorded in the event log. */
export interface Attore {
  ruolo: RuoloAttore;
  id: string | null;
  dispositivoStaffId?: string | null;
}

export const SISTEMA: Attore = { ruolo: 'SISTEMA', id: null };
