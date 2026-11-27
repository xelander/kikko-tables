import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CategoriaAdminDto,
  CategoriaAdminRichiesta,
  EsitoEliminazionePiatto,
  GruppoAdminDto,
  GruppoAdminRichiesta,
  PiattoAdminDto,
  PiattoAdminRichiesta,
} from '@kikko/shared';
import type { Attore } from '../common/attore.js';
import { EventiService, type Tx } from '../eventi/eventi.service.js';
import type { Piatto } from '../generated/prisma/client.js';
import { URL_MEDIA_PIATTI } from '../menu/menu.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FotoService, type FotoSalvata } from './foto.service.js';
import { registraConfig, senzaDuplicati, slug } from './registro-config.js';

type PiattoConRelazioni = Piatto & {
  categoria: { codice: string };
  gruppoLimite: { codice: string } | null;
  _count: { vociGiro: number };
};

const includePiatto = {
  categoria: { select: { codice: true } },
  gruppoLimite: { select: { codice: true } },
  _count: { select: { vociGiro: true } },
} as const;

/** Menu administration (CLAUDE.md §4 and §12): categories, limit groups, dishes and their photos. */
@Injectable()
export class MenuAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventi: EventiService,
    private readonly foto: FotoService,
  ) {}

  // ---------- Categories ----------

  async categorie(): Promise<CategoriaAdminDto[]> {
    const righe = await this.prisma.categoria.findMany({
      orderBy: [{ ordine: 'asc' }, { nomeIt: 'asc' }],
      include: { _count: { select: { piatti: { where: { archiviato: false } } } } },
    });
    return righe.map((c) => ({
      id: c.id,
      codice: c.codice,
      nome: { it: c.nomeIt, en: c.nomeEn },
      sezione: c.sezione,
      ordine: c.ordine,
      piatti: c._count.piatti,
    }));
  }

  async salvaCategoria(id: string | null, r: CategoriaAdminRichiesta, attore: Attore): Promise<void> {
    const data = { codice: r.codice, nomeIt: r.nome.it, nomeEn: r.nome.en, sezione: r.sezione, ordine: r.ordine };
    await senzaDuplicati(() =>
      this.eventi.transazione(async (tx, registro) => {
        if (id) {
          await this.trova(tx.categoria.findUnique({ where: { id } }), 'CATEGORIA_INESISTENTE');
          if (r.sezione === 'BEVANDE' && (await tx.piatto.count({ where: { categoriaId: id, inFormula: true } })))
            throw new BadRequestException({ codice: 'BEVANDE_A_PAGAMENTO' });
          await tx.categoria.update({ where: { id }, data });
        } else await tx.categoria.create({ data });
        await registraConfig(registro, attore, 'menu', id ? 'MODIFICATO' : 'CREATO', { categoria: r.codice });
      }),
    );
  }

  /** Only an empty category can be deleted (archived dishes still keep it). */
  async eliminaCategoria(id: string, attore: Attore): Promise<void> {
    await this.eventi.transazione(async (tx, registro) => {
      const c = await this.trova(tx.categoria.findUnique({ where: { id } }), 'CATEGORIA_INESISTENTE');
      if (await tx.piatto.count({ where: { categoriaId: id } }))
        throw new ConflictException({ codice: 'CATEGORIA_NON_VUOTA' });
      await tx.categoria.delete({ where: { id } });
      await registraConfig(registro, attore, 'menu', 'ELIMINATO', { categoria: c.codice });
    });
  }

  // ---------- Limit groups ----------

  async gruppi(): Promise<GruppoAdminDto[]> {
    const righe = await this.prisma.gruppoLimite.findMany({
      orderBy: { nomeIt: 'asc' },
      include: { _count: { select: { piatti: { where: { archiviato: false } } } } },
    });
    return righe.map((g) => ({
      id: g.id,
      codice: g.codice,
      nome: { it: g.nomeIt, en: g.nomeEn },
      maxPerPersona: g.maxPerPersona,
      piatti: g._count.piatti,
    }));
  }

  async salvaGruppo(id: string | null, r: GruppoAdminRichiesta, attore: Attore): Promise<void> {
    const data = { codice: r.codice, nomeIt: r.nome.it, nomeEn: r.nome.en, maxPerPersona: r.maxPerPersona };
    await senzaDuplicati(() =>
      this.eventi.transazione(async (tx, registro) => {
        if (id) {
          await this.trova(tx.gruppoLimite.findUnique({ where: { id } }), 'GRUPPO_INESISTENTE');
          await tx.gruppoLimite.update({ where: { id }, data });
        } else await tx.gruppoLimite.create({ data });
        await registraConfig(registro, attore, 'menu', id ? 'MODIFICATO' : 'CREATO', { gruppo: r.codice });
      }),
    );
  }

  /** Deleting a group frees its dishes from the shared limit. */
  async eliminaGruppo(id: string, attore: Attore): Promise<void> {
    await this.eventi.transazione(async (tx, registro) => {
      const g = await this.trova(tx.gruppoLimite.findUnique({ where: { id } }), 'GRUPPO_INESISTENTE');
      await tx.gruppoLimite.delete({ where: { id } });
      await registraConfig(registro, attore, 'menu', 'ELIMINATO', { gruppo: g.codice });
    });
  }

  // ---------- Dishes ----------

  async piatti(): Promise<PiattoAdminDto[]> {
    const righe = await this.prisma.piatto.findMany({
      include: includePiatto,
      orderBy: [{ categoria: { ordine: 'asc' } }, { ordine: 'asc' }, { nomeIt: 'asc' }],
    });
    return righe.map((p) => piattoDto(p));
  }

  async salvaPiatto(id: string | null, r: PiattoAdminRichiesta, attore: Attore): Promise<PiattoAdminDto> {
    const salvato = await senzaDuplicati(() =>
      this.eventi.transazione(async (tx, registro) => {
        const categoria = await tx.categoria.findUnique({ where: { codice: r.categoria } });
        if (!categoria) throw new BadRequestException({ codice: 'CATEGORIA_INESISTENTE' });
        if (categoria.sezione === 'BEVANDE' && r.inFormula)
          throw new BadRequestException({ codice: 'BEVANDE_A_PAGAMENTO' });
        const gruppo = r.gruppo ? await tx.gruppoLimite.findUnique({ where: { codice: r.gruppo } }) : null;
        if (r.gruppo && !gruppo) throw new BadRequestException({ codice: 'GRUPPO_INESISTENTE' });

        const data = {
          numero: r.numero,
          nomeIt: r.nome.it,
          nomeEn: r.nome.en,
          descrizioneIt: r.descrizione.it,
          descrizioneEn: r.descrizione.en,
          categoriaId: categoria.id,
          pezzi: r.pezzi,
          allergeni: r.allergeni,
          vegetariano: r.vegetariano,
          piccante: r.piccante,
          senzaGlutine: r.senzaGlutine,
          inFormula: r.inFormula,
          prezzoExtraCent: r.prezzoExtraCent,
          prezzoCartaCent: r.prezzoCartaCent,
          maxPerPersona: r.maxPerPersona,
          maxPerGiro: r.maxPerGiro,
          gruppoLimiteId: gruppo?.id ?? null,
          disponibile: r.disponibile,
          ordine: r.ordine,
        };
        let piatto: Piatto;
        if (id) {
          await this.trova(tx.piatto.findUnique({ where: { id } }), 'PIATTO_INESISTENTE');
          piatto = await tx.piatto.update({
            where: { id },
            data: { ...data, ...(r.codice ? { codice: r.codice } : {}) },
          });
        } else {
          const codice = r.codice ?? (await this.codiceLibero(tx, r.nome.it));
          piatto = await tx.piatto.create({ data: { ...data, codice } });
        }
        await registraConfig(registro, attore, 'menu', id ? 'MODIFICATO' : 'CREATO', {
          piattoId: piatto.id,
          nome: piatto.nomeIt,
        });
        return piatto.id;
      }),
    );
    return this.piatto(salvato);
  }

  /** Never ordered: deleted. Already ordered: archived (hidden from the menu, kept for the history). */
  async eliminaPiatto(id: string, attore: Attore): Promise<EsitoEliminazionePiatto> {
    let fotoDaRimuovere: string | null = null;
    const esito = await this.eventi.transazione(async (tx, registro) => {
      const p = await this.trova(
        tx.piatto.findUnique({ where: { id }, include: { _count: { select: { vociGiro: true } } } }),
        'PIATTO_INESISTENTE',
      );
      await tx.voceCarrello.deleteMany({ where: { piattoId: id } });
      if (p._count.vociGiro > 0) {
        await tx.piatto.update({ where: { id }, data: { archiviato: true } });
        await registraConfig(registro, attore, 'menu', 'ARCHIVIATO', { piattoId: id, nome: p.nomeIt });
        return 'ARCHIVIATO' as const;
      }
      await tx.piatto.delete({ where: { id } });
      fotoDaRimuovere = p.immagine;
      await registraConfig(registro, attore, 'menu', 'ELIMINATO', { piattoId: id, nome: p.nomeIt });
      return 'ELIMINATO' as const;
    });
    if (fotoDaRimuovere) this.foto.rimuovi(fotoDaRimuovere);
    return { esito };
  }

  /** Brings an archived dish back to the menu. */
  async ripristinaPiatto(id: string, attore: Attore): Promise<PiattoAdminDto> {
    await this.eventi.transazione(async (tx, registro) => {
      const p = await this.trova(tx.piatto.findUnique({ where: { id } }), 'PIATTO_INESISTENTE');
      await tx.piatto.update({ where: { id }, data: { archiviato: false } });
      await registraConfig(registro, attore, 'menu', 'RIPRISTINATO', { piattoId: id, nome: p.nomeIt });
    });
    return this.piatto(id);
  }

  /** Stores the photo (resized to WebP with a blurred preview) and replaces the previous one. */
  async caricaFoto(id: string, file: Buffer, attore: Attore): Promise<PiattoAdminDto> {
    const piatto = await this.trova(this.prisma.piatto.findUnique({ where: { id } }), 'PIATTO_INESISTENTE');
    const salvata = await this.foto.salva(file, piatto.codice);
    try {
      await this.impostaFoto(id, salvata, attore);
    } catch (error) {
      this.foto.rimuovi(salvata.file);
      throw error;
    }
    if (piatto.immagine) this.foto.rimuovi(piatto.immagine);
    return this.piatto(id);
  }

  async rimuoviFoto(id: string, attore: Attore): Promise<PiattoAdminDto> {
    const piatto = await this.trova(this.prisma.piatto.findUnique({ where: { id } }), 'PIATTO_INESISTENTE');
    await this.impostaFoto(id, null, attore);
    if (piatto.immagine) this.foto.rimuovi(piatto.immagine);
    return this.piatto(id);
  }

  private async impostaFoto(id: string, f: FotoSalvata | null, attore: Attore): Promise<void> {
    await this.eventi.transazione(async (tx, registro) => {
      const p = await tx.piatto.update({
        where: { id },
        data: {
          immagine: f?.file ?? null,
          immagineLarghezza: f?.larghezza ?? null,
          immagineAltezza: f?.altezza ?? null,
          immagineAnteprima: f?.anteprima ?? null,
        },
      });
      await registraConfig(registro, attore, 'menu', 'MODIFICATO', { piattoId: id, nome: p.nomeIt, foto: !!f });
    });
  }

  private async piatto(id: string): Promise<PiattoAdminDto> {
    return piattoDto(await this.prisma.piatto.findUniqueOrThrow({ where: { id }, include: includePiatto }));
  }

  /** A dish code from its Italian name, unique among all dishes ("gyoza-di-gambero", "gyoza-di-gambero-2"…). */
  private async codiceLibero(tx: Tx, nome: string): Promise<string> {
    const base = slug(nome);
    const usati = new Set(
      (await tx.piatto.findMany({ where: { codice: { startsWith: base } }, select: { codice: true } })).map(
        (p) => p.codice,
      ),
    );
    if (!usati.has(base)) return base;
    for (let i = 2; ; i++) if (!usati.has(`${base}-${i}`)) return `${base}-${i}`;
  }

  private async trova<T>(promessa: Promise<T | null>, codice: string): Promise<T> {
    const valore = await promessa;
    if (!valore) throw new NotFoundException({ codice });
    return valore;
  }
}

function piattoDto(p: PiattoConRelazioni): PiattoAdminDto {
  return {
    id: p.id,
    codice: p.codice,
    numero: p.numero,
    nome: { it: p.nomeIt, en: p.nomeEn },
    descrizione: { it: p.descrizioneIt, en: p.descrizioneEn },
    categoria: p.categoria.codice,
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
    prezzoExtraCent: p.prezzoExtraCent,
    prezzoCartaCent: p.prezzoCartaCent,
    maxPerPersona: p.maxPerPersona,
    maxPerGiro: p.maxPerGiro,
    gruppo: p.gruppoLimite?.codice ?? null,
    disponibile: p.disponibile,
    ordine: p.ordine,
    archiviato: p.archiviato,
    ordinato: p._count.vociGiro > 0,
  };
}
