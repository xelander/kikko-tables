import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { RuoloStaff } from '@kikko/shared';
import { type JwtPayload, type RichiestaStaff, utenteDaPayload } from './auth.types.js';
import { PUBBLICO, RUOLI } from './decorators.js';
import { haRuolo } from './ruoli.js';

/** Global guard: every endpoint needs a staff access token unless marked @Pubblico(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBBLICO, targets)) return true;

    const req = context.switchToHttp().getRequest<RichiestaStaff>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException({ codice: 'NON_AUTENTICATO' });
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException({ codice: 'TOKEN_NON_VALIDO' });
    }
    req.utente = utenteDaPayload(payload);

    const richiesti = this.reflector.getAllAndOverride<RuoloStaff[] | undefined>(RUOLI, targets) ?? [];
    if (!haRuolo(req.utente.ruolo, richiesti)) throw new ForbiddenException({ codice: 'RUOLO_NON_AUTORIZZATO' });
    return true;
  }
}
