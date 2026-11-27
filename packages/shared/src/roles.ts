/** Staff roles (CLAUDE.md §2). Kept in sync with the Prisma enum `RuoloStaff`. */
export const RUOLI_STAFF = ['CAMERIERE', 'CAPO', 'ADMIN', 'MONITOR'] as const;
export type RuoloStaff = (typeof RUOLI_STAFF)[number];
