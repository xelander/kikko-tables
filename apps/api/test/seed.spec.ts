import { verify } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { runSeed } from '../src/seed/seed-runner.js';
import { createTestPrisma, truncateAll } from './test-db.js';

async function counts(prisma: PrismaClient) {
  return {
    impostazioni: await prisma.impostazioni.count(),
    formule: await prisma.formula.count(),
    categorie: await prisma.categoria.count(),
    piatti: await prisma.piatto.count(),
    tavoli: await prisma.tavolo.count(),
    staff: await prisma.utenteStaff.count(),
  };
}

describe('runSeed', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('loads the default configuration, demo menu, 24 tables and the admin', async () => {
    const summary = await runSeed(prisma, { adminUsername: 'admin', adminPassword: 'secret-1' });
    expect(summary).toEqual({
      formule: 3,
      categorie: 9,
      piatti: 34,
      tavoli: 24,
      adminCreated: true,
      utentiDemoCreati: 0,
    });
    expect(await counts(prisma)).toEqual({
      impostazioni: 1,
      formule: 3,
      categorie: 9,
      piatti: 34,
      tavoli: 24,
      staff: 1,
    });

    const impostazioni = await prisma.impostazioni.findUniqueOrThrow({ where: { id: 1 } });
    expect(impostazioni).toMatchObject({ fusoOrario: 'Europe/Rome', valuta: 'EUR' });

    const cola = await prisma.piatto.findUniqueOrThrow({ where: { codice: 'cola' }, include: { categoria: true } });
    expect(cola).toMatchObject({ inFormula: false, prezzoExtraCent: 300 });
    expect(cola.categoria.codice).toBe('bevande');

    const tonno = await prisma.piatto.findUniqueOrThrow({ where: { codice: 'nigiri-tonno' } });
    expect(tonno).toMatchObject({ maxPerSeduta: 4, maxPerGiro: 2, allergeni: ['FISH'] });

    const admin = await prisma.utenteStaff.findUniqueOrThrow({ where: { username: 'admin' } });
    expect(admin.ruolo).toBe('ADMIN');
    expect(admin.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(await verify(admin.passwordHash, 'secret-1')).toBe(true);
  });

  it('is idempotent and restores edited defaults without touching the admin password', async () => {
    await prisma.formula.update({ where: { codice: 'cena' }, data: { piattiPerPersonaPerGiro: 99 } });
    const before = await counts(prisma);

    const summary = await runSeed(prisma, { adminUsername: 'admin', adminPassword: 'another' });

    expect(summary.adminCreated).toBe(false);
    expect(await counts(prisma)).toEqual(before);
    const cena = await prisma.formula.findUniqueOrThrow({ where: { codice: 'cena' } });
    expect(cena.piattiPerPersonaPerGiro).toBe(6);
    const admin = await prisma.utenteStaff.findUniqueOrThrow({ where: { username: 'admin' } });
    expect(await verify(admin.passwordHash, 'secret-1')).toBe(true);
  });
});
