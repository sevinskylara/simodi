/* ======================================================================
   ble.ino - Envio de datos a la central web por Bluetooth (BLE)

   La web (Conectar dispositivo -> Bluetooth) busca equipos cuyo nombre
   empieza con "URO-" y se suscribe a esta caracteristica. Cada muestra se
   manda como una linea JSON terminada en "\n":
     {"serie":"URO-0001","vol":412,"temp":36.8,"rgb":[242,216,74],"bat":87}
   Se manda en trozos de 20 bytes (lo que entra en un paquete BLE); la web
   vuelve a juntar la linea.
   ====================================================================== */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// Los mismos identificadores que espera la web (config.js)
#define BLE_SERVICIO       "0000ffe0-0000-1000-8000-00805f9b34fb"
#define BLE_CARACTERISTICA "0000ffe1-0000-1000-8000-00805f9b34fb"

BLECharacteristic *caracteristica = nullptr;
volatile bool clienteConectado = false;

class CallbacksServidor : public BLEServerCallbacks {
  void onConnect(BLEServer *s) override {
    clienteConectado = true;
    Serial.println("Web conectada por Bluetooth");
  }
  void onDisconnect(BLEServer *s) override {
    clienteConectado = false;
    Serial.println("Web desconectada. Esperando nueva conexion...");
    delay(200);
    BLEDevice::startAdvertising();   // vuelve a estar visible
  }
};

void iniciarBLE() {
  BLEDevice::init(SERIE);
  BLEServer *servidor = BLEDevice::createServer();
  servidor->setCallbacks(new CallbacksServidor());

  BLEService *servicio = servidor->createService(BLE_SERVICIO);
  caracteristica = servicio->createCharacteristic(
    BLE_CARACTERISTICA,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  caracteristica->addDescriptor(new BLE2902());
  servicio->start();

  BLEAdvertising *anuncio = BLEDevice::getAdvertising();
  anuncio->addServiceUUID(BLE_SERVICIO);
  anuncio->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("Bluetooth activo como " SERIE);
}

bool bleConectado() {
  return clienteConectado;
}

void enviarMuestraBLE(const DatosMonitor &d) {
  char json[160];
  char temp[12];
  if (isnan(d.temperatura)) strcpy(temp, "null");
  else snprintf(temp, sizeof(temp), "%.1f", d.temperatura);

  // Si todavia no hay lectura de color (sensor no conectado), no se manda
  // "rgb": un [0,0,0] la web lo clasificaria como "Marron oscuro".
  char color[24] = "";
  if (d.r || d.g || d.b) snprintf(color, sizeof(color), ",\"rgb\":[%d,%d,%d]", d.r, d.g, d.b);

  snprintf(json, sizeof(json),
           "{\"serie\":\"%s\",\"vol\":%d,\"temp\":%s%s,\"bat\":%d}\n",
           SERIE, d.volumen, temp, color, d.bateria);

  Serial.print(json);                 // tambien por USB, para ver que se manda
  if (!clienteConectado || !caracteristica) return;

  size_t largo = strlen(json);
  for (size_t i = 0; i < largo; i += 20) {
    size_t n = min((size_t)20, largo - i);
    caracteristica->setValue((uint8_t *)(json + i), n);
    caracteristica->notify();
    delay(8);
  }
}
