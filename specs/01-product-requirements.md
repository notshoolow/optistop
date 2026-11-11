# 01. Especificación de Requisitos de Producto (PRD)

**Proyecto:** OptiStop (Buscador de Paradas Óptimas en Carretera)  
**Metodología:** Spec-Driven Development (SDD)  
**Estado:** Borrador v1.0 para revisión  

---

## 1. Visión y Propósito

Los conductores y viajeros por carretera suelen enfrentarse a dos malas opciones al buscar dónde parar a comer, tomar un café o descansar:
1. **Áreas de servicio de autopista genéricas:** Cero desvío, pero a menudo caras y de baja calidad gastronómica.
2. **Búsqueda manual en mapas convencionales:** Obliga a hacer zoom pueblo por pueblo, sin saber cuánto tiempo real de desvío supone entrar y volver a incorporarse a la autovía ni si requiere un cambio de sentido complejo.

**OptiStop** resuelve este problema calculando una **Ventana de Parada** a lo largo de la ruta (planificada o activa por GPS) y seleccionando el **Top 3–5 de restaurantes, cafeterías y áreas de descanso óptimos**, equilibrando **mínimo desvío real de conducción** y **máxima calidad/precio ponderada**, e indicando servicios anexos clave (gasolinera en el mismo área, cargador EV cercano, parking fácil, baños, mascotas, etc.).

---

## 2. Modos de Uso y Perfiles de Usuario

### Modo A: Planificación de Ruta ("Antes de salir")
- El usuario introduce **Origen**, **Destino** y **Hora de salida**.
- Define cuándo quiere parar mediante una **Ventana de Parada**:
  - *Por tiempo/distancia:* ej. "Parar tras 2h 30m de viaje (±20 min)" o "A los 250 km".
  - *Por franja horaria:* ej. "Quiero parar a comer entre las 14:00 y las 15:00".
- El sistema recorta el tramo de ruta correspondiente a esa ventana y presenta el **Top 3–5 de paradas óptimas** en ese segmento.

### Modo B: En Ruta ("Ya conduciendo / Copiloto")
- El usuario activa su **ubicación GPS actual** e indica hacia dónde va (Destino o carretera actual + sentido).
- Selecciona una ventana rápida con botones grandes pensados para uso móvil en ruta:
  - **"Lo antes posible (10–25 min)"**
  - **"En unos 30–45 min"**
  - **"En 1 hora (~100 km)"**
- El sistema filtra solo las paradas **por delante de la posición actual** en el sentido de la marcha y ofrece el Top 3–5 con botón de **1 toque** para abrir en **Google Maps, Waze o Apple Maps**.

---

## 3. Requisitos Funcionales (RF)

### RF-01: Cálculo de Ruta Base (100% Open Data)
- Geocodificación de origen/destino mediante **Nominatim / Photon (OpenStreetMap)** y sugerencias rápidas de ciudades/corredores principales.
- Trazado de polilínea de ruta, distancia total y tiempos por tramo mediante **OSRM (Open Source Routing Machine)**.

### RF-02: Recorte de "Ventana de Parada" (Corridor Slicing)
- Dado un intervalo objetivo $[T_{\min}, T_{\max}]$ (en minutos desde el origen o desde la posición actual) o $[D_{\min}, D_{\max}]$ (en kilómetros), el motor geométrico extrae la sub-polilínea exacta del tramo donde el usuario desea parar.
- Se genera un **buffer de búsqueda (corredor)** alrededor de ese sub-tramo (por defecto radio de hasta $5\text{ km}$ desde la vía principal, equivalente a $\le 8\text{ min}$ de desvío máximo tolerable).

### RF-03: Descubrimiento Híbrido (Base de Datos Curada + OpenStreetMap)
- El sistema consulta prioritariamente la **Base de Datos Propia Curada** de paradas de carretera (que contiene valoraciones verificadas, volumen de reseñas, nivel de precio `€`–`€€€`, especialidad gastronómica y sentido de acceso) y la complementa en tiempo real con **Overpass API (OpenStreetMap)** para detectar restaurantes/áreas de servicio, gasolineras y puntos de recarga EV cercanos en un radio de $300\text{ m}$ del establecimiento.

### RF-04: Cálculo Real de Desvío y Tipo de Acceso
- Para las paradas candidatas dentro del corredor de la ventana, se calcula el **tiempo real de desvío ida y vuelta**:
  $$\Delta t_{\text{desvío}} = (t_{\text{Origen} \to \text{Parada}} + t_{\text{Parada} \to \text{Destino}}) - t_{\text{Origen} \to \text{Destino}}$$
- Clasificación del acceso:
  - `DIRECT_HIGHWAY`: Área en la propia vía o salida directa con reincorporación inmediata.
  - `EASY_EXIT`: Salida de autovía a menos de 3 min con rotonda de fácil retorno.
  - `TOWN_DETOUR`: Entrada a localidad cercana (> 4 min de desvío).

### RF-05: Ranking de "Parada Óptima" (Top 3–5)
- Ordenación automática según el **OptiStop Score (0–100)** que combina:
  1. Penalización por tiempo de desvío real ($\Delta t_{\text{desvío}}$).
  2. Puntuación de calidad Bayesiana (nota media ponderada por número de reseñas).
  3. Relación calidad/precio (`€`, `€€`, `€€€`).
  4. Afinidad con los filtros de servicios seleccionados (Cargador EV, Gasolinera anexa, Mascotas, Zona infantil, etc.).

### RF-06: Tarjeta de Parada y Navegación 1-Click
- Cada tarjeta del Top 3–5 debe mostrar obligatoriamente:
  - **Badge de Desvío:** `+X min de desvío ida y vuelta` + etiqueta de tipo de acceso (`Acceso directo`, `Salida rápida`, etc.) y punto kilométrico aproximado.
  - **Calidad Ponderada y Precio:** Nota ponderada, número de reseñas, rango de precio (`€` - `€€€`) y recomendación/especialidad.
  - **Servicios Anexos:** Iconos claros para *Cargador EV cercano*, *Gasolinera en el mismo área*, *Parking fácil*, *Baños limpios*, *Terraza/Mascotas*.
  - **Acción de Navegación:** Botones directos a **Google Maps**, **Waze** y **Apple Maps** pasando las coordenadas exactas como waypoint o destino inmediato.

---

## 4. Criterios de Aceptación (Gherkin / BDD)

```gherkin
Feature: Búsqueda de parada óptima por ventana de tiempo en planificación

  Scenario: Usuario busca dónde comer entre las 14:00 y las 15:00 en ruta Madrid -> Valencia
    Given el usuario selecciona Origen "Madrid", Destino "Valencia" y Hora de salida "12:30"
    And selecciona el modo de ventana "Franja horaria" entre "14:00" y "15:00"
    When solicita buscar las paradas óptimas
    Then el sistema identifica el tramo de la A-3 correspondiente a los minutos 90 a 150 de viaje
    And devuelve entre 3 y 5 paradas ordenadas por "OptiStop Score"
    And cada parada muestra el tiempo exacto de desvío ida y vuelta en minutos
    And cada parada muestra su puntuación ponderada, nivel de precio (€-€€€), servicios anexos y enlaces a Google Maps/Waze/Apple Maps.

Feature: Búsqueda rápida "En Ruta" con filtros de servicios anexos

  Scenario: Usuario en ruta busca parar en 30 minutos en un sitio con cargador EV cercano
    Given el usuario activa el modo "En Ruta" con su posición actual y destino
    And selecciona la ventana "En 30-45 min"
    And activa el filtro de característica "Cargador EV cercano"
    When el sistema calcula los candidatos en el corredor delantero
    Then solo se priorizan o filtran restaurantes/cafeterías que dispongan de cargador EV a menos de 300 metros
    And se excluyen paradas que hayan quedado atrás respecto al sentido de la marcha.
```

---

## 5. Requisitos No Funcionales (RNF)

- **RNF-01 (Coste Cero de APIs):** Uso exclusivo de tecnologías y fuentes gratuitas/open-source (`MapLibre GL JS`, `OSRM`, `Nominatim`, `Overpass API` y base de datos propia curada en el proyecto).
- **RNF-02 (Rendimiento y Resiliencia):** Caché local/servidor de rutas y consultas espaciales; si un servidor público de OSRM u Overpass experimenta latencia, el sistema aplica *fallback* inmediato al cálculo geométrico Haversine con factor de tortuosidad vial y a la base de datos curada local en $< 500\text{ ms}$.
- **RNF-03 (Diseño Mobile-First / Copiloto):** En pantallas móviles (modo "En Ruta"), botones táctiles de al menos `48x48 px`, alto contraste y apertura directa de apps nativas de navegación.
