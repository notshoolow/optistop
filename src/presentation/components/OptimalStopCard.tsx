'use client';

import React from 'react';
import {
  AccessType,
  EvaluatedOptimalStop,
  PriceLevel,
} from '@/domain/models/types';
import { buildGoogleReviewsUrl } from '@/domain/navigation/deep-links';
import {
  Zap,
  Fuel,
  Clock,
  Star,
  PawPrint,
  ArrowUpRight,
  ChevronDown,
  Navigation,
  Sparkles,
} from 'lucide-react';

interface OptimalStopCardProps {
  stop: EvaluatedOptimalStop;
  rank: number;
  isSelected: boolean;
  onSelect: () => void;
}

const ACCESS_LABELS: Record<AccessType, string> = {
  DIRECT_SERVICE_AREA: 'Acceso directo en la vía',
  HIGHWAY_EXIT_EASY: 'Salida rápida (rotonda inmediata)',
  OPPOSITE_DIRECTION_OVERPASS: 'Cambio de sentido por paso superior',
  TOWN_ENTRY: 'Entrada a localidad cercana',
};

function formatPriceSymbol(level: PriceLevel | null): string {
  if (level === 1) return '€';
  if (level === 2) return '€€';
  if (level === 3) return '€€€';
  return '';
}

function formatCompactReviews(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1).replace('.', ',')}k`;
  }
  return String(count);
}

export function OptimalStopCard({
  stop,
  rank,
  isSelected,
  onSelect,
}: OptimalStopCardProps) {
  const detourMin = stop.routeMetrics.detourTimeMinutes;
  const priceSymbol = formatPriceSymbol(stop.priceLevel);

  return (
    <article
      className={`rounded-2xl border transition-all duration-200 ${
        isSelected
          ? 'bg-white border-[#165b40] shadow-md ring-1 ring-[#165b40]/20'
          : 'bg-[#fcfbf8] hover:bg-white border-[#e6e2d8] hover:border-[#cfc9bb]'
      }`}
    >
      {/* NIVEL 1: VISTA ESCANEABLE ULTRA-LIMPIA (4 datos clave en 3 segundos) */}
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={isSelected}
        className="w-full text-left p-4 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#165b40] rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          {/* Ranking + Nombre + Localidad sutil */}
          <div className="flex items-start gap-3 min-w-0">
            <span
              className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                rank === 1
                  ? 'bg-[#165b40] text-white'
                  : isSelected
                  ? 'bg-[#181816] text-white'
                  : 'bg-[#eae6dc] text-[#181816]'
              }`}
            >
              {rank}
            </span>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-medium text-[#5c5a54]">
                <span className="font-semibold text-[#181816]">
                  {stop.highwayCode}
                </span>
                <span>·</span>
                <span className="truncate">{stop.locality}</span>
                <span>·</span>
                <span>{stop.routeMetrics.estimatedArrivalClock}</span>
              </div>

              <h3 className="text-[15px] font-bold text-[#181816] leading-snug mt-0.5 line-clamp-1">
                {stop.name}
              </h3>
            </div>
          </div>

          {/* Píldora protagonista: Desvío Real */}
          <span
            className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
              detourMin <= 3
                ? 'bg-[#e6f2ed] text-[#114a33]'
                : detourMin <= 6
                ? 'bg-[#fef3c7] text-[#92400e]'
                : 'bg-[#ffedd5] text-[#9a3412]'
            }`}
          >
            <Clock className="w-3 h-3" />+{detourMin} min
          </span>
        </div>

        {/* Especialidad en 1 sola línea limpia */}
        <p className="mt-2 pl-9 text-xs text-[#5c5a54] line-clamp-1">
          {stop.specialty}
        </p>

        {/* Pie compacto: Nota + Precio + Iconos diferenciales */}
        <div className="mt-3 pl-9 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs">
            {stop.ratingAvg !== null && stop.reviewCount > 0 ? (
              <a
                href={buildGoogleReviewsUrl(
                  stop.coordinates,
                  stop.name,
                  stop.googlePlaceId,
                  stop.googleMapsPlaceUrl
                )}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title="Ver opiniones reales y fotos en Google Maps"
                className="group/rating inline-flex items-center gap-1 font-bold text-[#181816] hover:text-[#1a73e8] hover:underline transition-colors"
              >
                <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-600 group-hover/rating:scale-110 transition-transform" />
                <span>{stop.scoring.bayesianRating}</span>
                <span className="font-normal text-[#5c5a54] group-hover/rating:text-[#1a73e8]">
                  ({formatCompactReviews(stop.reviewCount)})
                </span>
                <ArrowUpRight className="w-3 h-3 text-[#5c5a54] opacity-60 group-hover/rating:opacity-100 group-hover/rating:text-[#1a73e8] -ml-0.5" />
              </a>
            ) : (
              <span className="text-xs text-[#5c5a54]">Nuevo en ruta</span>
            )}

            {priceSymbol && (
              <>
                <span className="text-[#cfc9bb]">·</span>
                <span className="font-semibold text-[#165b40]">
                  {priceSymbol}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {stop.amenities.hasEvChargerNearby === true && (
              <span
                title={stop.amenities.evChargerDetails || 'Cargador EV cercano'}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#eef6ff] text-[#1e40af]"
              >
                <Zap className="w-3 h-3" />
                EV
              </span>
            )}
            {stop.amenities.hasGasStationOnsite === true && (
              <span
                title={
                  stop.amenities.gasStationBrand
                    ? `Gasolinera ${stop.amenities.gasStationBrand}`
                    : 'Gasolinera en el área'
                }
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#fef3c7]/70 text-[#92400e]"
              >
                <Fuel className="w-3 h-3" />
                {stop.amenities.gasStationBrand || 'Gas'}
              </span>
            )}
            {stop.amenities.isPetFriendly === true && (
              <span
                title="Terraza / Admite mascotas"
                className="inline-flex items-center p-1 rounded-md text-[#5c5a54] bg-[#f4f1ea]"
              >
                <PawPrint className="w-3 h-3" />
              </span>
            )}
            <ChevronDown
              className={`w-4 h-4 text-[#5c5a54] transition-transform duration-200 ml-0.5 ${
                isSelected ? 'rotate-180 text-[#181816]' : ''
              }`}
            />
          </div>
        </div>
      </button>

      {/* NIVEL 2: REVELACIÓN PROGRESIVA (Solo visible cuando la tarjeta está activa) */}
      {isSelected && (
        <div className="px-4 pb-4 pt-2 pl-13 border-t border-[#efece6] space-y-3 text-xs">
          {/* Metadatos de acceso en carretera y puntuación */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[#5c5a54]">
            <span>
              <strong className="text-[#181816]">
                {ACCESS_LABELS[stop.accessType]}
              </strong>{' '}
              · PK {stop.kmMarker} ({stop.routeMetrics.distanceFromOriginKm} km)
            </span>
            <div className="flex items-center gap-1.5">
              {stop.source === 'GOOGLE_CACHED' || stop.googlePlaceId ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#e8f0fe] text-[#1a73e8] font-semibold text-[11px]">
                  ✓ Google Maps
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#f4f1ea] text-[#181816] font-semibold">
                <Sparkles className="w-3 h-3 text-[#165b40]" />
                Índice {stop.scoring.optiStopScore}/100
              </span>
            </div>
          </div>

          <p className="text-[#5c5a54]">
            {stop.directionNotes} · Horario: {stop.openingHours}
            {stop.amenities.evChargerDetails
              ? ` · ⚡ ${stop.amenities.evChargerDetails}`
              : ''}
          </p>

          {/* Barra de acción limpia: 1 CTA principal + 2 alternativos */}
          <div className="pt-1 flex flex-wrap items-center gap-2">
            <a
              href={stop.navigationLinks.googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[42px] rounded-xl text-xs font-bold bg-[#165b40] hover:bg-[#114a33] text-white shadow-xs transition-colors"
            >
              <Navigation className="w-3.5 h-3.5" />
              <span>Añadir parada en Google Maps</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>

            <a
              href={stop.navigationLinks.wazeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1 px-3 py-2.5 min-h-[42px] rounded-xl text-xs font-semibold bg-[#f4f1ea] hover:bg-[#e6e2d8] text-[#181816] transition-colors"
            >
              <span>Waze</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[#5c5a54]" />
            </a>

            <a
              href={stop.navigationLinks.appleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1 px-3 py-2.5 min-h-[42px] rounded-xl text-xs font-semibold bg-[#f4f1ea] hover:bg-[#e6e2d8] text-[#181816] transition-colors"
            >
              <span>Apple</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[#5c5a54]" />
            </a>
          </div>
        </div>
      )}
    </article>
  );
}
