import { describe, expect, it } from 'vitest';
import { DispositivoThrottlerGuard } from './throttler.guard.js';

describe('DispositivoThrottlerGuard', () => {
  const tracker = (req: Record<string, unknown>) =>
    (DispositivoThrottlerGuard.prototype as unknown as { getTracker(r: unknown): Promise<string> }).getTracker.call(
      {},
      req,
    );

  it('tracks customers by device, so a whole room on one Wi-Fi is not throttled together', async () => {
    const a = await tracker({ ip: '10.0.0.1', cookies: { kk_ct: 'token-a' } });
    const b = await tracker({ ip: '10.0.0.1', cookies: { kk_ct: 'token-b' } });
    expect(a).not.toBe(b);
    expect(a).toMatch(/^dispositivo:/);
    expect(a).not.toContain('token-a');
    expect(await tracker({ ip: '10.0.0.1', cookies: { kk_did: 'x' } })).toMatch(/^dispositivo:/);
  });

  it('falls back to the IP address', async () => {
    expect(await tracker({ ip: '10.0.0.1', cookies: {} })).toBe('ip:10.0.0.1');
  });
});
