import { readFileSync } from 'node:fs';
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

export function loadDemoMenu(): Menu {
  return MenuSchema.parse(readSharedSeed('menu-demo.json'));
}

export interface SeedOptions {
  adminUsername: string;
  adminPassword: string;
}

export interface SeedSummary {
  formule: number;
  categorie: number;
  piatti: number;
  tavoli: number;
  adminCreated: boolean;
}

/**
 * Loads the versioned default configuration, the demo menu, 24 tables and a development admin.
 * Idempotent: every row is upserted by its natural key (`codice`, `numero`, `username`),
 * so running it again restores the defaults without creating duplicates.
 * The admin password is only set when the admin does not exist yet.
 */
export async function runSeed(prisma: PrismaClient, options: SeedOptions): Promise<SeedSummary> {
  const config = loadDefaultConfig();
  const menu = loadDemoMenu();
  const tavoli = generaTavoliDemo();
  const passwordHash = await hash(options.adminPassword, { type: 2 /* argon2id */ });

  return prisma.$transaction(
    async (tx) => {
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

      const categoriaIds = new Map<string, string>();
      for (const c of menu.categorie) {
        const data = { nomeIt: c.nome.it, nomeEn: c.nome.en, ordine: c.ordine };
        const row = await tx.categoria.upsert({
          where: { codice: c.codice },
          create: { codice: c.codice, ...data },
          update: data,
        });
        categoriaIds.set(c.codice, row.id);
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
          immagine: p.immagine,
          allergeni: p.allergeni,
          inFormula: p.inFormula,
          prezzoExtraCent: p.prezzoExtraCent,
          maxPerSeduta: p.maxPerSeduta,
          maxPerGiro: p.maxPerGiro,
          disponibile: p.disponibile,
          ordine: p.ordine,
        };
        await tx.piatto.upsert({ where: { codice: p.codice }, create: { codice: p.codice, ...data }, update: data });
      }

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

      return {
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
