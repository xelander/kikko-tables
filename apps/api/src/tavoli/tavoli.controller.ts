import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  AggiungiTavoloSchema,
  type AggiungiTavoloRichiesta,
  ApriTavoloSchema,
  type ApriTavoloRichiesta,
  CopertiSchema,
  type CopertiRichiesta,
  type SedutaConPin,
  type SedutaDettaglioDto,
  type SedutaRiepilogo,
  SpostaTavoloSchema,
  type SpostaTavoloRichiesta,
  type TavoloStato,
  UnisciSeduteSchema,
  type UnisciSeduteRichiesta,
} from '@kikko/shared';
import { type UtenteRichiesta, attoreStaff } from '../auth/auth.types.js';
import { Ruoli, UtenteCorrente } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { SeduteService } from './sedute.service.js';

@Controller()
export class TavoliController {
  constructor(private readonly sedute: SeduteService) {}

  @Get('tavoli')
  @Ruoli('CAMERIERE', 'MONITOR')
  elenco(): Promise<TavoloStato[]> {
    return this.sedute.elencoTavoli();
  }

  @Post('tavoli/:id/apri')
  @Ruoli('CAMERIERE')
  apri(
    @Param('id', new ParseUUIDPipe()) tavoloId: string,
    @Body(new ZodPipe(ApriTavoloSchema)) body: ApriTavoloRichiesta,
    @UtenteCorrente() utente: UtenteRichiesta,
  ): Promise<SedutaConPin> {
    return this.sedute.apri(tavoloId, body, attoreStaff(utente));
  }

  @Post('sedute/:id/pin')
  @Ruoli('CAMERIERE')
  @HttpCode(200)
  rigeneraPin(
    @Param('id', new ParseUUIDPipe()) sedutaId: string,
    @UtenteCorrente() utente: UtenteRichiesta,
  ): Promise<SedutaConPin> {
    return this.sedute.rigeneraPin(sedutaId, attoreStaff(utente));
  }

  @Get('sedute/:id')
  @Ruoli('CAMERIERE', 'MONITOR')
  dettaglio(@Param('id', new ParseUUIDPipe()) sedutaId: string): Promise<SedutaDettaglioDto> {
    return this.sedute.dettaglio(sedutaId);
  }

  @Patch('sedute/:id/coperti')
  @Ruoli('CAMERIERE')
  coperti(
    @Param('id', new ParseUUIDPipe()) sedutaId: string,
    @Body(new ZodPipe(CopertiSchema)) body: CopertiRichiesta,
    @UtenteCorrente() utente: UtenteRichiesta,
  ): Promise<SedutaRiepilogo> {
    return this.sedute.modificaCoperti(sedutaId, body, attoreStaff(utente));
  }

  @Post('sedute/:id/sposta')
  @Ruoli('CAMERIERE')
  @HttpCode(200)
  sposta(
    @Param('id', new ParseUUIDPipe()) sedutaId: string,
    @Body(new ZodPipe(SpostaTavoloSchema)) body: SpostaTavoloRichiesta,
    @UtenteCorrente() utente: UtenteRichiesta,
  ): Promise<SedutaRiepilogo> {
    return this.sedute.sposta(sedutaId, body.daTavoloId, body.aTavoloId, attoreStaff(utente));
  }

  @Post('sedute/:id/tavoli')
  @Ruoli('CAMERIERE')
  @HttpCode(200)
  aggiungiTavolo(
    @Param('id', new ParseUUIDPipe()) sedutaId: string,
    @Body(new ZodPipe(AggiungiTavoloSchema)) body: AggiungiTavoloRichiesta,
    @UtenteCorrente() utente: UtenteRichiesta,
  ): Promise<SedutaRiepilogo> {
    return this.sedute.aggiungiTavolo(sedutaId, body.tavoloId, attoreStaff(utente));
  }

  @Post('sedute/:id/unisci')
  @Ruoli('CAMERIERE')
  @HttpCode(200)
  unisci(
    @Param('id', new ParseUUIDPipe()) sedutaId: string,
    @Body(new ZodPipe(UnisciSeduteSchema)) body: UnisciSeduteRichiesta,
    @UtenteCorrente() utente: UtenteRichiesta,
  ): Promise<SedutaRiepilogo> {
    return this.sedute.unisci(sedutaId, body.sedutaId, attoreStaff(utente));
  }

  @Post('sedute/:id/chiudi')
  @Ruoli('CAPO')
  @HttpCode(204)
  async chiudi(
    @Param('id', new ParseUUIDPipe()) sedutaId: string,
    @UtenteCorrente() utente: UtenteRichiesta,
  ): Promise<void> {
    await this.sedute.chiudi(sedutaId, attoreStaff(utente));
  }
}
