import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { DefaultConfigSchema, MenuSchema, generaTavoliDemo, type DefaultConfig, type Menu } from '@kikko/shared';
import { hash } from 'argon2';
import type { PrismaClient } from '../generated/prisma/client.js';

const require = createRequire(import.meta.url);

function readSharedSeed(file: string): unknown {
  return JSON.parse(readFileSync(require.resolve(`@kikko/shared/seed/${file}`), 'utf8'));
}

export function loadDefaultConfig(): DefaultConfig {
  return DefaultConfigSchema.parse(readSharedSeed('default-config.json'));
}

/** The restaurant menu (transcribed from the printed menu) plus demo drinks. */
export function loadMenu(): Menu {
  return MenuSchema.parse(readSharedSeed('menu-kikko.json'));
}

/** Directory with the seed photos shipped in @kikko/shared. */
export function cartellaFotoSeed(): string {
  return join(dirname(require.resolve('@kikko/shared/seed/menu-kikko.json')), 'media', 'piatti');
}

/** Copies the seed photos to `${mediaDir}/piatti`, keeping files that already exist (e.g. uploaded later). */
export function copiaFotoSeed(mediaDir: string): number {
  const origine = cartellaFotoSeed();
  const destinazione = join(mediaDir, 'piatti');
  mkdirSync(destinazione, { recursive: true });
  let copiate = 0;
  for (const file of readdirSync(origine)) {
    if (!file.endsWith('.webp') || existsSync(join(destinazione, file))) continue;
    copyFileSync(join(origine, file), join(destinazione, file));
    copiate++;
  }
  return copiate;
}

export interface SeedOptions {
  adminUsername: string;
  adminPassword: string;
  /** Development only: also create demo staff (a waiter and a manager) with known passwords and PINs. */
  utentiDemo?: boolean;
  /** Where dish photos are served from (MEDIA_DIR). If set, the seed photos are copied there. */
  mediaDir?: string;
}

/** Demo staff for development and tests. Never created in production. */
export const UTENTI_DEMO = [
  { username: 'mario', nome: 'Mario', ruolo: 'CAMERIERE', password: 'mario', pin: '1234' },
  { username: 'capo', nome: 'Capo sala', ruolo: 'CAPO', password: 'capo', pin: '0000' },
  { username: 'monitor', nome: 'Monitor', ruolo: 'MONITOR', password: 'monitor', pin: null },
] as const;

export interface SeedSummary {
  formule: number;
  categorie: number;
  piatti: number;
  tavoli: number;
  adminCreated: boolean;
  utentiDemoCreati: number;
  fotoCopiate: number;
}

/**
 * Loads the versioned default configuration, the demo menu, 24 tables and a development admin.
 * Idempotent: every row is upserted by its natural key (`codice`, `numero`, `username`),
 * so running it again restores the defaults without creating duplicates.
 * The admin password is only set when the admin does not exist yet.
 */
export async function runSeed(prisma: PrismaClient, options: SeedOptions): Promise<SeedSummary> {
  const config = loadDefaultConfig();
  const menu = loadMenu();
  const fotoCopiate = options.mediaDir ? copiaFotoSeed(options.mediaDir) : 0;
  const tavoli = generaTavoliDemo();
  const passwordHash = await hash(options.adminPassword, { type: 2 /* argon2id */ });
  const demo = options.utentiDemo
    ? await Promise.all(
        UTENTI_DEMO.map(async (u) => ({
          username: u.username,
          nome: u.nome,
          ruolo: u.ruolo,
          passwordHash: await hash(u.password, { type: 2 }),
          pinHash: u.pin ? await hash(u.pin, { type: 2 }) : null,
        })),
      )
    : [];

  return prisma.$transaction(
    async (tx) => {
      await ripristinaFormule(tx, config);
      await ricaricaMenu(tx, menu);

      for (const t of tavoli) {
        const data = { slugQr: t.slugQr, posti: t.posti, posX: t.posX, posY: t.posY };
        await tx.tavolo.upsert({ where: { numero: t.numero }, create: { numero: t.numero, ...data }, update: data });
      }

      const existingAdmin = await tx.utenteStaff.findUnique({ where: { username: options.adminUsername } });
      if (!existingAdmin) {
        await tx.utenteStaff.create({
          data: { username: options.adminUsername, nome: 'Amministratore', ruolo: 'ADMIN', passwordHash },
        });
      }

      let utentiDemoCreati = 0;
      for (const u of demo) {
        const esistente = await tx.utenteStaff.findUnique({ where: { username: u.username } });
        if (!esistente) {
          await tx.utenteStaff.create({ data: u });
          utentiDemoCreati++;
        }
      }

      return {
        fotoCopiate,
        utentiDemoCreati,
        formule: config.formule.length,
        categorie: menu.categorie.length,
        piatti: menu.piatti.length,
        tavoli: tavoli.length,
        adminCreated: !existingAdmin,
      };
    },
    { timeout: 30_000 },
  );
}

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * Restores the default formulas and global settings from the versioned seed ("Ripristina formule e regole").
 * Formulas missing from the seed are deactivated, not deleted. Open sessions keep their own copy of the formula.
 * The QR base address and the waiting threshold are kept.
 */
export async function ripristinaFormule(tx: Tx, config: DefaultConfig = loadDefaultConfig()): Promise<number> {
  const { impostazioni } = config;
  await tx.impostazioni.upsert({ where: { id: 1 }, create: { id: 1, ...impostazioni }, update: impostazioni });

  for (const f of config.formule) {
    const data = {
      nomeIt: f.nome.it,
      nomeEn: f.nome.en,
      prezzoAdultoCent: f.prezzoAdultoCent,
      prezzoBambinoCent: f.prezzoBambinoCent,
      fasce: f.fasce,
      piattiPerPersonaPerGiro: f.piattiPerPersonaPerGiro,
      minutiTraGiri: f.minutiTraGiri,
      durataMaxMinuti: f.durataMaxMinuti,
      maxGiri: f.maxGiri,
      attiva: f.attiva,
      ordine: f.ordine,
    };
    await tx.formula.upsert({ where: { codice: f.codice }, create: { codice: f.codice, ...data }, update: data });
  }
  await tx.formula.updateMany({
    where: { codice: { notIn: config.formule.map((f) => f.codice) } },
    data: { attiva: false },
  });
  return config.formule.length;
}

/**
 * Reloads the example menu from the seed ("Ricarica il menù di esempio"): categories, limit groups and dishes.
 * Overwrites changes made to those dishes; dishes not in the seed are deleted or, if already ordered, archived.
 */
export async function ricaricaMenu(
  tx: Tx,
  menu: Menu = loadMenu(),
): Promise<{ categorie: number; piatti: number; archiviati: number }> {
  const categoriaIds = new Map<string, string>();
  for (const c of menu.categorie) {
    const data = { nomeIt: c.nome.it, nomeEn: c.nome.en, sezione: c.sezione, ordine: c.ordine };
    const row = await tx.categoria.upsert({
      where: { codice: c.codice },
      create: { codice: c.codice, ...data },
      update: data,
    });
    categoriaIds.set(c.codice, row.id);
  }

  const gruppoIds = new Map<string, string>();
  for (const g of menu.gruppi) {
    const data = { nomeIt: g.nome.it, nomeEn: g.nome.en, maxPerPersona: g.maxPerPersona };
    const row = await tx.gruppoLimite.upsert({
      where: { codice: g.codice },
      create: { codice: g.codice, ...data },
      update: data,
    });
    gruppoIds.set(g.codice, row.id);
  }

  for (const p of menu.piatti) {
    const categoriaId = categoriaIds.get(p.categoria);
    if (!categoriaId) throw new Error(`Unknown category ${p.categoria} for dish ${p.codice}`);
    const data = {
      nomeIt: p.nome.it,
      nomeEn: p.nome.en,
      descrizioneIt: p.descrizione.it,
      descrizioneEn: p.descrizione.en,
      categoriaId,
      numero: p.numero,
      pezzi: p.pezzi,
      immagine: p.immagine?.file ?? null,
      immagineLarghezza: p.immagine?.larghezza ?? null,
      immagineAltezza: p.immagine?.altezza ?? null,
      immagineAnteprima: p.immagine?.anteprima ?? null,
      allergeni: p.allergeni,
      vegetariano: p.vegetariano,
      piccante: p.piccante,
      senzaGlutine: p.senzaGlutine,
      inFormula: p.inFormula,
      prezzoExtraCent: p.prezzoExtraCent,
      prezzoCartaCent: p.prezzoCartaCent,
      maxPerPersona: p.maxPerPersona,
      maxPerGiro: p.maxPerGiro,
      gruppoLimiteId: p.gruppo ? (gruppoIds.get(p.gruppo) ?? null) : null,
      disponibile: p.disponibile,
      ordine: p.ordine,
    };
    await tx.piatto.upsert({ where: { codice: p.codice }, create: { codice: p.codice, ...data }, update: data });
  }

  // Dishes that are not in the menu any more are deleted, unless they were already ordered:
  // those are archived (kept for the history and the reports).
  const codiciPiatti = menu.piatti.map((p) => p.codice);
  await tx.piatto.deleteMany({ where: { codice: { notIn: codiciPiatti }, vociGiro: { none: {} } } });
  const archiviati = await tx.piatto.updateMany({
    where: { codice: { notIn: codiciPiatti }, archiviato: false },
    data: { archiviato: true },
  });
  await tx.categoria.deleteMany({
    where: { codice: { notIn: menu.categorie.map((c) => c.codice) }, piatti: { none: {} } },
  });
  await tx.gruppoLimite.deleteMany({ where: { codice: { notIn: menu.gruppi.map((g) => g.codice) } } });
  return { categorie: menu.categorie.length, piatti: menu.piatti.length, archiviati: archiviati.count };
}
