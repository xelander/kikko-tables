import { linguaDelBrowser } from './i18n.service';

describe('linguaDelBrowser', () => {
  it.each([
    [['it-IT', 'en'], 'it'],
    [['en-GB', 'it'], 'en'],
    [['de-DE', 'it-IT'], 'it'],
    [['de-DE', 'fr'], 'en'],
    [[], 'it'],
  ] as const)('%j → %s', (preferenze, attesa) => {
    expect(linguaDelBrowser(preferenze)).toBe(attesa);
  });
});
