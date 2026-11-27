import { ALLERGENI, RUOLI_STAFF } from '@kikko/shared';
import { describe, expect, it } from 'vitest';
import { Allergene, RuoloStaff } from './generated/prisma/enums.js';

describe('Prisma enums stay aligned with @kikko/shared', () => {
  it('Allergene', () => {
    expect(Object.values(Allergene)).toEqual([...ALLERGENI]);
  });

  it('RuoloStaff', () => {
    expect(Object.values(RuoloStaff)).toEqual([...RUOLI_STAFF]);
  });
});
