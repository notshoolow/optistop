# 04. Especificación UI/UX v2.0 — "Warm Editorial Travel & Progressive Disclosure"

**Proyecto:** OptiStop  
**Metodología:** Spec-Driven Development (SDD)  
**Dirección de Diseño:** *Split-Screen Map-First App* (inspirada en Airbnb / Apple Maps) con paleta **Warm Editorial Travel** y **Revelación Progresiva en 2 Niveles**.

---

## 1. Sistema de Diseño y Paleta "Warm Editorial Travel"

| Token | Valor Hex | Uso | Contraste WCAG AA |
| :--- | :--- | :--- | :--- |
| `--bg-canvas` | `#F4F1EA` | Fondo cálido piedra/arena del panel lateral | — |
| `--bg-surface` | `#FCFBF8` | Superficie marfil de tarjetas en reposo | — |
| `--bg-surface-active` | `#FFFFFF` | Superficie elevada de la tarjeta activa/expandida | — |
| `--border-subtle` | `#E6E2D8` | Bordes orgánicos suaves (sin grises fríos) | — |
| `--text-primary` | `#181816` | Carbón profundo para títulos y nombres | > 14:1 |
| `--text-secondary` | `#5C5A54` | Gris piedra cálido para subtítulos y metadatos | > 6.5:1 |
| `--accent-forest` | `#165B40` | Verde bosque principal (ruta activa, selección, CTA) | > 7.8:1 (con texto blanco) |
| `--accent-amber` | `#B45309` | Ámbar cálido para el Top #1 y estrellas de valoración | > 5.0:1 |

---

## 2. Arquitectura Espacial: Split-Screen App (`100dvh`)

1. **En Escritorio (`lg:grid-cols-12` a altura fija `h-dvh overflow-hidden`):**
   - **Panel Izquierdo (`w-[440px] xl:w-[480px]`, scroll propio suave):**
     - Cabecera minimalista (Marca + Selector `Planificar` / `En ruta` + botón discreto `+ Parada`).
     - **Cápsula de Viaje Compacta (Trip Pill):** Muestra `Madrid → Valencia · Salida 12:30` en una sola línea limpia. Al pulsarla se despliega el editor de origen/destino/corredores rápidos, manteniéndose plegado el resto del tiempo para no robar espacio a las paradas.
     - **Selector de Ventana y Filtros Esenciales:** 1 fila de píldoras para el momento de parada (`En ~1h`, `Comer 14:00–15:00`, `En ~2h`, `Ajustar`) + 4 filtros rápidos (`⚡ EV`, `⛽ Gasolinera`, `€ Económico`, `🐾 Mascotas`).
     - **Lista Escaneable del Top 3–5 de Paradas Óptimas.**
   - **Lienzo Derecho (`flex-1 h-full`):**
     - Mapa interactivo `MapLibre GL` a sangre (100% de la altura), con controles flotantes y marcadores tipo píldora estilo Airbnb (`#1 · +2 min`).

2. **En Móvil:**
   - Mapa superior visible (`h-[38dvh]`) + Panel inferior deslizable (`rounded-t-3xl`) con las tarjetas y controles táctiles de $\ge 48\text{ px}$.

---

## 3. Revelación Progresiva en las Tarjetas (`OptimalStopCard`)

### Nivel 1: Vista Compacta (Por defecto — cero ruido visual)
Cada tarjeta en reposo muestra **únicamente 4 elementos** para poder comparar 5 opciones en menos de 3 segundos:
1. **Número de Ranking + Nombre del lugar** (`1. Asador & Área Marino`) y localidad/vía en texto secundario sutil (`A-3 · Saelices`).
2. **Píldora de Desvío Real** en la esquina superior derecha (`+2 min` en verde bosque suave si es $\le 3\text{ min}$).
3. **Especialidad gastronómica en 1 línea** (*"Bocadillos de panceta y lomo a la brasa y menú casero"*).
4. **Pie compacto en una sola línea:**
   - Valoración y precio: `★ 4.4 (2,1k) · €`
   - Iconos minimalistas de servicios confirmados: `⚡ EV` · `⛽ Cepsa` · `🅿️`

### Nivel 2: Vista Expandida (Solo en la tarjeta seleccionada)
Al hacer clic en una tarjeta (o en su pin del mapa), se despliega suavemente el panel de decisión:
- **Detalles de Llegada y Acceso:** Hora estimada de llegada (`Llegada 14:15 · PK 103`), tipo de salida (`Acceso directo en vía`) y horario.
- **Índice OptiScore y Motivos Clave:** Puntuación `OptiScore 92/100` + hasta 2 razones destacadas.
- **Barra de Navegación 1-Toque:** Botón principal **Google Maps** + botones secundarios para **Waze** y **Apple Maps**.

---

## 4. Cero Jerga Técnica en la Vista de Usuario
- Se prohíbe mostrar en la interfaz principal términos internos como `corridorHash`, `Cache-First HIT`, `SDD Hardened`, `OSRM_LIVE`, `Prior neutro` o `UNVERIFIED_OSM`.
