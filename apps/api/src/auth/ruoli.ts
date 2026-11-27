import type { RuoloStaff } from '@kikko/shared';

/**
 * Role hierarchy: ADMIN can do everything, CAPO can do everything a CAMERIERE can.
 * MONITOR is a read-only screen and inherits nothing.
 */
const INCLUDE: Record<RuoloStaff, readonly RuoloStaff[]> = {
  ADMIN: ['ADMIN', 'CAPO', 'CAMERIERE', 'MONITOR'],
  CAPO: ['CAPO', 'CAMERIERE'],
  CAMERIERE: ['CAMERIERE'],
  MONITOR: ['MONITOR'],
};

export function haRuolo(ruolo: RuoloStaff, richiesti: readonly RuoloStaff[]): boolean {
  return richiesti.length === 0 || richiesti.some((r) => INCLUDE[ruolo].includes(r));
}
