import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';
import { COOKIE, leggiCookie } from '../common/cookies.js';
import { type ClienteAutenticato, ClienteService } from './cliente.service.js';

export type RichiestaCliente = Request & { cliente?: ClienteAutenticato };

/** Customer endpoints: the device cookie must belong to an open session. */
@Injectable()
export class ClienteGuard implements CanActivate {
  constructor(private readonly clienti: ClienteService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RichiestaCliente>();
    const cliente = await this.clienti.autentica(leggiCookie(req.cookies, COOKIE.cliente));
    if (!cliente) throw new UnauthorizedException({ codice: 'SESSIONE_CLIENTE_NON_VALIDA' });
    req.cliente = cliente;
    return true;
  }
}

export const ClienteCorrente = createParamDecorator((_data: unknown, ctx: ExecutionContext): ClienteAutenticato => {
  const req = ctx.switchToHttp().getRequest<RichiestaCliente>();
  if (!req.cliente) throw new Error('ClienteCorrente used without ClienteGuard');
  return req.cliente;
});
