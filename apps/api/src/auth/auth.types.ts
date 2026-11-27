import type { RuoloStaff } from '@kikko/shared';
import type { Request } from 'express';
import type { Attore } from '../common/attore.js';

/** Staff user attached to the request by the AuthGuard (from the access token). */
export interface UtenteRichiesta {
  id: string;
  nome: string;
  username: string;
  ruolo: RuoloStaff;
  dispositivoStaffId: string | null;
}

export interface JwtPayload {
  sub: string;
  nome: string;
  username: string;
  ruolo: RuoloStaff;
  dev?: string;
}

export type RichiestaStaff = Request & { utente?: UtenteRichiesta };

export function attoreStaff(utente: UtenteRichiesta): Attore {
  return { ruolo: utente.ruolo, id: utente.id, dispositivoStaffId: utente.dispositivoStaffId };
}

export function utenteDaPayload(p: JwtPayload): UtenteRichiesta {
  return { id: p.sub, nome: p.nome, username: p.username, ruolo: p.ruolo, dispositivoStaffId: p.dev ?? null };
}
