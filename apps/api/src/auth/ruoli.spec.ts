import { describe, expect, it } from 'vitest';
import { haRuolo } from './ruoli.js';

describe('haRuolo', () => {
  it('lets ADMIN do everything', () => {
    for (const r of ['ADMIN', 'CAPO', 'CAMERIERE', 'MONITOR'] as const) expect(haRuolo('ADMIN', [r])).toBe(true);
  });

  it('lets CAPO act as CAMERIERE but not as ADMIN or MONITOR', () => {
    expect(haRuolo('CAPO', ['CAMERIERE'])).toBe(true);
    expect(haRuolo('CAPO', ['ADMIN'])).toBe(false);
    expect(haRuolo('CAPO', ['MONITOR'])).toBe(false);
  });

  it('keeps CAMERIERE and MONITOR to their own role', () => {
    expect(haRuolo('CAMERIERE', ['CAPO'])).toBe(false);
    expect(haRuolo('MONITOR', ['CAMERIERE'])).toBe(false);
    expect(haRuolo('MONITOR', ['MONITOR'])).toBe(true);
  });

  it('accepts any role when none is required', () => {
    expect(haRuolo('MONITOR', [])).toBe(true);
  });
});
