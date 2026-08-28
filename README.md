# SÍMODI — Sistema de Monitoreo de Diuresis

Proyecto final de **Instrumentación Biomédica II**. Es un instrumento para medir
diuresis horaria en pacientes internados (sonda vesical + bolsa colectora) y una
central web para que enfermería y los médicos monitoreen varias camas a la vez,
como una central de monitoreo real.

## 1. Qué mide el instrumento

Un módulo con **ESP32** montado sobre la bolsa colectora mide, cada pocos segundos:

| Variable | Sensor | Para qué sirve |
|---|---|---|
| **Peso** de la bolsa | celda de carga + HX711 | se convierte a volumen de orina (densidad ≈ 1.015 g/mL) → volumen acumulado y diuresis en mL/h |
| **Temperatura** de la orina | sensor de temperatura en línea | proxy de temperatura corporal; detecta fiebre/hipotermia |
| **Color** de la orina | sensor RGB (tipo TCS34725) | hidratación (escala de 8 niveles) y colores anómalos (hematuria, coluria, piuria) |

Con peso + volumen + tiempo se calcula la **diuresis en mL/kg/h**, que es el dato
que de verdad importa clínicamente: los criterios **KDIGO** de lesión renal aguda
se definen así (oliguria < 0,5 mL/kg/h sostenida ≥ 6 h, anuria < 0,1 mL/kg/h).

## 2. Por qué la interfaz muestra varias camas

Para la defensa se construye **un solo dispositivo físico**, pero el objetivo del
proyecto es una central de monitoreo real, que en un hospital mira varias camas al
mismo tiempo. Para poder mostrar eso con un solo equipo, la web tiene dos modos:

- **PILOTO** — genera pacientes sintéticos con distintos cuadros clínicos
  (evolución normal, oliguria/LRA, sepsis, poliuria, hematuria, obstrucción de
  sonda, bolsa por rebalsar, etc.), para demostrar cómo se comporta la central
  con una sala completa.
- **REAL** — recibe datos del ESP32 por WiFi (WebSocket o HTTP), Bluetooth (BLE) o
  cable USB (Web Serial), y los muestra en su cama correspondiente. Si se corta el
  enlace, el ESP32 puede guardar las muestras y reenviarlas al reconectar; la
  central las marca como "recuperadas del búfer" pero no pierde el dato.

Cada cama tiene un **paciente** y un **dispositivo** (identificado por su número
de serie) vinculados entre sí; esa asignación se puede cambiar en cualquier
momento desde "Asignar paciente" cuando entra o sale alguien de la cama.

## 3. Cómo abrir la central

No hace falta instalar nada ni compilar nada: es HTML + CSS + JS puro.

```
central/index.html   → abrir directo con doble clic, o servir la carpeta central/
```

Si el navegador bloquea algo por abrirlo como `file://` (pasa a veces con
Bluetooth/USB), se puede levantar un servidor local sin instalar nada:

```bash
cd central
python -m http.server 8080
# abrir http://localhost:8080
```

Bluetooth (Web Bluetooth) y USB (Web Serial) sólo funcionan en Chrome/Edge, y
sólo si la página se sirve por `http://localhost` o `https://` (no por `file://`).

## 4. Estructura del proyecto

```
central/
  index.html            estructura de la página (barra superior, mural de camas, modales)
  css/estilos.css        todo el estilo (tema oscuro + tema claro)
  img/                    logo SÍMODI y favicons
  js/
    config.js             parámetros ajustables: umbrales clínicos, escala de color,
                           calibración de la medición, URL del ESP32
    util.js                formato, tiempo, color (RGB↔Lab), audio de alarma
    almacenamiento.js      guarda todo en localStorage (pacientes, camas, historial)
    modelo.js              estado de la central + cálculo de diuresis/KDIGO
    alertas.js              motor de alarmas clínicas y técnicas
    simulador.js            escenarios del modo piloto
    conexion.js              enlace real con el ESP32 (WebSocket/HTTP/BLE/USB)
    graficos.js              gráficos dibujados a mano en <canvas>, sin librerías
    ui.js                     todo el renderizado de pantalla
    app.js                    arranque de la app y acciones de usuario
monitor_diuresis.html    prototipo inicial de una sola cama (versión anterior)
Ideas Instru II (7).pdf  apuntes/consigna de la materia
logo.pdf                  logo original en alta resolución (vectorial)
```

## 5. Protocolo de datos del ESP32 (para quien programe el firmware)

La central espera líneas de **JSON**, una por muestra:

```json
{"serie":"URO-0001","t":1735300000,"peso":412.5,"temp":36.8,"rgb":[210,180,60],"bat":87,"rssi":-62}
```

- `serie`: identifica el dispositivo (si es nuevo, la central lo da de alta solo).
- `t`: epoch en segundos (si el ESP32 no tiene RTC, se puede omitir).
- `peso`: gramos totales que ve la celda de carga (bolsa + soporte + orina).
- `rgb`: lectura cruda del sensor de color.

Si se cortó el enlace y el equipo guardó datos en su memoria, al reconectar se
puede mandar todo junto en un lote:

```json
{"serie":"URO-0001","lote":[{"t":...,"peso":...}, {"t":...,"peso":...}]}
```

La configuración de la URL/puerto de conexión se edita desde el botón de
engranaje (⚙) de la propia central, en **Configuración → Enlace con el
dispositivo real**.

## 6. Trabajar en equipo / GitHub

- Todo el proyecto vive en este repo. Cada uno clona, edita y hace su commit.
- Como no hay build ni dependencias, alcanza con editar los archivos de
  `central/` y refrescar el navegador para ver los cambios.
- Se sugiere una rama por persona/feature y Pull Request a `main` para que el
  resto pueda revisar antes de mezclar (evita pisarse los cambios en `app.js`
  o `ui.js`, que son los archivos más compartidos).
- Los datos de pacientes que carga cada uno quedan en el `localStorage` de su
  propio navegador — no se sincronizan entre compañeros ni se suben al repo.
