import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { RuoloStaff } from '@kikko/shared';
import type { RichiestaStaff, UtenteRichiesta } from './auth.types.js';

export const PUBBLICO = 'kikko:pubblico';
export const RUOLI = 'kikko:ruoli';

/** Endpoint reachable without a staff access token (customers, login, health). */
export const Pubblico = () => SetMetadata(PUBBLICO, true);

/** Staff roles allowed on the endpoint (hierarchy applied, see ruoli.ts). */
export const Ruoli = (...ruoli: RuoloStaff[]) => SetMetadata(RUOLI, ruoli);

/** The authenticated staff user. */
export const UtenteCorrente = createParamDecorator((_data: unknown, ctx: ExecutionContext): UtenteRichiesta => {
  const req = ctx.switchToHttp().getRequest<RichiestaStaff>();
  if (!req.utente) throw new Error('UtenteCorrente used on a public endpoint');
  return req.utente;
});
