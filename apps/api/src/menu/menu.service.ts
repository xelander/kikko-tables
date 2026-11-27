import { Injectable } from '@nestjs/common';
import type { MenuDto, PiattoMenuDto, RegoleGruppo, RegolePiatto } from '@kikko/shared';
import { createHash } from 'node:crypto';
import type { Tx } from '../eventi/eventi.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const URL_MEDIA_PIATTI = '/media/piatti';

/** The customer menu and the rules of each dish, read from the database. */
@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  /** Menu for customers: both languages, no à la carte prices. `versione` is a hash usable as ETag. */
  async menuCliente(): Promise<MenuDto> {
    const [categorie, gruppi, piatti] = await Promise.all([
      this.prisma.categoria.findMany({ orderBy: [{ ordine: 'asc' }, { nomeIt: 'asc' }] }),
      this.prisma.gruppoLimite.findMany({ orderBy: { codice: 'asc' } }),
      this.prisma.piatto.findMany({ where: { archiviato: false }, orderBy: [{ ordine: 'asc' }, { nomeIt: 'asc' }] }),
    ]);
    const ordineCategoria = new Map(categorie.map((c, i) => [c.id, i]));
    const corpo = {
      categorie: categorie.map((c) => ({
        id: c.id,
        codice: c.codice,
        nome: { it: c.nomeIt, en: c.nomeEn },
        sezione: c.sezione,
      })),
      gruppi: gruppi.map((g) => ({ id: g.id, nome: { it: g.nomeIt, en: g.nomeEn }, maxPerPersona: g.maxPerPersona })),
      piatti: piatti
        .sort((a, b) => (ordineCategoria.get(a.categoriaId) ?? 0) - (ordineCategoria.get(b.categoriaId) ?? 0))
        .map((p): PiattoMenuDto => ({
          id: p.id,
          numero: p.numero,
          nome: { it: p.nomeIt, en: p.nomeEn },
          descrizione: { it: p.descrizioneIt, en: p.descrizioneEn },
          categoriaId: p.categoriaId,
          pezzi: p.pezzi,
          immagine:
            p.immagine && p.immagineLarghezza && p.immagineAltezza
              ? {
                  src240: `${URL_MEDIA_PIATTI}/${p.immagine}-240.webp`,
                  src480: `${URL_MEDIA_PIATTI}/${p.immagine}-480.webp`,
                  larghezza: p.immagineLarghezza,
                  altezza: p.immagineAltezza,
                  anteprima: p.immagineAnteprima ?? '',
                }
              : null,
          allergeni: p.allergeni,
          vegetariano: p.vegetariano,
          piccante: p.piccante,
          senzaGlutine: p.senzaGlutine,
          inFormula: p.inFormula,
          prezzoExtraCent: p.inFormula ? null : p.prezzoExtraCent,
          maxPerPersona: p.maxPerPersona,
          maxPerGiro: p.maxPerGiro,
          gruppoId: p.gruppoLimiteId,
          disponibile: p.disponibile,
        })),
    };
    const versione = createHash('sha256').update(JSON.stringify(corpo)).digest('base64url').slice(0, 22);
    return { versione, ...corpo };
  }

  /** Rules of every dish and group, for validating a round inside a transaction. */
  async regole(tx: Tx): Promise<{
    piatti: Map<string, RegolePiatto & { prezzoExtraCent: number | null }>;
    gruppi: Map<string, RegoleGruppo>;
  }> {
    const [piatti, gruppi] = await Promise.all([
      tx.piatto.findMany({
        select: {
          id: true,
          inFormula: true,
          disponibile: true,
          archiviato: true,
          maxPerPersona: true,
          maxPerGiro: true,
          gruppoLimiteId: true,
          prezzoExtraCent: true,
        },
      }),
      tx.gruppoLimite.findMany({ select: { id: true, maxPerPersona: true } }),
    ]);
    return {
      // An archived dish left in a cart counts as unavailable.
      piatti: new Map(
        piatti.map(({ archiviato, ...p }) => [
          p.id,
          { ...p, disponibile: p.disponibile && !archiviato, gruppoId: p.gruppoLimiteId },
        ]),
      ),
      gruppi: new Map(gruppi.map((g) => [g.id, g])),
    };
  }
}
