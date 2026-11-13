'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { Loader2, MapPin, X } from 'lucide-react';

export interface PlaceOption {
  label: string;
  lat: number;
  lon: number;
  corridorHint?: string;
}

interface LocationAutocompleteInputProps {
  label: string;
  value: PlaceOption;
  onChange: (place: PlaceOption) => void;
  placeholder?: string;
  iconVariant?: 'origin' | 'destination';
}

function normalizeLabel(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function LocationAutocompleteInput({
  label,
  value,
  onChange,
  placeholder = 'Escribe una localidad...',
  iconVariant,
}: LocationAutocompleteInputProps) {
  const inputId = useId();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const skipNextFetchRef = useRef(false);

  const [query, setQuery] = useState(value.label);
  const [suggestions, setSuggestions] = useState<PlaceOption[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    setQuery(value.label);
  }, [value.label]);

  useEffect(() => {
    if (!isOpen) return;
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }

    const ctrl = new AbortController();
    setIsLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/geocode?q=${encodeURIComponent(query.trim())}`,
          { signal: ctrl.signal }
        );
        if (res.ok) {
          const data = await res.json();
          const list: PlaceOption[] = data.results ?? [];
          setSuggestions(list);
          setActiveIndex(list.length > 0 ? 0 : -1);
        }
      } catch {
        // Ignorar abortos
      } finally {
        if (!ctrl.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
      setIsLoading(false);
    };
  }, [query, isOpen]);

  function selectPlace(place: PlaceOption) {
    skipNextFetchRef.current = true;
    onChange(place);
    setQuery(place.label);
    setIsOpen(false);
    setActiveIndex(-1);
  }

  async function resolveAndSelectByEnter() {
    if (suggestions.length > 0) {
      const target =
        activeIndex >= 0 && activeIndex < suggestions.length
          ? suggestions[activeIndex]
          : suggestions[0];
      selectPlace(target);
      return;
    }

    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    setIsLoading(true);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`);
      if (res.ok) {
        const data = await res.json();
        const list: PlaceOption[] = data.results ?? [];
        setSuggestions(list);
        if (list.length > 0) {
          selectPlace(list[0]);
        }
      }
    } catch {
      // Silencioso
    } finally {
      setIsLoading(false);
    }
  }

  function handleBlur() {
    setTimeout(() => {
      setIsOpen(false);
      const normQuery = normalizeLabel(query);
      if (normQuery === normalizeLabel(value.label)) {
        setQuery(value.label);
        return;
      }

      const exactMatch = suggestions.find(
        (s) => normalizeLabel(s.label) === normQuery
      );
      if (exactMatch) {
        selectPlace(exactMatch);
      } else {
        // Evitar desincronización visual respecto a la ruta cargada
        setQuery(value.label);
      }
    }, 180);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      if (suggestions.length > 0) {
        setActiveIndex((prev) => (prev + 1) % suggestions.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen || suggestions.length === 0) return;
      setActiveIndex((prev) =>
        prev <= 0 ? suggestions.length - 1 : prev - 1
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      resolveAndSelectByEnter();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      setQuery(value.label);
      inputRef.current?.blur();
    }
  }

  return (
    <div className="relative">
      <label
        htmlFor={inputId}
        className="block text-[11px] font-bold uppercase tracking-wider text-[#5c5a54] mb-1"
      >
        {label}
      </label>
      <div className="relative flex items-center">
        {iconVariant === 'origin' ? (
          <span
            aria-hidden="true"
            className="w-2.5 h-2.5 rounded-full bg-[#165b40] ring-2 ring-[#e6f2ed] absolute left-3 pointer-events-none"
          />
        ) : iconVariant === 'destination' ? (
          <MapPin className="w-3.5 h-3.5 text-[#b45309] absolute left-3 pointer-events-none" />
        ) : (
          <MapPin className="w-3.5 h-3.5 text-[#5c5a54] absolute left-3 pointer-events-none" />
        )}

        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            isOpen && activeIndex >= 0
              ? `${listboxId}-opt-${activeIndex}`
              : undefined
          }
          value={query}
          onFocus={(e) => {
            setIsOpen(true);
            e.currentTarget.select();
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          placeholder={placeholder}
          className="w-full pl-8 pr-8 py-2 min-h-[40px] rounded-xl border border-[#e6e2d8] text-xs font-semibold bg-[#fcfbf8] text-[#181816] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#165b40]"
        />

        {isLoading ? (
          <Loader2
            aria-label="Buscando localidades"
            className="w-3.5 h-3.5 text-[#165b40] animate-spin absolute right-2.5 pointer-events-none"
          />
        ) : (
          query.length > 0 && (
            <button
              type="button"
              aria-label={`Limpiar ${label}`}
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery('');
                setIsOpen(true);
                inputRef.current?.focus();
              }}
              className="absolute right-2 p-1 rounded-full text-[#5c5a54] hover:text-[#181816] hover:bg-[#efece6] cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )
        )}
      </div>

      {isOpen && (suggestions.length > 0 || (!isLoading && query.trim().length >= 2)) && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`Sugerencias para ${label}`}
          className="absolute z-40 mt-1 w-full max-h-56 overflow-y-auto rounded-xl bg-white border border-[#e6e2d8] shadow-lg py-1 text-xs"
        >
          {suggestions.length === 0 ? (
            <li className="px-3 py-2.5 text-[#5c5a54] italic">
              No se encontraron localidades en España para &ldquo;{query.trim()}&rdquo;
            </li>
          ) : (
            suggestions.map((item, idx) => {
              const isHighlighted = idx === activeIndex;
              const isSelected = item.label === value.label;
              return (
                <li
                  key={`${item.label}-${item.lat}-${item.lon}`}
                  id={`${listboxId}-opt-${idx}`}
                  role="option"
                  aria-selected={isSelected}
                >
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectPlace(item);
                    }}
                    className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                      isHighlighted
                        ? 'bg-[#e6f2ed] text-[#181816]'
                        : 'hover:bg-[#f4f1ea] text-[#181816]'
                    }`}
                  >
                    <span className="font-semibold truncate">{item.label}</span>
                    {item.corridorHint && (
                      <span className="text-[11px] font-bold text-[#165b40] bg-[#e6f2ed] px-1.5 py-0.5 rounded shrink-0">
                        {item.corridorHint}
                      </span>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
