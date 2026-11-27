import { Controller, Get } from '@nestjs/common';
import { type FormuleDisponibili, proponiFormula } from '@kikko/shared';
import { Ruoli } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { formulaDaRiga } from './formule.mapper.js';

const FUSO_PREDEFINITO = 'Europe/Rome';

@Controller('formule')
export class FormuleController {
  constructor(private readonly prisma: PrismaService) {}

  /** Active formulas and the one suggested for now in the restaurant's time zone. */
  @Get()
  @Ruoli('CAMERIERE')
  async disponibili(): Promise<FormuleDisponibili> {
    const [righe, impostazioni] = await Promise.all([
      this.prisma.formula.findMany({ where: { attiva: true }, orderBy: { ordine: 'asc' } }),
      this.prisma.impostazioni.findUnique({ where: { id: 1 } }),
    ]);
    const formule = righe.map(formulaDaRiga);
    const proposta = proponiFormula(formule, new Date(), impostazioni?.fusoOrario ?? FUSO_PREDEFINITO);
    return {
      formule: formule.map((f) => ({
        id: f.id,
        codice: f.codice,
        nome: f.nome,
        prezzoAdultoCent: f.prezzoAdultoCent,
        prezzoBambinoCent: f.prezzoBambinoCent,
      })),
      propostaId: proposta?.id ?? null,
    };
  }
}
