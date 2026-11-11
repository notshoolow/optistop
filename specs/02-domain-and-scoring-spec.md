# 02. Especificación de Dominio y Algoritmo de Optimización

**Proyecto:** OptiStop  
**Módulo:** Motor Geométrico de Ventana y Algoritmo `OptiStopScore`  

---

## 1. Definición de la "Ventana de Parada" (Stop Window Slicing)

Una ruta $R$ devuelta por OSRM se representa como una secuencia ordenada de vértices $(p_0, p_1, \dots, p_n)$, donde cada vértice $p_i = (\text{lat}_i, \text{lon}_i, d_i, t_i)$ tiene asociada una distancia acumulada $d_i$ (en km) y un tiempo estimado acumulado $t_i$ (en minutos) desde el inicio de la ruta (o desde la posición GPS actual del usuario en el modo *En Ruta*).

### 1.1 Modos de Entrada de la Ventana
1. **Por Tiempo Restante / Transcurrido ($t_{\text{target}} \pm \Delta w$):**
   - Ejemplo: *"Quiero parar en 45 min"* $\implies [T_{\min}, T_{\max}] = [30, 60]\text{ min}$.
2. **Por Franja Horaria ($[\text{Hora}_{\text{ini}}, \text{Hora}_{\text{fin}}]$):**
   - Dada la hora de salida $H_{\text{salida}}$, se transforma a minutos de viaje:
     $$T_{\min} = \max(5, \text{Hora}_{\text{ini}} - H_{\text{salida}}), \quad T_{\max} = \text{Hora}_{\text{fin}} - H_{\text{salida}}$$
3. **Por Distancia ($d_{\text{target}} \pm \Delta d$):**
   - Ejemplo: *"Parar a los 150 km ($\pm 25\text{ km}$)"* $\implies [D_{\min}, D_{\max}] = [125, 175]\text{ km}$.

### 1.2 Extracción del Sub-Tramo (Corridor Segment)
El motor filtra los segmentos de la polilínea tales que $t_i \in [T_{\min}, T_{\max}]$ (o $d_i \in [D_{\min}, D_{\max}]$), obteniendo la sub-polilínea activa $R_{\text{window}}$.
- Cualquier establecimiento candidato $S$ se proyecta ortogonalmente sobre $R_{\text{window}}$ obteniendo:
  - $d_{\perp}(S, R_{\text{window}})$: distancia mínima en línea recta a la vía (en km).
  - $t_{\text{along}}(S)$: minuto estimado de llegada al desvío desde el inicio.
- **Filtro de pre-selección espacial:** Se descartan inmediatamente aquellos puntos con $d_{\perp}(S, R_{\text{window}}) > 6.0\text{ km}$ para evitar desvíos excesivos.

---

## 2. Cálculo del Tiempo Real de Desvío ($\Delta t_{\text{detour}}$)

El desvío real **no es solo la distancia a la autovía**, sino el coste total en minutos de salir de la ruta, llegar al aparcamiento del restaurante/área de descanso y **volver a incorporarse a la ruta en el sentido de la marcha**.

1. **Cálculo OSRM (Preciso):**
   Dado el punto de salida en la ruta antes de la parada $p_{\text{pre}}$ y el punto de reincorporación posterior $p_{\text{post}}$:
   $$\Delta t_{\text{detour}} = \left( t_{\text{OSRM}}(p_{\text{pre}} \to S) + t_{\text{OSRM}}(S \to p_{\text{post}}) \right) - t_{\text{OSRM}}(p_{\text{pre}} \to p_{\text{post}})$$
2. **Penalización por Sentido de la Vía (`accessType`):**
   - `DIRECT_SERVICE_AREA` (Área en la propia vía con acceso en sentido o puente/pasarela directa): $+0\text{ min}$ extra.
   - `HIGHWAY_EXIT_EASY` (Salida inmediata con rotonda a $< 800\text{ m}$ de la autovía): $+1.5\text{ min}$ de maniobra.
   - `OPPOSITE_DIRECTION_OVERPASS` (Requiere cambio de sentido por paso elevado): $+2.5\text{ min}$ de maniobra.
   - `TOWN_ENTRY` (Entrada a casco urbano de pueblo cercano): $+3.0\text{ min}$ por semáforos/aparcamiento.

---

## 3. Puntuación de Calidad Ponderada (Bayesian Rating)

Para evitar el sesgo clásico donde un local con **1 sola reseña de 5.0 estrellas** supera a un restaurante consolidado con **1.400 reseñas y 4.6 estrellas**, aplicamos la **Media Bayesiana (Fórmula IMDB/Dirichlet)**:

$$R_{\text{bayes}}(S) = \frac{v \cdot R + m \cdot C}{v + m}$$

Donde:
- $R \in [1.0, 5.0]$: Nota media del establecimiento.
- $v \ge 0$: Número total de reseñas verificadas/registradas.
- $m = 50$: Umbral de confianza mínimo de reseñas.
- $C = 3.8$: Nota media base de los establecimientos de carretera.

> **Ejemplo:**
> - Sitio A ($4.9\star$ con $5$ reseñas): $R_{\text{bayes}} = \frac{5(4.9) + 50(3.8)}{55} = \mathbf{3.90}$
> - Sitio B ($4.5\star$ con $800$ reseñas): $R_{\text{bayes}} = \frac{800(4.5) + 50(3.8)}{850} = \mathbf{4.46}$ (Gana justamente el Sitio B).

Normalizamos $R_{\text{bayes}}$ a una escala $[0, 100]$:
$$Q_{\text{score}}(S) = \text{clamp}\left(\frac{R_{\text{bayes}}(S) - 2.5}{5.0 - 2.5} \times 100, \, 0, \, 100\right)$$

---

## 4. Relación Calidad / Precio ($V_{\text{score}}$)

Cada establecimiento tiene un nivel de precio $P \in \{1\text{ (€)}, 2\text{ (€€)}, 3\text{ (€€€)}\}$:
- Si $P = 1$ (€ - Menú del día / bocadillos económicos / alta rotación): Factor de valor $= +10\text{ pts}$ si $R_{\text{bayes}} \ge 4.0$.
- Si $P = 2$ (€€ - Restaurante tradicional / brasa): Factor neutro $= +5\text{ pts}$ si $R_{\text{bayes}} \ge 4.2$.
- Si $P = 3$ (€€€ - Gastronómico / ticket alto): Factor $= 0\text{ pts}$ (o penalización si el usuario busca parada rápida económica).

---

## 5. Fórmula Maestra: `OptiStopScore` (0 a 100)

El índice compuesto final que ordena el **Top 3–5 de paradas óptimas** se define como:

$$\text{OptiStopScore}(S) = w_D \cdot D_{\text{score}}(S) + w_Q \cdot Q_{\text{score}}(S) + w_V \cdot V_{\text{score}}(S) + w_A \cdot A_{\text{score}}(S)$$

Con pesos por defecto para el **Criterio Combinado**:
- $w_D = 0.40$ (**Mínimo Desvío y Facilidad de Acceso**):
  $$D_{\text{score}}(S) = 100 \cdot e^{-0.14 \cdot \Delta t_{\text{detour}}}$$
  *(Un desvío de $0\text{ min}$ da $100\text{ pts}$; $3\text{ min}$ da $65.7\text{ pts}$; $6\text{ min}$ da $43.2\text{ pts}$; $>12\text{ min}$ cae por debajo de $18\text{ pts}$).*
- $w_Q = 0.35$ (**Calidad Ponderada Bayesiana** $Q_{\text{score}}$).
- $w_V = 0.15$ (**Relación Calidad/Precio y Centrado en la Ventana Temporal**).
- $w_A = 0.10$ (**Bonus por Servicios Anexos Completos / Requeridos por el Usuario**: Cargador EV cercano, Gasolinera en el mismo área, Parking fácil, Baños limpios, Mascotas, Zona infantil).
  - *Nota:* Si el usuario marca un servicio como **requisito estricto** (ej. *"Necesito Cargador EV"*), actúa como filtro duro (`WHERE hasEvChargerNearby = true`) además de puntuar.
