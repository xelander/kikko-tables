import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  CategoriaAdminSchema,
  type CategoriaAdminDto,
  type CategoriaAdminRichiesta,
  type EsitoEliminazionePiatto,
  type EsitoRipristinoFormule,
  type EsitoRipristinoMenu,
  FormulaAdminSchema,
  type FormulaAdminDto,
  type FormulaAdminRichiesta,
  GruppoAdminSchema,
  type GruppoAdminDto,
  type GruppoAdminRichiesta,
  ImpostazioniAdminSchema,
  type ImpostazioniAdmin,
  type ImpostazioniAdminDto,
  PiattoAdminSchema,
  type PiattoAdminDto,
  type PiattoAdminRichiesta,
  TavoloAdminSchema,
  type TavoloAdminDto,
  type TavoloAdminRichiesta,
  UtenteModificaSchema,
  type UtenteAdminDto,
  type UtenteModificaRichiesta,
  UtenteNuovoSchema,
  type UtenteNuovoRichiesta,
} from '@kikko/shared';
import type { Response } from 'express';
import { type UtenteRichiesta, attoreStaff } from '../auth/auth.types.js';
import { Ruoli, UtenteCorrente } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConfigAdminService } from './config-admin.service.js';
import { MenuAdminService } from './menu-admin.service.js';
import { pdfQr } from './qr-pdf.js';

const MAX_FOTO_BYTE = 10 * 1024 * 1024;
const uuid = () => new ParseUUIDPipe();

/** Administrator area (CLAUDE.md §2, F5). Every change is recorded as CONFIG_MODIFICATA. */
@Controller('admin')
@Ruoli('ADMIN')
export class AdminController {
  constructor(
    private readonly config: ConfigAdminService,
    private readonly menu: MenuAdminService,
    private readonly prisma: PrismaService,
  ) {}

  // ---------- Settings ----------

  @Get('impostazioni')
  impostazioni(): Promise<ImpostazioniAdminDto> {
    return this.config.impostazioni();
  }

  @Put('impostazioni')
  salvaImpostazioni(
    @Body(new ZodPipe(ImpostazioniAdminSchema)) body: ImpostazioniAdmin,
    @UtenteCorrente() u: UtenteRichiesta,
  ): Promise<ImpostazioniAdminDto> {
    return this.config.salvaImpostazioni(body, attoreStaff(u));
  }

  // ---------- Formulas ----------

  @Get('formule')
  formule(): Promise<FormulaAdminDto[]> {
    return this.config.formule();
  }

  @Post('formule')
  creaFormula(
    @Body(new ZodPipe(FormulaAdminSchema)) body: FormulaAdminRichiesta,
    @UtenteCorrente() u: UtenteRichiesta,
  ): Promise<FormulaAdminDto> {
    return this.config.salvaFormula(null, body, attoreStaff(u));
  }

  @Put('formule/:id')
  modificaFormula(
    @Param('id', uuid()) id: string,
    @Body(new ZodPipe(FormulaAdminSchema)) body: FormulaAdminRichiesta,
    @UtenteCorrente() u: UtenteRichiesta,
  ): Promise<FormulaAdminDto> {
    return this.config.salvaFormula(id, body, attoreStaff(u));
  }

  // ---------- Categories and limit groups ----------

  @Get('categorie')
  categorie(): Promise<CategoriaAdminDto[]> {
    return this.menu.categorie();
  }

  @Post('categorie')
  @HttpCode(204)
  creaCategoria(
    @Body(new ZodPipe(CategoriaAdminSchema)) body: CategoriaAdminRichiesta,
    @UtenteCorrente() u: UtenteRichiesta,
  ): Promise<void> {
    return this.menu.salvaCategoria(null, body, attoreStaff(u));
  }

  @Put('categorie/:id')
  @HttpCode(204)
  modificaCategoria(
    @Param('id', uuid()) id: string,
    @Body(new ZodPipe(CategoriaAdminSchema)) body: CategoriaAdminRichiesta,
    @UtenteCorrente() u: UtenteRichiesta,
  ): Promise<void> {
    return this.menu.salvaCategoria(id, body, attoreStaff(u));
  }

  @Delete('categorie/:id')
  @HttpCode(204)
  eliminaCategoria(@Param('id', uuid()) id: string, @UtenteCorrente() u: UtenteRichiesta): Promise<void> {
    return this.menu.eliminaCategoria(id, attoreStaff(u));
  }

  @Get('gruppi')
  gruppi(): Promise<GruppoAdminDto[]> {
    return this.menu.gruppi();
  }

  @Post('gruppi')
  @HttpCode(204)
  creaGruppo(
    @Body(new ZodPipe(GruppoAdminSchema)) body: GruppoAdminRichiesta,
    @UtenteCorrente() u: UtenteRichiesta,
  ): Promise<void> {
    return this.menu.salvaGruppo(null, body, attoreStaff(u));
  }

  @Put('gruppi/:id')
  @HttpCode(204)
  modificaGruppo(
    @Param('id', uuid()) id: string,
    @Body(new ZodPipe(GruppoAdminSchema)) body: GruppoAdminRichiesta,
    @UtenteCorrente() u: UtenteRichiesta,
  ): Promise<void> {
    return this.menu.salvaGruppo(id, body, attoreStaff(u));
  }

  @Delete('gruppi/:id')
  @HttpCode(204)
  eliminaGruppo(@Param('id', uuid()) id: string, @UtenteCorrente() u: UtenteRichiesta): Promise<void> {
    return this.menu.eliminaGruppo(id, attoreStaff(u));
  }

  // ---------- Dishes ----------

  @Get('piatti')
  piatti(): Promise<PiattoAdminDto[]> {
    return this.menu.piatti();
  }

  @Post('piatti')
  creaPiatto(
    @Body(new ZodPipe(PiattoAdminSchema)) body: PiattoAdminRichiesta,
    @UtenteCorrente() u: UtenteRichiesta,
  ): Promise<PiattoAdminDto> {
    return this.menu.salvaPiatto(null, body, attoreStaff(u));
  }

  @Put('piatti/:id')
  modificaPiatto(
    @Param('id', uuid()) id: string,
    @Body(new ZodPipe(PiattoAdminSchema)) body: PiattoAdminRichiesta,
    @UtenteCorrente() u: UtenteRichiesta,
  ): Promise<PiattoAdminDto> {
    return this.menu.salvaPiatto(id, body, attoreStaff(u));
  }

  /** Deleted if never ordered, otherwise archived. */
  @Delete('piatti/:id')
  eliminaPiatto(
    @Param('id', uuid()) id: string,
    @UtenteCorrente() u: UtenteRichiesta,
  ): Promise<EsitoEliminazionePiatto> {
    return this.menu.eliminaPiatto(id, attoreStaff(u));
  }

  @Post('piatti/:id/ripristina')
  @HttpCode(200)
  ripristinaPiatto(@Param('id', uuid()) id: string, @UtenteCorrente() u: UtenteRichiesta): Promise<PiattoAdminDto> {
    return this.menu.ripristinaPiatto(id, attoreStaff(u));
  }

  @Post('piatti/:id/foto')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('foto', { limits: { fileSize: MAX_FOTO_BYTE, files: 1 } }))
  caricaFoto(
    @Param('id', uuid()) id: string,
    @UploadedFile() file: { buffer?: Buffer } | undefined,
    @UtenteCorrente() u: UtenteRichiesta,
  ): Promise<PiattoAdminDto> {
    if (!file?.buffer?.length) throw new BadRequestException({ codice: 'FOTO_MANCANTE' });
    return this.menu.caricaFoto(id, file.buffer, attoreStaff(u));
  }

  @Delete('piatti/:id/foto')
  rimuoviFoto(@Param('id', uuid()) id: string, @UtenteCorrente() u: UtenteRichiesta): Promise<PiattoAdminDto> {
    return this.menu.rimuoviFoto(id, attoreStaff(u));
  }

  // ---------- Tables and QR codes ----------

  @Get('tavoli')
  tavoli(): Promise<TavoloAdminDto[]> {
    return this.config.tavoli();
  }

  @Post('tavoli')
  @HttpCode(204)
  creaTavolo(
    @Body(new ZodPipe(TavoloAdminSchema)) body: TavoloAdminRichiesta,
    @UtenteCorrente() u: UtenteRichiesta,
  ): Promise<void> {
    return this.config.salvaTavolo(null, body, attoreStaff(u));
  }

  @Put('tavoli/:id')
  @HttpCode(204)
  modificaTavolo(
    @Param('id', uuid()) id: string,
    @Body(new ZodPipe(TavoloAdminSchema)) body: TavoloAdminRichiesta,
    @UtenteCorrente() u: UtenteRichiesta,
  ): Promise<void> {
    return this.config.salvaTavolo(id, body, attoreStaff(u));
  }

  /**
   * PDF with the QR cards of the active tables (all, or the numbers in `tavoli=1,2,3`).
   * The address is the one in the settings, or else `origine` (the address the admin is using).
   */
  @Get('tavoli/qr.pdf')
  async qrPdf(
    @Query('origine') origine: string | undefined,
    @Query('tavoli') filtro: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const impostazioni = await this.config.impostazioni();
    const base = impostazioni.urlBaseQr ?? baseValida(origine);
    if (!base) throw new BadRequestException({ codice: 'INDIRIZZO_QR_MANCANTE' });
    const numeri = filtro
      ? new Set(
          filtro
            .split(',')
            .map((n) => Number.parseInt(n, 10))
            .filter(Number.isFinite),
        )
      : null;
    const tavoli = await this.prisma.tavolo.findMany({ where: { attivo: true }, orderBy: { numero: 'asc' } });
    const pdf = await pdfQr(
      impostazioni.nomeLocale,
      tavoli
        .filter((t) => !numeri || numeri.has(t.numero))
        .map((t) => ({ numero: t.numero, url: `${base}/t/${t.slugQr}` })),
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="qr-tavoli.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  }

  // ---------- Staff ----------

  @Get('utenti')
  utenti(): Promise<UtenteAdminDto[]> {
    return this.config.utenti();
  }

  @Post('utenti')
  creaUtente(
    @Body(new ZodPipe(UtenteNuovoSchema)) body: UtenteNuovoRichiesta,
    @UtenteCorrente() u: UtenteRichiesta,
  ): Promise<UtenteAdminDto> {
    return this.config.creaUtente(body, attoreStaff(u));
  }

  @Put('utenti/:id')
  modificaUtente(
    @Param('id', uuid()) id: string,
    @Body(new ZodPipe(UtenteModificaSchema)) body: UtenteModificaRichiesta,
    @UtenteCorrente() u: UtenteRichiesta,
  ): Promise<UtenteAdminDto> {
    return this.config.modificaUtente(id, body, attoreStaff(u));
  }

  // ---------- Restore the defaults ----------

  @Post('ripristina/formule')
  @HttpCode(200)
  ripristinaFormule(@UtenteCorrente() u: UtenteRichiesta): Promise<EsitoRipristinoFormule> {
    return this.config.ripristinaFormule(attoreStaff(u));
  }

  @Post('ripristina/menu')
  @HttpCode(200)
  ricaricaMenu(@UtenteCorrente() u: UtenteRichiesta): Promise<EsitoRipristinoMenu> {
    return this.config.ricaricaMenu(attoreStaff(u));
  }
}

/** `https://example.com` from a URL given by the browser, or null. */
function baseValida(origine: string | undefined): string | null {
  if (!origine) return null;
  try {
    const u = new URL(origine);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}
