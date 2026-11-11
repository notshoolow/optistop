import crypto from 'node:crypto';
import {
  CorridorBoundingBox,
  IStopCacheRepositoryPort,
} from '@/domain/models/ports';
import {
  CommunityStopSubmission,
  RoadStopEntity,
} from '@/domain/models/types';
import { DEMO_STOPS } from './demo-stops.seed';

export interface SupabaseStopRepositoryOptions {
  supabaseUrl: string;
  serviceRoleKey: string;
  cacheTtlMs?: number;
}

interface RoadStopRow {
  id: string;
  status: 'APPROVED' | 'PENDING_REVIEW';
  highway_code: string;
  km_marker: number;
  lat: number;
  lon: number;
  payload: RoadStopEntity;
}

interface CorridorCacheRow {
  corridor_hash: string;
  cached_at_ms: number;
  stop_ids: string[];
}

interface QuotaRow {
  month_key: string;
  used_calls: number;
}

/**
 * Adaptador Cloud-Ready sobre Supabase PostgREST (RNF-09).
 * Utiliza `fetch` nativo de Node 20+ (0 dependencias pesadas añadidas al bundle)
 * y mantiene el catálogo semilla (`DEMO_STOPS`) fusionado con las paradas en la nube.
 */
export class SupabaseStopRepository implements IStopCacheRepositoryPort {
  private readonly baseUrl: string;
  private readonly serviceKey: string;
  private readonly cacheTtlMs: number;

  constructor(options: SupabaseStopRepositoryOptions) {
    this.baseUrl = options.supabaseUrl.replace(/\/+$/, '');
    this.serviceKey = options.serviceRoleKey;
    this.cacheTtlMs = options.cacheTtlMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      apikey: this.serviceKey,
      Authorization: `Bearer ${this.serviceKey}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  async findStopsInCorridor(
    corridor: CorridorBoundingBox
  ): Promise<RoadStopEntity[]> {
    const merged = new Map<string, RoadStopEntity>();
    for (const seed of DEMO_STOPS) {
      if (
        seed.coordinates.lat >= corridor.minLat &&
        seed.coordinates.lat <= corridor.maxLat &&
        seed.coordinates.lon >= corridor.minLon &&
        seed.coordinates.lon <= corridor.maxLon
      ) {
        merged.set(seed.id, seed);
      }
    }

    try {
      const params = new URLSearchParams({
        select: 'id,payload',
        status: 'eq.APPROVED',
        and: `(lat.gte.${corridor.minLat},lat.lte.${corridor.maxLat},lon.gte.${corridor.minLon},lon.lte.${corridor.maxLon})`,
      });
      const res = await fetch(
        `${this.baseUrl}/rest/v1/road_stops?${params.toString()}`,
        { headers: this.buildHeaders() }
      );
      if (res.ok) {
        const rows = (await res.json()) as RoadStopRow[];
        for (const r of rows) {
          if (r.payload && r.payload.dataQuality !== 'COMMUNITY_PENDING') {
            merged.set(r.id, r.payload);
          }
        }
      }
    } catch {
      // Degradación elegante al catálogo semilla si Supabase no responde temporalmente
    }

    return Array.from(merged.values());
  }

  async saveOrUpdateStops(
    stops: RoadStopEntity[],
    corridorHash: string
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const rows: RoadStopRow[] = stops.map((s) => ({
      id: s.id,
      status: 'APPROVED',
      highway_code: s.highwayCode,
      km_marker: s.kmMarker,
      lat: s.coordinates.lat,
      lon: s.coordinates.lon,
      payload: {
        ...s,
        cachedAtIso: s.cachedAtIso ?? nowIso,
      },
    }));

    try {
      if (rows.length > 0) {
        await fetch(`${this.baseUrl}/rest/v1/road_stops`, {
          method: 'POST',
          headers: this.buildHeaders({
            Prefer: 'resolution=merge-duplicates',
          }),
          body: JSON.stringify(rows),
        });
      }

      const corridorRow: CorridorCacheRow = {
        corridor_hash: corridorHash,
        cached_at_ms: Date.now(),
        stop_ids: stops.map((s) => s.id),
      };

      await fetch(`${this.baseUrl}/rest/v1/corridor_cache`, {
        method: 'POST',
        headers: this.buildHeaders({
          Prefer: 'resolution=merge-duplicates',
        }),
        body: JSON.stringify(corridorRow),
      });
    } catch {
      // Ignorar fallo de escritura de caché remoto sin interrumpir la petición del usuario
    }
  }

  async hasFreshCorridorCoverage(corridorHash: string): Promise<boolean> {
    try {
      const params = new URLSearchParams({
        select: 'corridor_hash,cached_at_ms',
        corridor_hash: `eq.${corridorHash}`,
        limit: '1',
      });
      const res = await fetch(
        `${this.baseUrl}/rest/v1/corridor_cache?${params.toString()}`,
        { headers: this.buildHeaders() }
      );
      if (!res.ok) return false;
      const rows = (await res.json()) as CorridorCacheRow[];
      if (!rows.length) return false;
      return Date.now() - Number(rows[0].cached_at_ms) <= this.cacheTtlMs;
    } catch {
      return false;
    }
  }

  async submitCommunityStop(
    submission: CommunityStopSubmission
  ): Promise<RoadStopEntity> {
    const pending: RoadStopEntity = {
      id: `comm-${crypto.randomUUID()}`,
      name: submission.name.trim(),
      category: submission.category,
      highwayCode: submission.highwayCode.toUpperCase(),
      kmMarker: Math.round(submission.kmMarker),
      locality: submission.locality.trim(),
      coordinates: {
        lat: Number(submission.coordinates.lat.toFixed(5)),
        lon: Number(submission.coordinates.lon.toFixed(5)),
      },
      accessType: submission.accessType,
      directionNotes:
        submission.directionNotes?.trim() || 'Salida pendiente de verificación',
      ratingAvg: null,
      reviewCount: 0,
      priceLevel: submission.priceLevel ?? null,
      specialty:
        submission.specialty?.trim() || 'Propuesta enviada por la comunidad',
      avgStopDurationMin: submission.avgStopDurationMin ?? 30,
      openingHours: submission.openingHours?.trim() || 'Sin horario confirmado',
      amenities: {
        hasEvChargerNearby: submission.amenities?.hasEvChargerNearby ?? null,
        evChargerDetails: submission.amenities?.evChargerDetails,
        hasGasStationOnsite: submission.amenities?.hasGasStationOnsite ?? null,
        gasStationBrand: submission.amenities?.gasStationBrand,
        hasEasyParking: submission.amenities?.hasEasyParking ?? null,
        hasCleanRestrooms: submission.amenities?.hasCleanRestrooms ?? null,
        isPetFriendly: submission.amenities?.isPetFriendly ?? null,
        hasKidsArea: submission.amenities?.hasKidsArea ?? null,
        hasTruckParking: submission.amenities?.hasTruckParking ?? null,
        hasWifi: submission.amenities?.hasWifi ?? null,
      },
      source: 'COMMUNITY',
      dataQuality: 'COMMUNITY_PENDING',
      cachedAtIso: new Date().toISOString(),
    };

    const row: RoadStopRow = {
      id: pending.id,
      status: 'PENDING_REVIEW',
      highway_code: pending.highwayCode,
      km_marker: pending.kmMarker,
      lat: pending.coordinates.lat,
      lon: pending.coordinates.lon,
      payload: pending,
    };

    await fetch(`${this.baseUrl}/rest/v1/road_stops`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(row),
    });

    return pending;
  }

  async listPending(): Promise<RoadStopEntity[]> {
    try {
      const params = new URLSearchParams({
        select: 'payload',
        status: 'eq.PENDING_REVIEW',
        order: 'updated_at.desc',
      });
      const res = await fetch(
        `${this.baseUrl}/rest/v1/road_stops?${params.toString()}`,
        { headers: this.buildHeaders() }
      );
      if (!res.ok) return [];
      const rows = (await res.json()) as { payload: RoadStopEntity }[];
      return rows.map((r) => r.payload);
    } catch {
      return [];
    }
  }

  async approvePending(stopId: string): Promise<RoadStopEntity | null> {
    try {
      const getParams = new URLSearchParams({
        select: 'payload',
        id: `eq.${stopId}`,
        status: 'eq.PENDING_REVIEW',
        limit: '1',
      });
      const getRes = await fetch(
        `${this.baseUrl}/rest/v1/road_stops?${getParams.toString()}`,
        { headers: this.buildHeaders() }
      );
      if (!getRes.ok) return null;
      const rows = (await getRes.json()) as { payload: RoadStopEntity }[];
      if (!rows.length) return null;

      const approved: RoadStopEntity = {
        ...rows[0].payload,
        dataQuality: 'VERIFIED',
        cachedAtIso: new Date().toISOString(),
      };

      const patchParams = new URLSearchParams({ id: `eq.${stopId}` });
      const patchRes = await fetch(
        `${this.baseUrl}/rest/v1/road_stops?${patchParams.toString()}`,
        {
          method: 'PATCH',
          headers: this.buildHeaders(),
          body: JSON.stringify({
            status: 'APPROVED',
            payload: approved,
            updated_at: new Date().toISOString(),
          }),
        }
      );
      if (!patchRes.ok) return null;
      return approved;
    } catch {
      return null;
    }
  }

  async rejectPending(stopId: string): Promise<boolean> {
    try {
      const params = new URLSearchParams({
        id: `eq.${stopId}`,
        status: 'eq.PENDING_REVIEW',
      });
      const res = await fetch(
        `${this.baseUrl}/rest/v1/road_stops?${params.toString()}`,
        {
          method: 'DELETE',
          headers: this.buildHeaders({ Prefer: 'return=representation' }),
        }
      );
      if (!res.ok) return false;
      const deleted = (await res.json()) as unknown[];
      return deleted.length > 0;
    } catch {
      return false;
    }
  }

  async getAllActiveStops(): Promise<RoadStopEntity[]> {
    const merged = new Map<string, RoadStopEntity>();
    for (const seed of DEMO_STOPS) {
      merged.set(seed.id, seed);
    }

    try {
      const params = new URLSearchParams({
        select: 'id,payload',
        status: 'eq.APPROVED',
      });
      const res = await fetch(
        `${this.baseUrl}/rest/v1/road_stops?${params.toString()}`,
        { headers: this.buildHeaders() }
      );
      if (res.ok) {
        const rows = (await res.json()) as RoadStopRow[];
        for (const r of rows) {
          merged.set(r.id, r.payload);
        }
      }
    } catch {
      // Fallback al catálogo semilla
    }

    return Array.from(merged.values());
  }

  private buildMonthKey(providerKey: string, now = new Date()): string {
    const yyyyMm = now.toISOString().slice(0, 7);
    return `${yyyyMm}:${providerKey}`;
  }

  async incrementMonthlyQuotaIfBelow(
    providerKey: string,
    maxMonthlyCalls: number,
    now = new Date()
  ): Promise<boolean> {
    const key = this.buildMonthKey(providerKey, now);
    const used = await this.getMonthlyQuotaUsed(providerKey, now);
    if (used >= maxMonthlyCalls) return false;

    try {
      const row: QuotaRow = {
        month_key: key,
        used_calls: used + 1,
      };
      const res = await fetch(`${this.baseUrl}/rest/v1/monthly_quotas`, {
        method: 'POST',
        headers: this.buildHeaders({
          Prefer: 'resolution=merge-duplicates',
        }),
        body: JSON.stringify(row),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getMonthlyQuotaUsed(
    providerKey: string,
    now = new Date()
  ): Promise<number> {
    const key = this.buildMonthKey(providerKey, now);
    try {
      const params = new URLSearchParams({
        select: 'used_calls',
        month_key: `eq.${key}`,
        limit: '1',
      });
      const res = await fetch(
        `${this.baseUrl}/rest/v1/monthly_quotas?${params.toString()}`,
        { headers: this.buildHeaders() }
      );
      if (!res.ok) return 0;
      const rows = (await res.json()) as QuotaRow[];
      return rows.length > 0 ? Number(rows[0].used_calls) : 0;
    } catch {
      return 0;
    }
  }
}
