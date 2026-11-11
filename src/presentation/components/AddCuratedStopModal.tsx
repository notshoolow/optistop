'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import {
  AccessType,
  PriceLevel,
  RoadStopEntity,
  StopCategory,
} from '@/domain/models/types';
import { Plus, X, CheckCircle2, AlertCircle } from 'lucide-react';

interface AddCuratedStopModalProps {
  onStopAdded: (newStop: RoadStopEntity) => void;
}

export function AddCuratedStopModal({ onStopAdded }: AddCuratedStopModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [highwayCode, setHighwayCode] = useState('A-3');
  const [kmMarker, setKmMarker] = useState('110');
  const [locality, setLocality] = useState('Saelices (Cuenca)');
  const [lat, setLat] = useState('39.88');
  const [lon, setLon] = useState('-2.70');
  const [category, setCategory] = useState<StopCategory>('RESTAURANT');
  const [accessType, setAccessType] = useState<AccessType>('HIGHWAY_EXIT_EASY');
  const [priceLevel, setPriceLevel] = useState<PriceLevel>(1);
  const [specialty, setSpecialty] = useState('');
  const [hasEvChargerNearby, setHasEvChargerNearby] = useState(true);
  const [hasGasStationOnsite, setHasGasStationOnsite] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const titleId = useId();
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    firstInputRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/stops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          highwayCode,
          kmMarker: Number(kmMarker),
          locality: locality || `${highwayCode} PK ${kmMarker}`,
          coordinates: { lat: Number(lat), lon: Number(lon) },
          category,
          accessType,
          priceLevel,
          specialty:
            specialty || 'Propuesta comunitaria de parada en carretera',
          amenities: {
            hasEvChargerNearby,
            evChargerDetails: hasEvChargerNearby
              ? 'Cargador EV a <200m'
              : undefined,
            hasGasStationOnsite,
            hasEasyParking: true,
            hasCleanRestrooms: true,
            isPetFriendly: true,
            hasKidsArea: false,
            hasTruckParking: true,
            hasWifi: true,
          },
        }),
      });

      const data = await res.json();
      if (res.ok) {
        onStopAdded(data.stop);
        setFeedback({
          type: 'success',
          message:
            data.message ||
            'Propuesta enviada a moderación. Entrará en el ranking tras ser verificada.',
        });
        setName('');
        setSpecialty('');
      } else {
        setFeedback({
          type: 'error',
          message: data.error || 'No se pudo registrar la propuesta.',
        });
      }
    } catch {
      setFeedback({
        type: 'error',
        message: 'Error de red al enviar la propuesta.',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFeedback(null);
          setIsOpen(true);
        }}
        title="Sugerir una nueva parada de carretera"
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold text-[#5c5a54] hover:text-[#181816] hover:bg-[#e6e2d8]/60 transition-colors cursor-pointer"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>Sugerir</span>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#181816]/50 backdrop-blur-xs p-4"
        >
          <div className="bg-[#fcfbf8] rounded-3xl max-w-lg w-full p-6 shadow-xl border border-[#e6e2d8] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#e6e2d8]">
              <div>
                <h2 id={titleId} className="text-base font-bold text-[#181816]">
                  Sugerir Parada en Carretera
                </h2>
                <p className="text-xs text-[#5c5a54]">
                  Se revisará antes de publicarse en las recomendaciones.
                </p>
              </div>
              <button
                type="button"
                aria-label="Cerrar ventana modal"
                onClick={() => setIsOpen(false)}
                className="p-2 rounded-full text-[#5c5a54] hover:text-[#181816] hover:bg-[#e6e2d8]/50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {feedback && (
              <div
                role="status"
                className={`mt-3 p-3 rounded-xl text-xs font-semibold flex items-center gap-2 border ${
                  feedback.type === 'success'
                    ? 'bg-[#e6f2ed] text-[#114a33] border-[#165b40]/30'
                    : 'bg-red-50 text-red-900 border-red-300'
                }`}
              >
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{feedback.message}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="sm:col-span-2">
                  <label
                    htmlFor="modal-stop-name"
                    className="block font-semibold text-[#181816] mb-1"
                  >
                    Nombre del lugar *
                  </label>
                  <input
                    id="modal-stop-name"
                    ref={firstInputRef}
                    required
                    minLength={3}
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej. Asador Venta del Kilómetro 110"
                    className="w-full px-3 py-2 rounded-xl border border-[#e6e2d8] bg-white"
                  />
                </div>
                <div>
                  <label
                    htmlFor="modal-highway"
                    className="block font-semibold text-[#181816] mb-1"
                  >
                    Vía y PK
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      id="modal-highway"
                      value={highwayCode}
                      onChange={(e) => setHighwayCode(e.target.value)}
                      placeholder="A-3"
                      className="w-1/2 px-2.5 py-2 rounded-xl border border-[#e6e2d8] bg-white"
                    />
                    <input
                      id="modal-km"
                      aria-label="Punto kilométrico"
                      type="number"
                      min={0}
                      max={1500}
                      value={kmMarker}
                      onChange={(e) => setKmMarker(e.target.value)}
                      placeholder="110"
                      className="w-1/2 px-2.5 py-2 rounded-xl border border-[#e6e2d8] bg-white"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label
                    htmlFor="modal-locality"
                    className="block font-semibold text-[#181816] mb-1"
                  >
                    Localidad *
                  </label>
                  <input
                    id="modal-locality"
                    required
                    minLength={2}
                    maxLength={120}
                    value={locality}
                    onChange={(e) => setLocality(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#e6e2d8] bg-white"
                  />
                </div>
                <div>
                  <label
                    htmlFor="modal-lat"
                    className="block font-semibold text-[#181816] mb-1"
                  >
                    Latitud
                  </label>
                  <input
                    id="modal-lat"
                    type="number"
                    step="0.0001"
                    min={27}
                    max={44.5}
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#e6e2d8] bg-white"
                  />
                </div>
                <div>
                  <label
                    htmlFor="modal-lon"
                    className="block font-semibold text-[#181816] mb-1"
                  >
                    Longitud
                  </label>
                  <input
                    id="modal-lon"
                    type="number"
                    step="0.0001"
                    min={-18.5}
                    max={4.5}
                    value={lon}
                    onChange={(e) => setLon(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#e6e2d8] bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label
                    htmlFor="modal-category"
                    className="block font-semibold text-[#181816] mb-1"
                  >
                    Categoría
                  </label>
                  <select
                    id="modal-category"
                    value={category}
                    onChange={(e) =>
                      setCategory(e.target.value as StopCategory)
                    }
                    className="w-full px-2.5 py-2 rounded-xl border border-[#e6e2d8] bg-white"
                  >
                    <option value="RESTAURANT">Restaurante / Asador</option>
                    <option value="CAFE_BAKERY">Cafetería / Obrador</option>
                    <option value="SERVICE_AREA">Área de Servicio</option>
                    <option value="REST_AREA_PICNIC">Área de Descanso</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="modal-access"
                    className="block font-semibold text-[#181816] mb-1"
                  >
                    Acceso
                  </label>
                  <select
                    id="modal-access"
                    value={accessType}
                    onChange={(e) =>
                      setAccessType(e.target.value as AccessType)
                    }
                    className="w-full px-2.5 py-2 rounded-xl border border-[#e6e2d8] bg-white"
                  >
                    <option value="DIRECT_SERVICE_AREA">
                      Directo en la vía
                    </option>
                    <option value="HIGHWAY_EXIT_EASY">
                      Salida inmediata
                    </option>
                    <option value="OPPOSITE_DIRECTION_OVERPASS">
                      Paso superior
                    </option>
                    <option value="TOWN_ENTRY">Entrada a pueblo</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="modal-price"
                    className="block font-semibold text-[#181816] mb-1"
                  >
                    Precio
                  </label>
                  <select
                    id="modal-price"
                    value={priceLevel}
                    onChange={(e) =>
                      setPriceLevel(Number(e.target.value) as PriceLevel)
                    }
                    className="w-full px-2.5 py-2 rounded-xl border border-[#e6e2d8] bg-white"
                  >
                    <option value={1}>€ (Económico)</option>
                    <option value={2}>€€ (Medio)</option>
                    <option value={3}>€€€ (Alto)</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="modal-specialty"
                  className="block font-semibold text-[#181816] mb-1"
                >
                  ¿Por qué merece la pena parar aquí?
                </label>
                <input
                  id="modal-specialty"
                  maxLength={300}
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  placeholder="Ej. Bocadillos de lomo a la brasa, café excelente y baños limpios"
                  className="w-full px-3 py-2 rounded-xl border border-[#e6e2d8] bg-white"
                />
              </div>

              <div className="flex flex-wrap gap-4 pt-1">
                <label
                  htmlFor="modal-ev"
                  className="inline-flex items-center gap-1.5 font-medium text-[#181816]"
                >
                  <input
                    id="modal-ev"
                    type="checkbox"
                    checked={hasEvChargerNearby}
                    onChange={(e) => setHasEvChargerNearby(e.target.checked)}
                  />
                  ⚡ Cargador EV cercano
                </label>
                <label
                  htmlFor="modal-gas"
                  className="inline-flex items-center gap-1.5 font-medium text-[#181816]"
                >
                  <input
                    id="modal-gas"
                    type="checkbox"
                    checked={hasGasStationOnsite}
                    onChange={(e) => setHasGasStationOnsite(e.target.checked)}
                  />
                  ⛽ Gasolinera en el área
                </label>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-[#e6e2d8]">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 rounded-xl border border-[#e6e2d8] font-semibold text-[#5c5a54]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl bg-[#165b40] hover:bg-[#114a33] text-white font-bold"
                >
                  {isSubmitting ? 'Enviando...' : 'Enviar sugerencia'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
