'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  OptimalStopsRequest,
  OptimalStopsResponse,
  PriceLevel,
  StopWindowMode,
} from '@/domain/models/types';
import { OptimalStopCard } from '@/presentation/components/OptimalStopCard';
import { AddCuratedStopModal } from '@/presentation/components/AddCuratedStopModal';
import {
  LocationAutocompleteInput,
  PlaceOption,
} from '@/presentation/components/LocationAutocompleteInput';
import {
  Compass,
  Navigation2,
  Clock,
  Zap,
  Fuel,
  PawPrint,
  LocateFixed,
  Route as RouteIcon,
  AlertTriangle,
  WifiOff,
  RefreshCw,
  SlidersHorizontal,
  ArrowRight,
  ChevronDown,
} from 'lucide-react';

const RouteMap = dynamic(
  () =>
    import('@/presentation/components/RouteMap').then((mod) => mod.RouteMap),
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        aria-label="Cargando mapa interactivo"
        className="w-full h-full bg-[#eae6dc] animate-pulse flex items-center justify-center text-xs font-semibold text-[#5c5a54]"
      >
        Cargando mapa de ruta...
      </div>
    ),
  }
);

interface CorridorPreset {
  id: string;
  title: string;
  highway: string;
  origin: PlaceOption;
  destination: PlaceOption;
  defaultWindowMin: number;
  defaultWindowMax: number;
}

const CORRIDOR_PRESETS: CorridorPreset[] = [
  {
    id: 'a3-mad-vlc',
    title: 'Madrid → Valencia',
    highway: 'A-3',
    origin: { label: 'Madrid', lat: 40.4168, lon: -3.7038 },
    destination: { label: 'Valencia', lat: 39.4699, lon: -0.3763 },
    defaultWindowMin: 50,
    defaultWindowMax: 115,
  },
  {
    id: 'a1-mad-bur',
    title: 'Madrid → Burgos',
    highway: 'A-1',
    origin: { label: 'Madrid', lat: 40.4168, lon: -3.7038 },
    destination: { label: 'Burgos', lat: 42.344, lon: -3.6969 },
    defaultWindowMin: 55,
    defaultWindowMax: 115,
  },
  {
    id: 'a2-mad-zgz',
    title: 'Madrid → Zaragoza',
    highway: 'A-2',
    origin: { label: 'Madrid', lat: 40.4168, lon: -3.7038 },
    destination: { label: 'Zaragoza', lat: 41.6488, lon: -0.8891 },
    defaultWindowMin: 50,
    defaultWindowMax: 110,
  },
  {
    id: 'a4-mad-sev',
    title: 'Madrid → Sevilla',
    highway: 'A-4',
    origin: { label: 'Madrid', lat: 40.4168, lon: -3.7038 },
    destination: { label: 'Sevilla', lat: 37.3891, lon: -5.9845 },
    defaultWindowMin: 80,
    defaultWindowMax: 165,
  },
  {
    id: 'a6-mad-cor',
    title: 'Madrid → A Coruña',
    highway: 'A-6',
    origin: { label: 'Madrid', lat: 40.4168, lon: -3.7038 },
    destination: { label: 'A Coruña', lat: 43.3623, lon: -8.4115 },
    defaultWindowMin: 75,
    defaultWindowMax: 160,
  },
  {
    id: 'a5-mad-bad',
    title: 'Madrid → Badajoz',
    highway: 'A-5',
    origin: { label: 'Madrid', lat: 40.4168, lon: -3.7038 },
    destination: { label: 'Badajoz', lat: 38.8794, lon: -6.9707 },
    defaultWindowMin: 75,
    defaultWindowMax: 155,
  },
  {
    id: 'ap7-bcn-vlc',
    title: 'Barcelona → Valencia',
    highway: 'AP-7',
    origin: { label: 'Barcelona', lat: 41.3874, lon: 2.1686 },
    destination: { label: 'Valencia', lat: 39.4699, lon: -0.3763 },
    defaultWindowMin: 65,
    defaultWindowMax: 145,
  },
  {
    id: 'a7-vlc-agp',
    title: 'Valencia → Málaga',
    highway: 'A-7',
    origin: { label: 'Valencia', lat: 39.4699, lon: -0.3763 },
    destination: { label: 'Málaga', lat: 36.7213, lon: -4.4214 },
    defaultWindowMin: 90,
    defaultWindowMax: 180,
  },
  {
    id: 'a8-bio-gij',
    title: 'Bilbao → Gijón',
    highway: 'A-8',
    origin: { label: 'Bilbao', lat: 43.263, lon: -2.935 },
    destination: { label: 'Gijón', lat: 43.5357, lon: -5.6615 },
    defaultWindowMin: 60,
    defaultWindowMax: 130,
  },
  {
    id: 'a66-sev-len',
    title: 'Sevilla → León (Ruta de la Plata)',
    highway: 'A-66',
    origin: { label: 'Sevilla', lat: 37.3891, lon: -5.9845 },
    destination: { label: 'León', lat: 42.5987, lon: -5.5671 },
    defaultWindowMin: 100,
    defaultWindowMax: 200,
  },
  {
    id: 'a92-sev-grx',
    title: 'Sevilla → Granada',
    highway: 'A-92',
    origin: { label: 'Sevilla', lat: 37.3891, lon: -5.9845 },
    destination: { label: 'Granada', lat: 37.1773, lon: -3.5986 },
    defaultWindowMin: 60,
    defaultWindowMax: 130,
  },
  {
    id: 'ap68-zaz-bio',
    title: 'Zaragoza → Bilbao',
    highway: 'AP-68',
    origin: { label: 'Zaragoza', lat: 41.6488, lon: -0.8891 },
    destination: { label: 'Bilbao', lat: 43.263, lon: -2.935 },
    defaultWindowMin: 60,
    defaultWindowMax: 140,
  },
];

const EN_ROUTE_GPS_SIMULATIONS = [
  {
    label: 'A-3 pasando Tarancón (hacia Valencia)',
    origin: { label: 'En ruta A-3 (PK 78)', lat: 40.0085, lon: -3.0072 },
    destination: { label: 'Valencia', lat: 39.4699, lon: -0.3763 },
  },
  {
    label: 'A-1 pasando Boceguillas (hacia Burgos)',
    origin: { label: 'En ruta A-1 (PK 110)', lat: 41.31, lon: -3.635 },
    destination: { label: 'Burgos', lat: 42.344, lon: -3.6969 },
  },
  {
    label: 'A-2 pasando Guadalajara (hacia Zaragoza)',
    origin: { label: 'En ruta A-2 (PK 62)', lat: 40.65, lon: -3.14 },
    destination: { label: 'Zaragoza', lat: 41.6488, lon: -0.8891 },
  },
  {
    label: 'A-4 pasando Puerto Lápice (hacia Sevilla)',
    origin: { label: 'En ruta A-4 (PK 135)', lat: 39.32, lon: -3.48 },
    destination: { label: 'Sevilla', lat: 37.3891, lon: -5.9845 },
  },
  {
    label: 'AP-7 pasando Tarragona (hacia Valencia)',
    origin: { label: 'En ruta AP-7 (PK 105)', lat: 41.1189, lon: 1.1545 },
    destination: { label: 'Valencia', lat: 39.4699, lon: -0.3763 },
  },
];

function buildClientDepartureIso(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  const now = new Date();
  if (Number.isFinite(h) && Number.isFinite(m)) {
    now.setHours(h, m, 0, 0);
  }
  return now.toISOString();
}

export default function OptiStopHomePage() {
  const [mode, setMode] = useState<'PLANNING' | 'EN_ROUTE'>('PLANNING');
  const [isEditingRoute, setIsEditingRoute] = useState(false);
  const [showCustomWindow, setShowCustomWindow] = useState(false);

  const [origin, setOrigin] = useState<PlaceOption>(CORRIDOR_PRESETS[0].origin);
  const [destination, setDestination] = useState<PlaceOption>(
    CORRIDOR_PRESETS[0].destination
  );
  const [departureHHMM, setDepartureHHMM] = useState('12:30');

  const [windowType, setWindowType] =
    useState<StopWindowMode>('TIME_FROM_START');
  const [minMinutes, setMinMinutes] = useState(50);
  const [maxMinutes, setMaxMinutes] = useState(115);
  const [clockStart, setClockStart] = useState('14:00');
  const [clockEnd, setClockEnd] = useState('15:00');
  const [minKm, setMinKm] = useState(80);
  const [maxKm, setMaxKm] = useState(180);

  // 4 filtros esenciales y limpios
  const [requireEvCharger, setRequireEvCharger] = useState(false);
  const [requireGasStation, setRequireGasStation] = useState(false);
  const [requirePetFriendly, setRequirePetFriendly] = useState(false);
  const [maxPriceLevel, setMaxPriceLevel] = useState<PriceLevel>(3);

  const [data, setData] = useState<OptimalStopsResponse | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<string | null>(null);
  const [isWatchingGps, setIsWatchingGps] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const gpsWatchIdRef = useRef<number | null>(null);
  const lastGpsCoordsRef = useRef<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    return () => {
      if (gpsWatchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setIsOffline(!navigator.onLine);
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const executeSearch = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const clientTimeZone =
          Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid';
        const departureTimeIso =
          mode === 'EN_ROUTE'
            ? new Date().toISOString()
            : buildClientDepartureIso(departureHHMM);

        const safeMinMinutes = Math.max(0, Math.min(900, minMinutes || 0));
        const safeMaxMinutes = Math.max(
          safeMinMinutes + 10,
          Math.min(960, maxMinutes || 60)
        );
        const safeMinKm = Math.max(0, Math.min(1500, minKm || 0));
        const safeMaxKm = Math.max(safeMinKm + 10, Math.min(1600, maxKm || 60));

        const payload: OptimalStopsRequest = {
          mode,
          origin,
          destination,
          departureTimeIso,
          timeZone: clientTimeZone,
          stopWindow:
            windowType === 'CLOCK_RANGE'
              ? {
                  type: 'CLOCK_RANGE',
                  clockStartHHMM: clockStart,
                  clockEndHHMM: clockEnd,
                }
              : windowType === 'DISTANCE_RANGE'
              ? {
                  type: 'DISTANCE_RANGE',
                  minDistanceKm: safeMinKm,
                  maxDistanceKm: safeMaxKm,
                }
              : {
                  type: 'TIME_FROM_START',
                  minMinutesFromStart: safeMinMinutes,
                  maxMinutesFromStart: safeMaxMinutes,
                },
          filters: {
            maxPriceLevel,
            requiredAmenities: {
              hasEvChargerNearby: requireEvCharger || undefined,
              hasGasStationOnsite: requireGasStation || undefined,
              isPetFriendly: requirePetFriendly || undefined,
            },
          },
          limit: 5,
        };

        const res = await fetch('/api/routes/optimal-stops', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal,
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(
            errBody.error || `Error del servidor (HTTP ${res.status})`
          );
        }

        const result = (await res.json()) as OptimalStopsResponse;
        setData(result);
        setSelectedStopId(
          result.optimalStops.length > 0 ? result.optimalStops[0].id : null
        );
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'No se pudo completar la búsqueda de paradas.'
        );
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
        }
      }
    },
    [
      mode,
      origin,
      destination,
      departureHHMM,
      windowType,
      minMinutes,
      maxMinutes,
      clockStart,
      clockEnd,
      minKm,
      maxKm,
      maxPriceLevel,
      requireEvCharger,
      requireGasStation,
      requirePetFriendly,
    ]
  );

  useEffect(() => {
    abortControllerRef.current?.abort();
    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;

    const timer = setTimeout(() => {
      executeSearch(ctrl.signal);
    }, 350);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [executeSearch]);

  function stopGpsWatch() {
    if (gpsWatchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      gpsWatchIdRef.current = null;
    }
    setIsWatchingGps(false);
  }

  function handleSelectPreset(preset: CorridorPreset) {
    stopGpsWatch();
    setMode('PLANNING');
    setOrigin(preset.origin);
    setDestination(preset.destination);
    setWindowType('TIME_FROM_START');
    setMinMinutes(preset.defaultWindowMin);
    setMaxMinutes(preset.defaultWindowMax);
    setShowCustomWindow(false);
    setIsEditingRoute(false);
  }

  function handleActivateRealGps() {
    if (isWatchingGps) {
      stopGpsWatch();
      setGpsStatus('Seguimiento GPS pausado');
      return;
    }
    if (!navigator.geolocation) {
      setGpsStatus('GPS no soportado en este navegador');
      return;
    }

    setGpsStatus('Localizando en vivo...');
    setIsWatchingGps(true);

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const nextLat = Number(pos.coords.latitude.toFixed(4));
        const nextLon = Number(pos.coords.longitude.toFixed(4));
        const prev = lastGpsCoordsRef.current;

        if (prev) {
          // RF-08: Solo recalcular cuando el vehículo haya avanzado >= 1.5 km
          const dLat = ((nextLat - prev.lat) * Math.PI) / 180;
          const dLon = ((nextLon - prev.lon) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos((prev.lat * Math.PI) / 180) *
              Math.cos((nextLat * Math.PI) / 180) *
              Math.sin(dLon / 2) ** 2;
          const movedKm = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
          if (movedKm < 1.5) return;
        }

        lastGpsCoordsRef.current = { lat: nextLat, lon: nextLon };
        setOrigin({
          label: 'Mi ubicación GPS en vivo',
          lat: nextLat,
          lon: nextLon,
        });
        setWindowType('TIME_FROM_START');
        setMinMinutes(15);
        setMaxMinutes(45);
        setGpsStatus('GPS en vivo activo');
      },
      () => {
        stopGpsWatch();
        const sim = EN_ROUTE_GPS_SIMULATIONS[0];
        setOrigin(sim.origin);
        setDestination(sim.destination);
        setWindowType('TIME_FROM_START');
        setMinMinutes(10);
        setMaxMinutes(45);
        setGpsStatus('Posición simulada en A-3');
      },
      {
        enableHighAccuracy: true,
        maximumAge: 15000,
        timeout: 10000,
      }
    );

    gpsWatchIdRef.current = watchId;
  }

  return (
    <div className="min-h-dvh lg:h-dvh lg:overflow-hidden flex flex-col-reverse lg:flex-row bg-[#f4f1ea] text-[#181816]">
      {/* =====================================================================
          PANEL LATERAL EDITORIAL (460px en escritorio, Bottom Sheet en móvil)
          ===================================================================== */}
      <aside className="w-full lg:w-[440px] xl:w-[480px] shrink-0 lg:h-dvh flex flex-col border-r border-[#e6e2d8] bg-[#f4f1ea] rounded-t-3xl lg:rounded-none -mt-4 lg:mt-0 relative z-20 shadow-xl lg:shadow-none">
        {/* 1. CABECERA LIMPIA: Marca + Selector de Modo + Botón Discreto */}
        <header className="px-5 pt-4 pb-3 flex items-center justify-between gap-2 border-b border-[#e6e2d8]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#165b40] flex items-center justify-center text-white">
              <RouteIcon className="w-4 h-4" />
            </div>
            <span className="text-base font-extrabold tracking-tight text-[#181816]">
              OptiStop
            </span>
          </div>

          <div
            role="group"
            aria-label="Modo de viaje"
            className="flex items-center bg-[#e6e2d8]/70 p-0.5 rounded-full"
          >
            <button
              type="button"
              aria-pressed={mode === 'PLANNING'}
              onClick={() => {
                setMode('PLANNING');
                handleSelectPreset(CORRIDOR_PRESETS[0]);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                mode === 'PLANNING'
                  ? 'bg-[#fcfbf8] text-[#181816] shadow-xs'
                  : 'text-[#5c5a54] hover:text-[#181816]'
              }`}
            >
              <Compass className="w-3.5 h-3.5 text-[#165b40]" />
              <span>Planificar</span>
            </button>

            <button
              type="button"
              aria-pressed={mode === 'EN_ROUTE'}
              onClick={() => {
                setMode('EN_ROUTE');
                const sim = EN_ROUTE_GPS_SIMULATIONS[0];
                setOrigin(sim.origin);
                setDestination(sim.destination);
                setWindowType('TIME_FROM_START');
                setMinMinutes(10);
                setMaxMinutes(45);
                setIsEditingRoute(false);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                mode === 'EN_ROUTE'
                  ? 'bg-[#165b40] text-white shadow-xs'
                  : 'text-[#5c5a54] hover:text-[#181816]'
              }`}
            >
              <Navigation2 className="w-3.5 h-3.5" />
              <span>En ruta</span>
            </button>
          </div>

          <AddCuratedStopModal
            onStopAdded={() => {
              executeSearch();
            }}
          />
        </header>

        {/* 2. CONTENIDO DESLIZABLE DEL PANEL */}
        <div className="flex-1 overflow-y-auto editorial-scroll px-5 py-4 space-y-4">
          {isOffline && (
            <div
              role="alert"
              className="rounded-xl bg-[#fef3c7] border border-[#f59e0b]/40 px-3.5 py-2.5 text-xs font-medium text-[#92400e] flex items-center gap-2"
            >
              <WifiOff className="w-4 h-4 shrink-0" />
              <span>Modo sin conexión: usando rutas y paradas locales.</span>
            </div>
          )}

          {/* BLOQUE DE VIAJE COMPACTO (Se pliega automáticamente para evitar ruido) */}
          {mode === 'PLANNING' ? (
            <div className="bg-[#fcfbf8] rounded-2xl border border-[#e6e2d8] p-3.5 shadow-2xs">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditingRoute((v) => !v)}
                  aria-expanded={isEditingRoute}
                  className="flex-1 text-left flex items-center justify-between gap-2 cursor-pointer group"
                >
                  <div>
                    <div className="flex items-center gap-2 text-sm font-bold text-[#181816] group-hover:text-[#165b40] transition-colors">
                      <span>{origin.label}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-[#5c5a54]" />
                      <span>{destination.label}</span>
                    </div>
                    <div className="text-xs text-[#5c5a54] mt-0.5">
                      Salida {departureHHMM}
                      {data
                        ? ` · ${data.routeSummary.totalDistanceKm} km (${Math.floor(
                            data.routeSummary.totalDurationMinutes / 60
                          )}h ${
                            data.routeSummary.totalDurationMinutes % 60
                          }m)`
                        : ''}
                    </div>
                  </div>

                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#f4f1ea] text-[#181816]">
                    <span>{isEditingRoute ? 'Cerrar' : 'Cambiar'}</span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${
                        isEditingRoute ? 'rotate-180' : ''
                      }`}
                    />
                  </span>
                </button>
              </div>

              {/* Editor desplegable bajo demanda */}
              {isEditingRoute && (
                <div className="mt-3.5 pt-3.5 border-t border-[#e6e2d8] space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {CORRIDOR_PRESETS.map((preset) => {
                      const active =
                        origin.label === preset.origin.label &&
                        destination.label === preset.destination.label;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handleSelectPreset(preset)}
                          className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
                            active
                              ? 'bg-[#181816] text-white border-[#181816]'
                              : 'bg-[#f4f1ea] text-[#181816] border-[#e6e2d8] hover:border-[#b8b2a3]'
                          }`}
                        >
                          <span className="font-bold opacity-75 mr-1">
                            {preset.highway}
                          </span>
                          {preset.title}
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <LocationAutocompleteInput
                      label="Origen"
                      value={origin}
                      onChange={setOrigin}
                    />
                    <LocationAutocompleteInput
                      label="Destino"
                      value={destination}
                      onChange={setDestination}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <label
                      htmlFor="departure-time-input"
                      className="text-xs font-semibold text-[#5c5a54]"
                    >
                      Hora de salida:
                    </label>
                    <input
                      id="departure-time-input"
                      type="time"
                      value={departureHHMM}
                      onChange={(e) => setDepartureHHMM(e.target.value)}
                      className="px-2.5 py-1.5 rounded-xl border border-[#e6e2d8] text-xs font-bold bg-white"
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* MODO EN RUTA: Aviso compacto + GPS + 3 botones táctiles grandes */
            <div className="bg-[#fcfbf8] rounded-2xl border border-[#e6e2d8] p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2 text-xs text-[#5c5a54]">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                  Uso recomendado para el copiloto
                </span>
                {gpsStatus && (
                  <span className="font-semibold text-[#165b40]">
                    {gpsStatus}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={isWatchingGps}
                  onClick={handleActivateRealGps}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 min-h-[48px] rounded-xl text-white text-xs font-bold shrink-0 cursor-pointer transition-colors ${
                    isWatchingGps
                      ? 'bg-[#b45309] hover:bg-[#92400e]'
                      : 'bg-[#165b40] hover:bg-[#114a33]'
                  }`}
                >
                  <LocateFixed
                    className={`w-4 h-4 ${isWatchingGps ? 'animate-pulse' : ''}`}
                  />
                  <span>{isWatchingGps ? 'Pausar GPS' : 'GPS en vivo'}</span>
                </button>

                <label htmlFor="gps-sim-select" className="sr-only">
                  Tramo actual en carretera
                </label>
                <select
                  id="gps-sim-select"
                  value={origin.label}
                  onChange={(e) => {
                    const sim = EN_ROUTE_GPS_SIMULATIONS.find(
                      (s) => s.origin.label === e.target.value
                    );
                    if (sim) {
                      setOrigin(sim.origin);
                      setDestination(sim.destination);
                    }
                  }}
                  className="w-full px-3 py-2.5 min-h-[48px] rounded-xl border border-[#e6e2d8] text-xs font-semibold bg-[#f4f1ea] text-[#181816]"
                >
                  {EN_ROUTE_GPS_SIMULATIONS.map((sim) => (
                    <option key={sim.label} value={sim.origin.label}>
                      📍 {sim.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* 3. CUÁNDO PARAR Y FILTROS ESENCIALES (Minimalistas) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#181816] flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#165b40]" />
                ¿Cuándo te apetece parar?
              </span>
              {data && (
                <span className="text-[11px] font-medium text-[#5c5a54]">
                  Tramo km {data.windowInfo.minKm}–{data.windowInfo.maxKm} (
                  {data.windowInfo.windowStartClock}–
                  {data.windowInfo.windowEndClock})
                </span>
              )}
            </div>

            {mode === 'PLANNING' ? (
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  {
                    id: '1h',
                    label: 'En ~1h',
                    active:
                      windowType === 'TIME_FROM_START' &&
                      minMinutes === 50 &&
                      !showCustomWindow,
                    onClick: () => {
                      setShowCustomWindow(false);
                      setWindowType('TIME_FROM_START');
                      setMinMinutes(50);
                      setMaxMinutes(115);
                    },
                  },
                  {
                    id: 'lunch',
                    label: '14:00–15:00',
                    active:
                      windowType === 'CLOCK_RANGE' && !showCustomWindow,
                    onClick: () => {
                      setShowCustomWindow(false);
                      setWindowType('CLOCK_RANGE');
                      setClockStart('14:00');
                      setClockEnd('15:00');
                    },
                  },
                  {
                    id: '2h',
                    label: 'En ~2h',
                    active:
                      windowType === 'TIME_FROM_START' &&
                      minMinutes === 95 &&
                      !showCustomWindow,
                    onClick: () => {
                      setShowCustomWindow(false);
                      setWindowType('TIME_FROM_START');
                      setMinMinutes(95);
                      setMaxMinutes(160);
                    },
                  },
                  {
                    id: 'custom',
                    label: 'Ajustar',
                    active: showCustomWindow,
                    onClick: () => setShowCustomWindow((v) => !v),
                  },
                ].map((pill) => (
                  <button
                    key={pill.id}
                    type="button"
                    aria-pressed={pill.active}
                    onClick={pill.onClick}
                    className={`py-2 px-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      pill.active
                        ? 'bg-[#165b40] text-white border-[#165b40] shadow-2xs'
                        : 'bg-[#fcfbf8] text-[#181816] border-[#e6e2d8] hover:border-[#b8b2a3]'
                    }`}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>
            ) : (
              /* En ruta: 3 botones grandes >= 48px */
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Pronto (15–35m)', min: 5, max: 38 },
                  { label: 'En ~45 min', min: 28, max: 68 },
                  { label: 'En ~1 hora', min: 55, max: 115 },
                ].map((btn) => {
                  const active =
                    minMinutes === btn.min && maxMinutes === btn.max;
                  return (
                    <button
                      key={btn.label}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setWindowType('TIME_FROM_START');
                        setMinMinutes(btn.min);
                        setMaxMinutes(btn.max);
                      }}
                      className={`py-3 px-2 min-h-[48px] rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                        active
                          ? 'bg-[#165b40] text-white border-[#165b40]'
                          : 'bg-[#fcfbf8] text-[#181816] border-[#e6e2d8]'
                      }`}
                    >
                      {btn.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Panel de ajuste personalizado de ventana (solo si pulsa "Ajustar") */}
            {showCustomWindow && (
              <div className="p-3 rounded-xl bg-[#fcfbf8] border border-[#e6e2d8] space-y-2.5 text-xs">
                <div className="flex gap-1 bg-[#f4f1ea] p-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setWindowType('CLOCK_RANGE')}
                    className={`flex-1 py-1 rounded-md font-bold cursor-pointer ${
                      windowType === 'CLOCK_RANGE'
                        ? 'bg-white text-[#181816] shadow-2xs'
                        : 'text-[#5c5a54]'
                    }`}
                  >
                    Por Hora
                  </button>
                  <button
                    type="button"
                    onClick={() => setWindowType('DISTANCE_RANGE')}
                    className={`flex-1 py-1 rounded-md font-bold cursor-pointer ${
                      windowType === 'DISTANCE_RANGE'
                        ? 'bg-white text-[#181816] shadow-2xs'
                        : 'text-[#5c5a54]'
                    }`}
                  >
                    Por Kilómetros
                  </button>
                </div>

                {windowType === 'CLOCK_RANGE' ? (
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="clock-start-input" className="text-[#5c5a54]">
                      Entre:
                    </label>
                    <input
                      id="clock-start-input"
                      type="time"
                      value={clockStart}
                      onChange={(e) => setClockStart(e.target.value)}
                      className="px-2 py-1 rounded-lg border border-[#e6e2d8] bg-white font-bold"
                    />
                    <label htmlFor="clock-end-input" className="text-[#5c5a54]">
                      y
                    </label>
                    <input
                      id="clock-end-input"
                      type="time"
                      value={clockEnd}
                      onChange={(e) => setClockEnd(e.target.value)}
                      className="px-2 py-1 rounded-lg border border-[#e6e2d8] bg-white font-bold"
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="min-km-input" className="text-[#5c5a54]">
                      Km:
                    </label>
                    <input
                      id="min-km-input"
                      type="number"
                      min={0}
                      max={1500}
                      value={minKm}
                      onChange={(e) => setMinKm(Number(e.target.value))}
                      className="w-20 px-2 py-1 rounded-lg border border-[#e6e2d8] bg-white font-bold"
                    />
                    <label htmlFor="max-km-input" className="text-[#5c5a54]">
                      a
                    </label>
                    <input
                      id="max-km-input"
                      type="number"
                      min={10}
                      max={1600}
                      value={maxKm}
                      onChange={(e) => setMaxKm(Number(e.target.value))}
                      className="w-20 px-2 py-1 rounded-lg border border-[#e6e2d8] bg-white font-bold"
                    />
                  </div>
                )}
              </div>
            )}

            {/* 4 Píldoras de Filtro Limpias */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[11px] font-semibold text-[#5c5a54] inline-flex items-center gap-1 mr-0.5">
                <SlidersHorizontal className="w-3 h-3" />
              </span>

              <button
                type="button"
                aria-pressed={requireEvCharger}
                onClick={() => setRequireEvCharger((v) => !v)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
                  requireEvCharger
                    ? 'bg-[#181816] text-white border-[#181816]'
                    : 'bg-[#fcfbf8] text-[#5c5a54] border-[#e6e2d8] hover:text-[#181816]'
                }`}
              >
                <Zap className="w-3 h-3" />
                Cargador EV
              </button>

              <button
                type="button"
                aria-pressed={requireGasStation}
                onClick={() => setRequireGasStation((v) => !v)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
                  requireGasStation
                    ? 'bg-[#181816] text-white border-[#181816]'
                    : 'bg-[#fcfbf8] text-[#5c5a54] border-[#e6e2d8] hover:text-[#181816]'
                }`}
              >
                <Fuel className="w-3 h-3" />
                Gasolinera
              </button>

              <button
                type="button"
                aria-pressed={maxPriceLevel === 1}
                onClick={() =>
                  setMaxPriceLevel((prev) => (prev === 1 ? 3 : 1))
                }
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
                  maxPriceLevel === 1
                    ? 'bg-[#181816] text-white border-[#181816]'
                    : 'bg-[#fcfbf8] text-[#5c5a54] border-[#e6e2d8] hover:text-[#181816]'
                }`}
              >
                <span>€ Económico</span>
              </button>

              <button
                type="button"
                aria-pressed={requirePetFriendly}
                onClick={() => setRequirePetFriendly((v) => !v)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
                  requirePetFriendly
                    ? 'bg-[#181816] text-white border-[#181816]'
                    : 'bg-[#fcfbf8] text-[#5c5a54] border-[#e6e2d8] hover:text-[#181816]'
                }`}
              >
                <PawPrint className="w-3 h-3" />
                Mascotas
              </button>
            </div>
          </div>

          {/* ESTADO DE ERROR */}
          {errorMessage && (
            <div
              role="alert"
              className="rounded-2xl bg-red-50 border border-red-200 p-3.5 text-xs text-red-900 flex items-center justify-between gap-2"
            >
              <span className="font-medium">{errorMessage}</span>
              <button
                type="button"
                onClick={() => executeSearch()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-800 text-white font-bold shrink-0 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                Reintentar
              </button>
            </div>
          )}

          {/* 4. LISTA ESCANEABLE DEL TOP 3–5 PARADAS ÓPTIMAS */}
          <div className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between px-0.5">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#5c5a54]">
                {isLoading && !data
                  ? 'Buscando paradas...'
                  : `${data?.optimalStops.length ?? 0} paradas recomendadas`}
              </h2>
              <span className="text-[11px] text-[#5c5a54]">
                Toca una para ver detalles
              </span>
            </div>

            {isLoading && !data ? (
              <div className="space-y-2.5" aria-label="Cargando paradas">
                {[1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="h-28 rounded-2xl border border-[#e6e2d8] bg-[#fcfbf8] p-4 animate-pulse space-y-2"
                  >
                    <div className="h-4 w-2/3 bg-[#e6e2d8] rounded" />
                    <div className="h-3 w-4/5 bg-[#efece6] rounded" />
                    <div className="h-3 w-1/3 bg-[#efece6] rounded" />
                  </div>
                ))}
              </div>
            ) : data && data.optimalStops.length === 0 ? (
              <div className="bg-[#fcfbf8] rounded-2xl border border-[#e6e2d8] p-6 text-center space-y-1.5">
                <p className="text-sm font-bold text-[#181816]">
                  Sin paradas con estos filtros en este tramo
                </p>
                <p className="text-xs text-[#5c5a54]">
                  Prueba a desactivar algún filtro o cambiar la ventana de tiempo.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {data?.optimalStops.map((stop, idx) => (
                  <OptimalStopCard
                    key={stop.id}
                    stop={stop}
                    rank={idx + 1}
                    isSelected={stop.id === selectedStopId}
                    onSelect={() =>
                      setSelectedStopId((prev) =>
                        prev === stop.id ? null : stop.id
                      )
                    }
                  />
                ))}
              </div>
            )}

            {/* Nota discreta al pie del listado (RNF-04.6 sin contaminar cada tarjeta) */}
            <div className="pt-2 px-1 flex items-center justify-between gap-2 text-[11px] text-[#5c5a54]">
              <span>
                Cartografía OpenStreetMap · Verifica horarios en festivos.
              </span>
              <a
                href="/admin"
                className="underline hover:text-[#181816] font-medium shrink-0"
              >
                Moderación
              </a>
            </div>
          </div>
        </div>
      </aside>

      {/* =====================================================================
          LIENZO PRINCIPAL DEL MAPA (Pantalla completa a la derecha)
          ===================================================================== */}
      <main className="w-full h-[40dvh] min-h-[280px] lg:h-dvh flex-1 relative overflow-hidden shrink-0 lg:shrink">
        <RouteMap
          fullPolyline={data?.routeSummary.fullPolyline ?? []}
          windowPolyline={data?.routeSummary.windowPolyline ?? []}
          optimalStops={data?.optimalStops ?? []}
          selectedStopId={selectedStopId}
          onSelectStop={setSelectedStopId}
          originLabel={origin.label}
          destinationLabel={destination.label}
        />
      </main>
    </div>
  );
}
