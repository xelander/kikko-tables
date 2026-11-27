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

  it('loads the default configuration, the restaurant menu with drinks, 24 tables and the admin', async () => {
    const summary = await runSeed(prisma, { adminUsername: 'admin', adminPassword: 'secret-1' });
    expect(summary).toEqual({
      formule: 3,
      categorie: 20,
      piatti: 167,
      tavoli: 24,
      adminCreated: true,
      utentiDemoCreati: 0,
      fotoCopiate: 0,
    });
    expect(await counts(prisma)).toEqual({
      impostazioni: 1,
      formule: 3,
      categorie: 20,
      piatti: 167,
      tavoli: 24,
      staff: 1,
    });

    const impostazioni = await prisma.impostazioni.findUniqueOrThrow({ where: { id: 1 } });
    expect(impostazioni).toMatchObject({ fusoOrario: 'Europe/Rome', valuta: 'EUR' });

    const cola = await prisma.piatto.findUniqueOrThrow({
      where: { codice: 'bevanda-cola' },
      include: { categoria: true },
    });
    expect(cola).toMatchObject({ inFormula: false, prezzoExtraCent: 350 });
    expect(cola.categoria).toMatchObject({ codice: 'bevande', sezione: 'BEVANDE' });

    const bao = await prisma.piatto.findUniqueOrThrow({ where: { numero: '113' } });
    expect(bao).toMatchObject({ nomeIt: 'Bao bun', maxPerPersona: 1, prezzoCartaCent: 400, pezzi: 1 });
    expect(bao.immagine).toMatch(/^foto-\d{3}$/);

    const sashimi = await prisma.piatto.findUniqueOrThrow({ where: { numero: '66' }, include: { gruppoLimite: true } });
    expect(sashimi.gruppoLimite).toMatchObject({ codice: 'sashimi', maxPerPersona: 4 });

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

describe('runSeed with a media directory', () => {
  it('copies the dish photos once and removes dishes that left the menu', async () => {
    const { mkdtempSync, readdirSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const prisma = createTestPrisma();
    const mediaDir = mkdtempSync(join(tmpdir(), 'kikko-media-'));
    try {
      await truncateAll(prisma);
      const primo = await runSeed(prisma, { adminUsername: 'admin', adminPassword: 'x', mediaDir });
      expect(primo.fotoCopiate).toBe(246);
      expect(readdirSync(join(mediaDir, 'piatti'))).toContain('foto-001-240.webp');
      const secondo = await runSeed(prisma, { adminUsername: 'admin', adminPassword: 'x', mediaDir });
      expect(secondo.fotoCopiate).toBe(0);

      const categoria = await prisma.categoria.findFirstOrThrow();
      await prisma.piatto.create({
        data: { codice: 'vecchio', nomeIt: 'Vecchio', nomeEn: 'Old', categoriaId: categoria.id },
      });
      await runSeed(prisma, { adminUsername: 'admin', adminPassword: 'x' });
      expect(await prisma.piatto.findUnique({ where: { codice: 'vecchio' } })).toBeNull();
    } finally {
      rmSync(mediaDir, { recursive: true, force: true });
      await prisma.$disconnect();
    }
  });
});
