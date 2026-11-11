'use client';

import React, { useEffect, useId, useState } from 'react';
import { MapPin } from 'lucide-react';

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
}

export function LocationAutocompleteInput({
  label,
  value,
  onChange,
}: LocationAutocompleteInputProps) {
  const inputId = useId();
  const [query, setQuery] = useState(value.label);
  const [suggestions, setSuggestions] = useState<PlaceOption[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setQuery(value.label);
  }, [value.label]);

  useEffect(() => {
    if (!isOpen) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/geocode?q=${encodeURIComponent(query.trim())}`,
          { signal: ctrl.signal }
        );
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.results ?? []);
        }
      } catch {
        // Ignorar abortos
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, isOpen]);

  return (
    <div className="relative">
      <label
        htmlFor={inputId}
        className="block text-[11px] font-bold uppercase tracking-wider text-[#5c5a54] mb-1"
      >
        {label}
      </label>
      <div className="relative flex items-center">
        <MapPin className="w-3.5 h-3.5 text-[#5c5a54] absolute left-3 pointer-events-none" />
        <input
          id={inputId}
          type="text"
          value={query}
          onFocus={() => setIsOpen(true)}
          onBlur={() => {
            setTimeout(() => setIsOpen(false), 180);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          placeholder="Ciudad o punto..."
          className="w-full pl-8 pr-3 py-2 min-h-[38px] rounded-xl border border-[#e6e2d8] text-xs font-semibold bg-[#fcfbf8] text-[#181816] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#165b40]"
        />
      </div>

      {isOpen && suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label={`Sugerencias para ${label}`}
          className="absolute z-40 mt-1 w-full max-h-52 overflow-y-auto rounded-xl bg-white border border-[#e6e2d8] shadow-lg py-1 text-xs"
        >
          {suggestions.map((item) => (
            <li
              key={`${item.label}-${item.lat}-${item.lon}`}
              role="option"
              aria-selected={item.label === value.label}
            >
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(item);
                  setQuery(item.label);
                  setIsOpen(false);
                }}
                className="w-full px-3 py-2 text-left hover:bg-[#f4f1ea] flex items-center justify-between gap-2 cursor-pointer"
              >
                <span className="font-semibold text-[#181816] truncate">
                  {item.label}
                </span>
                {item.corridorHint && (
                  <span className="text-[11px] font-bold text-[#165b40] bg-[#e6f2ed] px-1.5 py-0.5 rounded shrink-0">
                    {item.corridorHint}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
