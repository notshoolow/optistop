import { IStopCacheRepositoryPort } from '@/domain/models/ports';
import { FileStopRepository } from './persistence/file-stop.repository';
import { SupabaseStopRepository } from './persistence/supabase-stop.repository';
import { OSRMRoutingAdapter } from './routing/osrm-routing.adapter';
import { OverpassOsmAdapter } from './providers/overpass-osm.adapter';
import { GooglePlacesQuotaGuardedAdapter } from './providers/google-places.adapter';
import { SlidingWindowRateLimiter } from './security/rate-limiter';

export interface AppContainer {
  stopRepository: IStopCacheRepositoryPort;
  routingAdapter: OSRMRoutingAdapter;
  overpassAdapter: OverpassOsmAdapter;
  googleAdapter: GooglePlacesQuotaGuardedAdapter;
  rateLimiter: SlidingWindowRateLimiter;
}

const globalForContainer = globalThis as unknown as {
  optiStopContainer?: AppContainer;
};

export function createStopRepositoryFromEnv(): IStopCacheRepositoryPort {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (supabaseUrl && serviceRoleKey) {
    return new SupabaseStopRepository({
      supabaseUrl,
      serviceRoleKey,
    });
  }
  return new FileStopRepository();
}

function createContainer(): AppContainer {
  const stopRepository = createStopRepositoryFromEnv();
  const routingAdapter = new OSRMRoutingAdapter();
  const overpassAdapter = new OverpassOsmAdapter();
  const googleAdapter = new GooglePlacesQuotaGuardedAdapter({
    quotaStore: stopRepository,
  });
  const rateLimiter = new SlidingWindowRateLimiter();

  return {
    stopRepository,
    routingAdapter,
    overpassAdapter,
    googleAdapter,
    rateLimiter,
  };
}

export function getContainer(): AppContainer {
  if (!globalForContainer.optiStopContainer) {
    globalForContainer.optiStopContainer = createContainer();
  }
  return globalForContainer.optiStopContainer;
}

export function resetContainerForTests(): void {
  globalForContainer.optiStopContainer = createContainer();
}
