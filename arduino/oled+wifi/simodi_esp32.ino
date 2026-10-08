/*
 * SIMODI - Firmware del ESP32
 * Mide peso (HX711), temperatura (NTC + ADS1115) y color (TCS34725),
 * muestra los datos en la pantalla ILI9488 y los manda por Bluetooth (BLE)
 * a la central web: https://sevinskylara.github.io/simodi/
 *
 * Archivos (pestanias del IDE):
 *   simodi_esp32.ino  -> configuracion, setup y loop (este archivo)
 *   ble.ino           -> envio de datos a la web por Bluetooth
 *   diuresis.ino      -> volumen acumulado y diuresis horaria
 *   pantalla.ino      -> dibujo del display
 *   sensores.ino      -> lectura de celda de carga, NTC, color y bateria
 *   tipos_monitor.h + fuentes FreeMono*.h
 *
 * Librerias (Gestor de librerias):
 *   - GFX Library for Arduino (Arduino_GFX, moononournation)
 *   - HX711 Arduino Library (Bogdan Necula)
 *   - Adafruit TCS34725
 *   - Adafruit ADS1X15
 *   El Bluetooth (BLE) viene incluido con la placa ESP32.
 *
 * IMPORTANTE: en Herramientas -> Partition Scheme elegir
 *   "Huge APP (3MB No OTA/1MB SPIFFS)". Con Bluetooth el programa no entra
 *   en la particion por defecto.
 */

#include <Wire.h>
#include <Preferences.h>
#include <Arduino_GFX_Library.h>
#include "HX711.h"
#include <Adafruit_TCS34725.h>
#include <Adafruit_ADS1X15.h>
#include "FreeMono12pt7b.h"
#include "FreeMonoBold9pt7b.h"
#include "FreeMonoBold12pt7b.h"
#include "FreeMonoBold18pt7b.h"
#include "FreeMonoBold24pt7b.h"
#include "FreeMonoBold36pt7b.h"
#include "tipos_monitor.h"

// =================================================================== CONFIG

// --- Identificacion del equipo (la web lo reconoce por este numero) ---
#define SERIE "URO-0001"          // tiene que empezar con "URO-"

// --- Paciente ---
// La diuresis en mL/kg/h necesita el peso. Tiene que ser el MISMO peso que
// se carga en la web al asignar el paciente, para que ambos numeros coincidan.
float PESO_PACIENTE_KG = 70.0;

// --- Medicion (mismos valores que la web, en Configuracion) ---
const float DENSIDAD_ORINA   = 1.015;  // g/mL
const int   CAPACIDAD_BOLSA  = 2000;   // mL
const float FACTOR_CALIBRACION = 420.0; // HX711: cuentas por gramo (ver sensores.ino)

// --- Umbrales (solo cambian el color de los numeros en pantalla) ---
const float UMBRAL_OLIGURIA = 0.5;     // mL/kg/h
const float UMBRAL_POLIURIA = 3.0;     // mL/kg/h
const float UMBRAL_FIEBRE   = 38.0;    // C
const int   UMBRAL_BATERIA  = 20;      // %

// --- Tiempos ---
const unsigned long PERIODO_LECTURA_MS = 1000;   // lectura de sensores
const unsigned long PERIODO_ENVIO_MS   = 3000;   // envio a la web (igual que la web)

// --- Prueba sin sensores ---
// 1 = inventa valores para probar pantalla + Bluetooth sin el hardware armado
#define SIMULAR_SENSORES 0

// ===================================================================== PINES
#define TFT_DC      2
#define TFT_CS     15
#define TFT_SCK    18
#define TFT_MOSI   23
#define TFT_RST     4

#define HX_DT      32
#define HX_SCK     33

#define I2C_SDA    25
#define I2C_SCL    26

#define PIN_LED_COLOR 27   // LED blanco de transiluminacion
#define PIN_LED_R  16
#define PIN_LED_G  17
#define PIN_BUZZ   13
#define PIN_BTN_TARE   35  // con pull-up externo (R1 10k), activo en LOW
#define PIN_BTN_ALARMA 34
#define PIN_BAT_ADC    39

// =================================================================== OBJETOS
Arduino_DataBus *bus = new Arduino_ESP32SPI(TFT_DC, TFT_CS, TFT_SCK, TFT_MOSI, GFX_NOT_DEFINED);
Arduino_GFX *tft = new Arduino_ILI9488_18bit(bus, TFT_RST, 1, false);

HX711 balanza;
Adafruit_TCS34725 sensorColor(TCS34725_INTEGRATIONTIME_154MS, TCS34725_GAIN_4X);
Adafruit_ADS1115 ads;
Preferences prefs;

bool hayBalanza = false, hayColor = false, hayADS = false;

DatosMonitor datos;

// ===================================================================== SETUP
void setup() {
  Serial.begin(115200);
  Serial.println("SIMODI arrancando...");

  pinMode(PIN_LED_R, OUTPUT);
  pinMode(PIN_LED_G, OUTPUT);
  pinMode(PIN_BUZZ, OUTPUT);
  pinMode(PIN_LED_COLOR, OUTPUT);
  pinMode(PIN_BTN_TARE, INPUT);
  pinMode(PIN_BTN_ALARMA, INPUT);
  digitalWrite(PIN_LED_R, HIGH);   // rojo hasta que la web se conecte

  tft->begin(10000000);

  datos.bateria = 100;
  datos.cargando = false;
  datos.diuresis = NAN;
  datos.temperatura = NAN;
  datos.volumen = 0;
  datos.capacidad = CAPACIDAD_BOLSA;
  strcpy(datos.colorNombre, "---");
  datos.r = datos.g = datos.b = 0;
  actualizarPantalla(datos);

  iniciarSensores();
  iniciarBLE();

  Serial.println("Listo. Buscar el equipo " SERIE " desde la web (Conectar dispositivo -> Bluetooth).");
}

// ====================================================================== LOOP
void loop() {
  static unsigned long tLectura = 0, tEnvio = 0;
  unsigned long ahora = millis();

  revisarBotonTara();

  if (ahora - tLectura >= PERIODO_LECTURA_MS) {
    tLectura = ahora;

    leerSensores(datos);                       // volumen, temperatura, color, bateria
    registrarVolumen(datos.volumen, ahora);    // acumulado + historial para la diuresis
    datos.diuresis = diuresisMlKgH(ahora);

    actualizarPantalla(datos);

    bool conectado = bleConectado();
    digitalWrite(PIN_LED_G, conectado ? HIGH : LOW);
    digitalWrite(PIN_LED_R, conectado ? LOW : HIGH);
  }

  if (ahora - tEnvio >= PERIODO_ENVIO_MS) {
    tEnvio = ahora;
    enviarMuestraBLE(datos);
  }
}
