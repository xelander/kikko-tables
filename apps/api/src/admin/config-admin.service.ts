import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  EsitoRipristinoFormule,
  EsitoRipristinoMenu,
  FormulaAdminDto,
  FormulaAdminRichiesta,
  ImpostazioniAdmin,
  ImpostazioniAdminDto,
  TavoloAdminDto,
  TavoloAdminRichiesta,
  UtenteAdminDto,
  UtenteModificaRichiesta,
  UtenteNuovoRichiesta,
} from '@kikko/shared';
import { hash } from 'argon2';
import type { Attore } from '../common/attore.js';
import { EventiService, type Tx } from '../eventi/eventi.service.js';
import { formulaDaRiga } from '../formule/formule.mapper.js';
import type { UtenteStaff } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { loadDefaultConfig, ricaricaMenu, ripristinaFormule } from '../seed/seed-runner.js';
import { registraConfig, senzaDuplicati } from './registro-config.js';

const hashArgon = (valore: string) => hash(valore, { type: 2 /* argon2id */ });

/** Settings, formulas, tables, staff and the restore buttons of the administrator area. */
@Injectable()
export class ConfigAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventi: EventiService,
  ) {}

  // ---------- Settings ----------

  async impostazioni(): Promise<ImpostazioniAdminDto> {
    const i = await this.prisma.impostazioni.findUnique({ where: { id: 1 } });
    const predefinite = loadDefaultConfig().impostazioni;
    return {
      nomeLocale: i?.nomeLocale ?? predefinite.nomeLocale,
      fusoOrario: i?.fusoOrario ?? predefinite.fusoOrario,
      valuta: i?.valuta ?? predefinite.valuta,
      sogliaGiroAttesaMin: i?.sogliaGiroAttesaMin ?? 5,
      urlBaseQr: i?.urlBaseQr ?? null,
    };
  }

  async salvaImpostazioni(r: ImpostazioniAdmin, attore: Attore): Promise<ImpostazioniAdminDto> {
    await this.eventi.transazione(async (tx, registro) => {
      await tx.impostazioni.upsert({ where: { id: 1 }, create: { id: 1, ...r }, update: r });
      await registraConfig(registro, attore, 'impostazioni', 'MODIFICATO');
    });
    return this.impostazioni();
  }

  // ---------- Formulas ----------

  async formule(): Promise<FormulaAdminDto[]> {
    const righe = await this.prisma.formula.findMany({ orderBy: [{ ordine: 'asc' }, { nomeIt: 'asc' }] });
    return righe.map(formulaDaRiga);
  }

  /** Changes apply to tables opened from now on: open sessions keep their copy (CLAUDE.md §4). */
  async salvaFormula(id: string | null, r: FormulaAdminRichiesta, attore: Attore): Promise<FormulaAdminDto> {
    const data = {
      codice: r.codice,
      nomeIt: r.nome.it,
      nomeEn: r.nome.en,
      prezzoAdultoCent: r.prezzoAdultoCent,
      prezzoBambinoCent: r.prezzoBambinoCent,
      fasce: r.fasce,
      piattiPerPersonaPerGiro: r.piattiPerPersonaPerGiro,
      minutiTraGiri: r.minutiTraGiri,
      durataMaxMinuti: r.durataMaxMinuti,
      maxGiri: r.maxGiri,
      attiva: r.attiva,
      ordine: r.ordine,
    };
    const riga = await senzaDuplicati(() =>
      this.eventi.transazione(async (tx, registro) => {
        if (id && !(await tx.formula.findUnique({ where: { id } })))
          throw new NotFoundException({ codice: 'FORMULA_INESISTENTE' });
        const salvata = id ? await tx.formula.update({ where: { id }, data }) : await tx.formula.create({ data });
        await registraConfig(registro, attore, 'formule', id ? 'MODIFICATO' : 'CREATO', { formula: r.codice });
        return salvata;
      }),
    );
    return formulaDaRiga(riga);
  }

  // ---------- Tables ----------

  async tavoli(): Promise<TavoloAdminDto[]> {
    const righe = await this.prisma.tavolo.findMany({ orderBy: { numero: 'asc' } });
    return righe.map((t) => ({
      id: t.id,
      numero: t.numero,
      slugQr: t.slugQr,
      posti: t.posti,
      attivo: t.attivo,
      aperto: t.sedutaCorrenteId !== null,
    }));
  }

  /**
   * The QR code identifier (`slugQr`) is fixed when the table is created and never changes,
   * so printed QR codes keep working when a table is renumbered.
   */
  async salvaTavolo(id: string | null, r: TavoloAdminRichiesta, attore: Attore): Promise<void> {
    await senzaDuplicati(() =>
      this.eventi.transazione(async (tx, registro) => {
        if (id) {
          const t = await tx.tavolo.findUnique({ where: { id } });
          if (!t) throw new NotFoundException({ codice: 'TAVOLO_INESISTENTE' });
          if (!r.attivo && t.sedutaCorrenteId) throw new ConflictException({ codice: 'TAVOLO_APERTO' });
          await tx.tavolo.update({ where: { id }, data: { numero: r.numero, posti: r.posti, attivo: r.attivo } });
        } else {
          const numeri = await tx.tavolo.findMany({ select: { posY: true } });
          await tx.tavolo.create({
            data: {
              numero: r.numero,
              posti: r.posti,
              attivo: r.attivo,
              slugQr: await this.slugLibero(tx, r.numero),
              posX: 0,
              posY: numeri.length ? Math.max(...numeri.map((n) => n.posY)) + 1 : 0,
            },
          });
        }
        await registraConfig(registro, attore, 'tavoli', id ? 'MODIFICATO' : 'CREATO', { tavoloNumero: r.numero });
      }),
    );
  }

  private async slugLibero(tx: Tx, numero: number): Promise<string> {
    const base = `tavolo-${String(numero).padStart(2, '0')}`;
    for (let i = 1; ; i++) {
      const candidato = i === 1 ? base : `${base}-${i}`;
      if (!(await tx.tavolo.findUnique({ where: { slugQr: candidato } }))) return candidato;
    }
  }

  // ---------- Staff ----------

  async utenti(): Promise<UtenteAdminDto[]> {
    const righe = await this.prisma.utenteStaff.findMany({ orderBy: [{ attivo: 'desc' }, { nome: 'asc' }] });
    return righe.map(utenteDto);
  }

  async creaUtente(r: UtenteNuovoRichiesta, attore: Attore): Promise<UtenteAdminDto> {
    const [passwordHash, pinHash] = await Promise.all([hashArgon(r.password), r.pin ? hashArgon(r.pin) : null]);
    const utente = await senzaDuplicati(() =>
      this.eventi.transazione(async (tx, registro) => {
        const creato = await tx.utenteStaff.create({
          data: { username: r.username, nome: r.nome, ruolo: r.ruolo, passwordHash, pinHash },
        });
        await registraConfig(registro, attore, 'utenti', 'CREATO', { utenteId: creato.id, ruolo: r.ruolo });
        return creato;
      }),
    );
    return utenteDto(utente);
  }

  /**
   * Deactivating someone (or changing their password) logs them out of every device.
   * An administrator cannot lock themselves out, and the last active administrator stays an administrator.
   */
  async modificaUtente(id: string, r: UtenteModificaRichiesta, attore: Attore): Promise<UtenteAdminDto> {
    const [passwordHash, pinHash] = await Promise.all([
      r.password ? hashArgon(r.password) : undefined,
      r.pin ? hashArgon(r.pin) : r.pin,
    ]);
    const utente = await this.eventi.transazione(async (tx, registro) => {
      const attuale = await tx.utenteStaff.findUnique({ where: { id } });
      if (!attuale) throw new NotFoundException({ codice: 'UTENTE_INESISTENTE' });
      const perdeAdmin = attuale.ruolo === 'ADMIN' && attuale.attivo && (r.ruolo !== 'ADMIN' || !r.attivo);
      if (perdeAdmin && id === attore.id) throw new ConflictException({ codice: 'NON_SU_SE_STESSI' });
      if (perdeAdmin && (await tx.utenteStaff.count({ where: { ruolo: 'ADMIN', attivo: true } })) <= 1)
        throw new ConflictException({ codice: 'ULTIMO_ADMIN' });

      const aggiornato = await tx.utenteStaff.update({
        where: { id },
        data: {
          nome: r.nome,
          ruolo: r.ruolo,
          attivo: r.attivo,
          ...(passwordHash ? { passwordHash } : {}),
          ...(pinHash !== undefined ? { pinHash } : {}),
        },
      });
      if (!r.attivo || passwordHash || r.ruolo !== attuale.ruolo)
        await tx.refreshToken.updateMany({
          where: { utenteId: id, revocatoIl: null },
          data: { revocatoIl: new Date() },
        });
      await registraConfig(registro, attore, 'utenti', 'MODIFICATO', {
        utenteId: id,
        ruolo: r.ruolo,
        attivo: r.attivo,
        password: !!passwordHash,
        pin: pinHash === undefined ? 'invariato' : pinHash === null ? 'rimosso' : 'cambiato',
      });
      return aggiornato;
    });
    return utenteDto(utente);
  }

  // ---------- Restore the defaults (two separate buttons) ----------

  async ripristinaFormule(attore: Attore): Promise<EsitoRipristinoFormule> {
    return this.eventi.transazione(
      async (tx, registro) => {
        const formule = await ripristinaFormule(tx);
        await registraConfig(registro, attore, 'formule', 'RIPRISTINATO', { formule });
        return { formule };
      },
      { timeout: 30_000 },
    );
  }

  async ricaricaMenu(attore: Attore): Promise<EsitoRipristinoMenu> {
    return this.eventi.transazione(
      async (tx, registro) => {
        const esito = await ricaricaMenu(tx);
        await registraConfig(registro, attore, 'menu', 'RIPRISTINATO', esito);
        return esito;
      },
      { timeout: 60_000 },
    );
  }
}

function utenteDto(u: UtenteStaff): UtenteAdminDto {
  return { id: u.id, username: u.username, nome: u.nome, ruolo: u.ruolo, attivo: u.attivo, haPin: u.pinHash !== null };
}
