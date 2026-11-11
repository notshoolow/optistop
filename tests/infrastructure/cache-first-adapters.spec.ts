import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileStopRepository } from '@/infrastructure/persistence/file-stop.repository';
import { GooglePlacesQuotaGuardedAdapter } from '@/infrastructure/providers/google-places.adapter';
import { SlidingWindowRateLimiter } from '@/infrastructure/security/rate-limiter';
import { sliceRouteByWindow } from '@/domain/geometry/corridor-slicer';
import { FakeA3RoutingPort } from '../helpers/fake-routing';

describe('RNF-07 · Persistencia, cuota y caché', () => {
  it('RNF-07.1: las paradas comunitarias sobreviven a un "reinicio" y no entran en el ranking hasta aprobarse', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'optistop-'));
    try {
      const repo1 = new FileStopRepository({ dataDir: dir, includeDemo: false });
      const pending = await repo1.submitCommunityStop({
        name: 'Venta Nueva',
        highwayCode: 'A-3',
        kmMarker: 100,
        locality: 'Saelices',
        coordinates: { lat: 39.92, lon: -2.8 },
        category: 'RESTAURANT',
        accessType: 'HIGHWAY_EXIT_EASY',
        priceLevel: 1,
      });
      expect(pending.dataQuality).toBe('COMMUNITY_PENDING');

      const repo2 = new FileStopRepository({ dataDir: dir, includeDemo: false }); // nuevo proceso
      expect((await repo2.listPending()).map((s) => s.id)).toContain(pending.id);

      const route = await new FakeA3RoutingPort().computeRoute({ lat: 40.4168, lon: -3.7038 });
      const corridor = sliceRouteByWindow(route.polyline, 40, 120, 12);
      expect((await repo2.findStopsInCorridor(corridor)).some((s) => s.id === pending.id)).toBe(false);

      await repo2.approvePending(pending.id);
      const repo3 = new FileStopRepository({ dataDir: dir, includeDemo: false });
      expect((await repo3.findStopsInCorridor(corridor)).some((s) => s.id === pending.id)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('RNF-07.2: la cuota de Google es persistente, va por mes y bloquea al llegar al tope', async () => {
    const repo = new FileStopRepository({ dataDir: null, includeDemo: false });
    expect(await repo.incrementMonthlyQuotaIfBelow('gplaces', 2, new Date('2026-11-03'))).toBe(true);
    expect(await repo.incrementMonthlyQuotaIfBelow('gplaces', 2, new Date('2026-11-20'))).toBe(true);
    expect(await repo.incrementMonthlyQuotaIfBelow('gplaces', 2, new Date('2026-11-29'))).toBe(false);
    expect(await repo.incrementMonthlyQuotaIfBelow('gplaces', 2, new Date('2026-12-01'))).toBe(true); // nuevo mes
  });

  it('Quota Guard: sin API key no hay llamadas ni coste', async () => {
    const repo = new FileStopRepository({ dataDir: null, includeDemo: false });
    const g = new GooglePlacesQuotaGuardedAdapter({ apiKey: '', quotaStore: repo });
    const route = await new FakeA3RoutingPort().computeRoute({ lat: 40.4168, lon: -3.7038 });
    const res = await g.discoverStopsInCorridor(sliceRouteByWindow(route.polyline, 40, 120, 12));
    expect(res).toEqual({ stops: [], billableCalls: 0, estimatedCostUsd: 0 });
  });

  it('RNF-05.4: el limitador de ventana deslizante bloquea al superar el límite y libera al expirar', () => {
    let now = 0;
    const rl = new SlidingWindowRateLimiter(() => now);
    for (let i = 0; i < 3; i++) expect(rl.check('ip:1', 3, 60_000).allowed).toBe(true);
    const blocked = rl.check('ip:1', 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(rl.check('ip:2', 3, 60_000).allowed).toBe(true);
    now = 61_000;
    expect(rl.check('ip:1', 3, 60_000).allowed).toBe(true);
  });
});
