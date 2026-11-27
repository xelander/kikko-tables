import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import type { RuoloStaff } from '@kikko/shared';
import { StaffAuthService } from './staff-auth.service';

const INCLUDE: Record<RuoloStaff, readonly RuoloStaff[]> = {
  ADMIN: ['ADMIN', 'CAPO', 'CAMERIERE', 'MONITOR'],
  CAPO: ['CAPO', 'CAMERIERE'],
  CAMERIERE: ['CAMERIERE'],
  MONITOR: ['MONITOR'],
};

export function puo(ruolo: RuoloStaff | undefined, richiesto: RuoloStaff): boolean {
  return !!ruolo && INCLUDE[ruolo].includes(richiesto);
}

/** Page the user lands on after login, by role. */
export function paginaIniziale(ruolo: RuoloStaff): string {
  return ruolo === 'MONITOR' ? '/monitor' : '/staff/cameriere';
}

/**
 * Staff areas: renews the session from the cookie (so a reloaded tablet goes back to the same page),
 * otherwise sends to the login page remembering where to come back.
 */
export function staffGuard(ruolo: RuoloStaff): CanActivateFn {
  return async (_route, state) => {
    const auth = inject(StaffAuthService);
    const router = inject(Router);
    const sessione = await auth.assicura();
    if (!sessione) return router.createUrlTree(['/staff/login'], { queryParams: { torna: state.url } });
    if (!puo(sessione.utente.ruolo, ruolo)) return router.parseUrl(paginaIniziale(sessione.utente.ruolo));
    return true;
  };
}
