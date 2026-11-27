import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** Validates a request body with a Zod schema from @kikko/shared. */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        codice: 'DATI_NON_VALIDI',
        errori: result.error.issues.map((i) => ({ campo: i.path.join('.'), messaggio: i.message })),
      });
    }
    return result.data;
  }
}
