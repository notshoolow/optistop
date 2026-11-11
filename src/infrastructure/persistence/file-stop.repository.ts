import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  CorridorBoundingBox,
  IStopCacheRepositoryPort,
} from '@/domain/models/ports';
import {
  CommunityStopSubmission,
  RoadStopEntity,
} from '@/domain/models/types';
import { projectStopOntoCorridor } from '@/domain/geometry/corridor-slicer';
import { DEMO_STOPS } from './demo-stops.seed';

interface CorridorCacheMeta {
  corridorHash: string;
  cachedAtMs: number;
  stopIds: string[];
}

interface PersistedStoreSchema {
  version: 1;
  approvedStops: RoadStopEntity[];
  pendingStops: RoadStopEntity[];
  corridors: Record<string, CorridorCacheMeta>;
  monthlyQuotas: Record<string, number>;
}

export interface FileStopRepositoryOptions {
  /**
   * Directorio donde se guarda `store.json`.
   * Si es `null` o `':memory:'`, opera solo en memoria (útil para tests aislados).
   */
  dataDir?: string | null;
  includeDemo?: boolean;
  cacheTtlMs?: number;
}

/**
 * Repositorio Hexagonal con persistencia atómica en disco (`data/store.json`, RNF-07.1)
 * y control de cuota mensual (`YYYY-MM`, RNF-07.2).
 */
export class FileStopRepository implements IStopCacheRepositoryPort {
  private readonly storeFilePath: string | null;
  private readonly cacheTtlMs: number;
  private approvedStops = new Map<string, RoadStopEntity>();
  private pendingStops = new Map<string, RoadStopEntity>();
  private corridorRegistry = new Map<string, CorridorCacheMeta>();
  private monthlyQuotas = new Map<string, number>();

  constructor(options?: FileStopRepositoryOptions) {
    const rawDir =
      options?.dataDir !== undefined
        ? options.dataDir
        : process.env.OPTISTOP_DATA_DIR ?? path.join(process.cwd(), 'data');

    this.storeFilePath =
      rawDir === null || rawDir === ':memory:'
        ? null
        : path.join(rawDir, 'store.json');

    this.cacheTtlMs = options?.cacheTtlMs ?? 1000 * 60 * 60 * 24 * 30;
    const includeDemo = options?.includeDemo ?? true;

    if (includeDemo) {
      for (const stop of DEMO_STOPS) {
        this.approvedStops.set(stop.id, stop);
      }
    }

    this.loadFromDiskSync();
  }

  private loadFromDiskSync(): void {
    if (!this.storeFilePath || !existsSync(this.storeFilePath)) return;
    try {
      const content = readFileSync(this.storeFilePath, 'utf-8');
      const parsed = JSON.parse(content) as Partial<PersistedStoreSchema>;

      if (Array.isArray(parsed.approvedStops)) {
        for (const s of parsed.approvedStops) {
          this.approvedStops.set(s.id, s);
        }
      }
      if (Array.isArray(parsed.pendingStops)) {
        for (const p of parsed.pendingStops) {
          this.pendingStops.set(p.id, p);
        }
      }
      if (parsed.corridors && typeof parsed.corridors === 'object') {
        for (const [k, v] of Object.entries(parsed.corridors)) {
          this.corridorRegistry.set(k, v);
        }
      }
      if (parsed.monthlyQuotas && typeof parsed.monthlyQuotas === 'object') {
        for (const [k, v] of Object.entries(parsed.monthlyQuotas)) {
          this.monthlyQuotas.set(k, Number(v) || 0);
        }
      }
    } catch {
      // Si el fichero está corrupto, mantenemos el estado en memoria sin bloquear el arranque
    }
  }

  private async persistToDisk(): Promise<void> {
    if (!this.storeFilePath) return;
    const dir = path.dirname(this.storeFilePath);
    await mkdir(dir, { recursive: true });

    const payload: PersistedStoreSchema = {
      version: 1,
      approvedStops: Array.from(this.approvedStops.values()),
      pendingStops: Array.from(this.pendingStops.values()),
      corridors: Object.fromEntries(this.corridorRegistry.entries()),
      monthlyQuotas: Object.fromEntries(this.monthlyQuotas.entries()),
    };

    const tmpFile = `${this.storeFilePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpFile, JSON.stringify(payload, null, 2), 'utf-8');
    await rename(tmpFile, this.storeFilePath);
  }

  async findStopsInCorridor(
    corridor: CorridorBoundingBox
  ): Promise<RoadStopEntity[]> {
    const matches: RoadStopEntity[] = [];

    for (const stop of this.approvedStops.values()) {
      // Nunca devolver propuestas pendientes de moderación
      if (stop.dataQuality === 'COMMUNITY_PENDING') continue;

      const { lat, lon } = stop.coordinates;
      if (
        lat < corridor.minLat ||
        lat > corridor.maxLat ||
        lon < corridor.minLon ||
        lon > corridor.maxLon
      ) {
        continue;
      }

      const proj = projectStopOntoCorridor(
        stop.coordinates,
        corridor.polyline,
        corridor.maxRadiusKm
      );
      if (proj.isWithinCorridor) {
        matches.push(stop);
      }
    }

    return matches;
  }

  async saveOrUpdateStops(
    stops: RoadStopEntity[],
    corridorHash: string
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const stopIds: string[] = [];

    for (const stop of stops) {
      // No sobrescribir paradas VERIFIED ni DEMO con datos no verificados
      const existing = this.approvedStops.get(stop.id);
      if (existing && existing.dataQuality === 'VERIFIED') {
        stopIds.push(existing.id);
        continue;
      }

      const enriched: RoadStopEntity = {
        ...stop,
        cachedAtIso: stop.cachedAtIso ?? nowIso,
      };
      this.approvedStops.set(stop.id, enriched);
      stopIds.push(stop.id);
    }

    this.corridorRegistry.set(corridorHash, {
      corridorHash,
      cachedAtMs: Date.now(),
      stopIds,
    });

    await this.persistToDisk();
  }

  async hasFreshCorridorCoverage(corridorHash: string): Promise<boolean> {
    const entry = this.corridorRegistry.get(corridorHash);
    if (!entry) return false;
    return Date.now() - entry.cachedAtMs <= this.cacheTtlMs;
  }

  /**
   * RNF-05.2: Registra una propuesta comunitaria en cola de moderación (`COMMUNITY_PENDING`).
   * El servidor genera el UUID y nunca acepta `ratingAvg` ni `reviewCount` del cliente.
   */
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

    this.pendingStops.set(pending.id, pending);
    await this.persistToDisk();
    return pending;
  }

  async listPending(): Promise<RoadStopEntity[]> {
    return Array.from(this.pendingStops.values());
  }

  async approvePending(stopId: string): Promise<RoadStopEntity | null> {
    const found = this.pendingStops.get(stopId);
    if (!found) return null;

    this.pendingStops.delete(stopId);
    const approved: RoadStopEntity = {
      ...found,
      dataQuality: 'VERIFIED',
      cachedAtIso: new Date().toISOString(),
    };
    this.approvedStops.set(approved.id, approved);
    await this.persistToDisk();
    return approved;
  }

  async rejectPending(stopId: string): Promise<boolean> {
    if (!this.pendingStops.has(stopId)) return false;
    this.pendingStops.delete(stopId);
    await this.persistToDisk();
    return true;
  }

  async getAllActiveStops(): Promise<RoadStopEntity[]> {
    return Array.from(this.approvedStops.values());
  }

  private buildMonthKey(providerKey: string, now = new Date()): string {
    const yyyyMm = now.toISOString().slice(0, 7); // YYYY-MM en UTC
    return `${yyyyMm}:${providerKey}`;
  }

  async incrementMonthlyQuotaIfBelow(
    providerKey: string,
    maxMonthlyCalls: number,
    now = new Date()
  ): Promise<boolean> {
    const key = this.buildMonthKey(providerKey, now);
    const used = this.monthlyQuotas.get(key) ?? 0;
    if (used >= maxMonthlyCalls) {
      return false;
    }
    this.monthlyQuotas.set(key, used + 1);
    await this.persistToDisk();
    return true;
  }

  async getMonthlyQuotaUsed(
    providerKey: string,
    now = new Date()
  ): Promise<number> {
    const key = this.buildMonthKey(providerKey, now);
    return this.monthlyQuotas.get(key) ?? 0;
  }
}

export { readFile };
