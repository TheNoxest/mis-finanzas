# Mis Finanzas — Fase 4

App web personal (HTML + CSS + JS puro, sin dependencias) para gestionar cuentas, ingresos, gastos e inversiones con precios en vivo.

## Uso
Abre `index.html` en el navegador (doble clic). No necesita instalación.
Los datos se guardan en el `localStorage` de ese navegador. Usa **Ajustes → Copia de seguridad** con regularidad.

## Estructura
```
index.html        Interfaz (Inicio, Movimientos, Cuentas, Inversiones, Análisis; Consejos desde Inicio; Ajustes en el engranaje)
css/styles.css    Estilos (móvil primero, modo claro/oscuro automático)
js/calc.js        Cálculos puros: conversión, saldos, costo promedio, valoración, patrimonio
js/store.js       Persistencia, migración v1→v2, CSV y descargas
js/prices.js      Precios en vivo (Binance, Finnhub, ExchangeRate-API / Frankfurter)
js/charts.js      Gráficos SVG sin dependencias (barras y líneas con tooltip)
js/advisor.js     Perfil de inversor y motor de recomendaciones (reglas fijas)
js/app.js         Renderizado y eventos
tests/index.html  Pruebas de cálculo (deben salir 137 OK)
```

## Fuentes de precios
| Activo | Fuente | API key |
|---|---|---|
| Cripto | Binance (`data-api.binance.vision`, respaldo `api.binance.com`), par TICKER/USDT; USDT = 1 USD | No |
| Acciones / ETF | Finnhub (plan gratis: bolsas de EE. UU., en USD) | Sí, gratis en finnhub.io |
| Divisas | En vivo: Binance (par con USDT, cada 2 min). Sin par: open.er-api.com (diaria), respaldo Frankfurter | No |
| Otros | Precio manual | — |

Si una API falla, se conserva el **último precio conocido con su hora** y se marca como tal.
Los precios se actualizan al abrir la app y cada 2 minutos mientras está visible.

## Reglas de cálculo
- **Conversión:** `monto_base = round(monto × tasa, 2)`; tasa = "1 unidad de la moneda = X de la base".
- **Saldo de cuenta (en su moneda):** inicial + ingresos − gastos + transferencias recibidas − enviadas − compras pagadas + ventas cobradas.
- **Transferencias:** no son ingreso ni gasto. Entre monedas distintas se guarda el monto realmente recibido.
- **Costo promedio ponderado:** compra suma `q×p + comisión`; venta saca `costo × q / cantidad` y realiza `q×p − comisión − costo_salida`.
- **Valor de mercado:** `round(cantidad × precio, 2)` convertido a base. G/P = valor − costo; G/P % = G/P / costo × 100.
- **Patrimonio:** suma de saldos de cuentas + valor de mercado de inversiones (sin precio → a costo).

## Análisis (Fase 3)
- **Filtros** (afectan todo el panel): periodo, categoría, cuenta y tipo de activo.
- **Comparación:** los periodos por meses se comparan con el mismo tramo de los meses anteriores
  (p. ej. 1–13 oct vs. 1–13 sept); «Todo» y «Personalizado», con el periodo inmediatamente anterior de igual duración.
- **Tasa de ahorro** = (ingresos − gastos) / ingresos × 100.
- **Evolución del patrimonio:** se reconstruye con los movimientos (saldos a tasas actuales; inversiones a costo en
  fechas pasadas y a mercado hoy). La app guarda una foto diaria con valor de mercado; si cambias un movimiento con
  fecha pasada, las fotos desde esa fecha se descartan para no mostrar datos desactualizados.

## Recomendaciones (Fase 4)
Sugerencias automáticas con reglas fijas, **no asesoría financiera profesional**. Cada una muestra el porqué y los datos exactos.

| Perfil | Inversiones de riesgo | Cripto máx. | Un activo máx. | Fondo de emergencia |
|---|---|---|---|---|
| Conservador (≤ 10 pts) | 10–35 % del patrimonio | 2 % | 20 % | 9 meses |
| Moderado (11–15 pts) | 35–65 % | 5 % | 25 % | 6 meses |
| Agresivo (≥ 16 pts) | 60–90 % | 10 % | 35 % | 4 meses |

Horizonte < 2 años limita el perfil a conservador; 2–5 años, a moderado. Los parámetros están en `js/advisor.js` (`PROFILES`).

Reglas: fondo de emergencia (saldo en cuentas ÷ gasto mensual promedio), tasa de ahorro vs. meta, categorías de gasto
que suben ≥ 25 % (promedios solo de meses con datos), exposición a riesgo y a cripto vs. perfil, concentración por activo
y por tipo, movimientos de mercado (24 h ≥ 5 %, 30 días ≥ 15 % con datos de Binance), pérdidas ≥ 20 %, comisiones ≥ 1 % y
activos sin precio.

La app avisa en Inicio si pasan 30 días sin copia de seguridad.

## Ficha de activo
Busca un activo con la lupa (arriba) o en Inversiones, o toca uno de «Mis activos».
- **Cripto (sin API key):** nombre y logo (CoinGecko), precio en vivo por WebSocket de Binance (respaldo: consulta cada 5 s),
  historial (1 D, 1 S, 1 M, 3 M, 1 A, Todo y «Mis operaciones») y volumen de 24 h.
  El buscador solo lista pares USDT con operaciones en las últimas 24 h (excluye pares retirados).
- **Acciones/ETF (API key de Finnhub):** nombre, logo y precio cada 15 s. El historial de acciones no está en el plan
  gratuito de Finnhub, así que se muestran tus operaciones en lista.
- **Gráfico:** ▲ compras y ▼ ventas en la fecha y al precio de cada operación (convertido a USD con la tasa actual si
  operaste en otra moneda) y línea punteada con tu costo promedio. Si tienes el activo, el precio en vivo también
  actualiza tu portafolio (se guarda como máximo cada 30 s).

## Terceros (pestaña Cuentas)
Secciones: **Mis cuentas · Por cobrar · Por pagar · Cambios**.

**Por cobrar / por pagar:** persona, concepto, monto, moneda, fecha y vencimiento. Si al crearla se movió dinero
(préstamo), se indica la cuenta y su saldo cambia. Los abonos parciales entran (por cobrar) o salen (por pagar) de la
cuenta elegida. Estados: pendiente, parcial, saldada, vencida.

**Cambios de divisas a terceros:**
- comisión = % del monto o monto fijo (convertido a la moneda que envía el cliente);
- *descontada*: el cliente envía el monto y recibe (monto − comisión) × tasa; *aparte*: envía monto + comisión y recibe monto × tasa;
- costos que pagas (banco, red…) con su cuenta;
- ganancia = recibido − entregado − costos (en moneda base, con las tasas del día del registro, así no cambia después)
  = comisión + diferencial de tasa − costos;
- estados: completado, «recibido, falta entregar» (aparece en Por pagar) y «entregado, falta cobrar» (en Por cobrar).

**Integración:** saldos de cuentas; patrimonio = cuentas + inversiones + te deben − debes; la ganancia de cambios
completados cuenta como ingreso («Cambios de divisa») en análisis, ahorro y recomendaciones; avisos de cobros vencidos
y pagos que vencen en 7 días; exportación CSV. USDT/USDC como moneda de cuenta valen lo mismo que el USD.

## Divisas y paridad USD = USDT
- **1 USDT = 1 USDC = 1 USD siempre**: todos los cálculos usan la tasa del USD para estas monedas, aunque la tabla tenga
  guardado otro valor (corrige ganancias falsas en cambios USD↔USDT).
- Monedas de trabajo: **USD, USDT y EUR** (se crean solas). Puedes añadir otras en Ajustes: con la tasa vacía quedan
  conectadas a las tasas automáticas (**en vivo** desde Binance si hay par con USDT: EUR, GBP, MXN, BRL, ARS, COP, TRY…;
  si no, tasa diaria). Si escribes una tasa, queda fija («Manual»). Cada moneda muestra su fuente y hora.
- En **Cambios**, la tasa se escribe en la forma habitual (la moneda que no es dólar cotizada en dólares, p. ej.
  1 EUR = 1.12 USD), se puede invertir, muestra la tasa de mercado y avisa si la escrita se aleja más de un 3 %
  (p. ej., si está invertida). El monto a entregar se recalcula al cambiar monto, tasa o comisión.

## Cuentas en cualquier moneda y activos por cuenta
- Al crear una cuenta puedes elegir cualquier moneda del catálogo (USD, USDT, EUR, USDC, GBP, MXN, COP, ARS, BRL, VES…).
  Si la moneda es nueva, se añade sola y se conecta a su tasa (en vivo si Binance la cotiza; si no, diaria).
- Cada compra o venta tiene **«Guardado en»** (custodia): por defecto, la misma cuenta con la que pagas. Así, lo
  comprado desde Binance queda en Binance; también puedes pagar desde un banco y guardar el activo en otra billetera.
- **Ficha de cuenta** (toca una cuenta): valor total = saldo disponible + activos a precio de mercado, distribución,
  lista de activos (con acceso a su ficha) y todos los movimientos de la cuenta (ingresos, gastos, transferencias,
  compras y ventas, cambios de divisas, préstamos y abonos). Botones para comprar un activo desde esa cuenta.
