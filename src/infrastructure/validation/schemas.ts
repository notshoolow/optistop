import { z } from 'zod';
import { assertValidTimeZone, DEFAULT_TIME_ZONE } from '@/domain/time/clock';

/**
 * RNF-05.1: Coordenadas acotadas al territorio español (Península, Baleares, Canarias, Ceuta y Melilla).
 */
export const SpainCoordinatesSchema = z
  .object({
    lat: z.number().finite().min(27.0).max(44.5),
    lon: z.number().finite().min(-18.5).max(4.5),
  })
  .strict();

export const LabeledCoordinatesSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    lat: z.number().finite().min(27.0).max(44.5),
    lon: z.number().finite().min(-18.5).max(4.5),
  })
  .strict();

export const TimeZoneSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .refine(
    (tz) => {
      try {
        assertValidTimeZone(tz);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Zona horaria IANA inválida' }
  );

export const StopWindowSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('TIME_FROM_START'),
      minMinutesFromStart: z.number().finite().min(0).max(900),
      maxMinutesFromStart: z.number().finite().min(5).max(960),
    })
    .strict(),
  z
    .object({
      type: z.literal('CLOCK_RANGE'),
      clockStartHHMM: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      clockEndHHMM: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    })
    .strict(),
  z
    .object({
      type: z.literal('DISTANCE_RANGE'),
      minDistanceKm: z.number().finite().min(0).max(1500),
      maxDistanceKm: z.number().finite().min(5).max(1600),
    })
    .strict(),
]);

export const StopCategorySchema = z.enum([
  'RESTAURANT',
  'CAFE_BAKERY',
  'SERVICE_AREA',
  'REST_AREA_PICNIC',
]);

export const AccessTypeSchema = z.enum([
  'DIRECT_SERVICE_AREA',
  'HIGHWAY_EXIT_EASY',
  'OPPOSITE_DIRECTION_OVERPASS',
  'TOWN_ENTRY',
]);

export const PriceLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

export const RequiredAmenitiesFilterSchema = z
  .object({
    hasEvChargerNearby: z.boolean().optional(),
    hasGasStationOnsite: z.boolean().optional(),
    hasEasyParking: z.boolean().optional(),
    hasCleanRestrooms: z.boolean().optional(),
    isPetFriendly: z.boolean().optional(),
    hasKidsArea: z.boolean().optional(),
    hasTruckParking: z.boolean().optional(),
    hasWifi: z.boolean().optional(),
  })
  .strict();

export const StopSearchFiltersSchema = z
  .object({
    categories: z.array(StopCategorySchema).max(4).optional(),
    maxPriceLevel: PriceLevelSchema.optional(),
    maxDetourMinutes: z.number().finite().min(1).max(45).optional(),
    requiredAmenities: RequiredAmenitiesFilterSchema.optional(),
  })
  .strict();

export const OptimalStopsRequestSchema = z
  .object({
    mode: z.enum(['PLANNING', 'EN_ROUTE']).default('PLANNING'),
    origin: LabeledCoordinatesSchema,
    destination: LabeledCoordinatesSchema,
    departureTimeIso: z
      .string()
      .refine((v) => !Number.isNaN(new Date(v).getTime()), {
        message: 'departureTimeIso inválido',
      })
      .optional(),
    timeZone: TimeZoneSchema.default(DEFAULT_TIME_ZONE),
    stopWindow: StopWindowSchema,
    filters: StopSearchFiltersSchema.optional(),
    limit: z.number().int().min(1).max(8).default(5),
  })
  .strict();

/**
 * RNF-05.2: Esquema estricto para propuestas comunitarias (`POST /api/stops`).
 * Prohibido enviar `id`, `ratingAvg`, `reviewCount`, `source` o `dataQuality` (.strict() los rechaza con 422).
 */
export const CommunityStopSubmissionSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    highwayCode: z
      .string()
      .trim()
      .regex(/^(A|AP|N|E|CV|CM|CL|EX|A-)\s?-?\d{1,4}[A-Z]?$/i, {
        message: 'Código de vía inválido (ej. A-3, AP-7, N-340)',
      }),
    kmMarker: z.number().int().min(0).max(1500),
    locality: z.string().trim().min(2).max(120),
    coordinates: SpainCoordinatesSchema,
    category: StopCategorySchema,
    accessType: AccessTypeSchema,
    directionNotes: z.string().trim().max(240).optional(),
    priceLevel: PriceLevelSchema.nullable().optional(),
    specialty: z.string().trim().max(300).optional(),
    avgStopDurationMin: z.number().int().min(5).max(180).optional(),
    openingHours: z.string().trim().max(100).optional(),
    amenities: z
      .object({
        hasEvChargerNearby: z.boolean().nullable().optional(),
        evChargerDetails: z.string().trim().max(120).optional(),
        hasGasStationOnsite: z.boolean().nullable().optional(),
        gasStationBrand: z.string().trim().max(60).optional(),
        hasEasyParking: z.boolean().nullable().optional(),
        hasCleanRestrooms: z.boolean().nullable().optional(),
        isPetFriendly: z.boolean().nullable().optional(),
        hasKidsArea: z.boolean().nullable().optional(),
        hasTruckParking: z.boolean().nullable().optional(),
        hasWifi: z.boolean().nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
