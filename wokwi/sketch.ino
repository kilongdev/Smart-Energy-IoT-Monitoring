#include <ArduinoJson.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASSWORD = "";
const char* MQTT_HOST = "k264d6cc.ala.asia-southeast1.emqxsl.com";
const int MQTT_PORT = 8883;
const char* MQTT_USER = "dossdoss2k5";
const char* MQTT_PASSWORD = "YOUR_EMQX_PASSWORD";
const char* DEVICE_ID = "44444444-4444-4444-8444-444444444444";
const char* ROOM_ID = "A101";
const char* TOPIC_BASE = "campus/demo/device1";

const float RATED_POWER_W = 4000;
const float ESSENTIAL_W = 40;
const float NOMINAL_V = 220;
const float POWER_FACTOR = 0.95;

const int RELAY_PIN = 2;
const int DHT_PIN = 4;
const int POT_PIN = 34;
const int ALARM_PIN = 15;
const int BREAKER_PIN = 12;
const unsigned long SAMPLE_INTERVAL = 2000;

struct Load {
  const char* key;
  uint8_t switchPin;
  uint8_t ledPin;
  float watts;
  bool cycling;
  unsigned long offset;
};

Load loads[] = {
  {"den", 32, 18, 360, false, 0},
  {"quat", 33, 19, 240, false, 0},
  {"may_lanh_1", 14, 23, 1100, true, 0},
  {"may_lanh_2", 16, 5, 1100, true, 17000},
  {"may_chieu", 17, 13, 250, false, 0},
};
const int LOAD_COUNT = sizeof(loads) / sizeof(loads[0]);

enum Mode { NORMAL, OVERLOAD, SAG, SURGE, LEAK };
const char* MODE_NAMES[] = {
  "binh_thuong",
  "qua_tai",
  "sut_ap",
  "tang_ap",
  "ro_dien",
};

struct FaultButton {
  uint8_t pin;
  Mode mode;
  bool lastState;
};

FaultButton buttons[] = {
  {25, OVERLOAD, true},
  {26, SAG, true},
  {27, LEAK, true},
};

WiFiClientSecure tls;
PubSubClient mqtt(tls);
DHT dht(DHT_PIN, DHT22);
Adafruit_SSD1306 oled(128, 64, &Wire, -1);

bool oledReady = false;
bool relayState = true;
bool lastBreakerState = true;
Mode currentMode = NORMAL;
float energyKwh = 0;
float currentPower = 0;
float currentVoltage = NOMINAL_V;
float currentAmps = 0;
float currentTemperature = 0;
float currentLeak = 0;
unsigned long lastSample = 0;
unsigned long lastOled = 0;
unsigned long lastButton = 0;
unsigned long lastBreaker = 0;

String isoNow() {
  time_t now = time(nullptr);
  struct tm utc;
  gmtime_r(&now, &utc);
  char value[32];
  strftime(value, sizeof(value), "%Y-%m-%dT%H:%M:%S.000Z", &utc);
  return String(value);
}

bool isLoadOn(int index) {
  return digitalRead(loads[index].switchPin) == LOW;
}

float loadPower(int index, float noise) {
  Load& load = loads[index];
  if (!load.cycling) {
    return load.watts * noise;
  }

  unsigned long phase = (millis() + load.offset) % 40000;
  return (phase < 30000 ? load.watts : load.watts * 0.12) * noise;
}

void setRelay(bool enabled) {
  relayState = enabled;
  if (!enabled) {
    currentMode = NORMAL;
  }
  digitalWrite(RELAY_PIN, enabled ? HIGH : LOW);
  Serial.printf(
    ">> Contactor phong: %s\n",
    enabled ? "DONG (co dien)" : "NGAT (mat dien)"
  );
}

bool setMode(const char* name) {
  for (int i = 0; i < 5; i++) {
    if (strcmp(name, MODE_NAMES[i]) == 0) {
      currentMode = static_cast<Mode>(i);
      Serial.printf(">> Che do gia lap: %s\n", MODE_NAMES[i]);
      return true;
    }
  }
  return false;
}

void updateLoadLeds() {
  for (int i = 0; i < LOAD_COUNT; i++) {
    digitalWrite(
      loads[i].ledPin,
      relayState && isLoadOn(i) ? HIGH : LOW
    );
  }
}

void publishAck(const char* commandId) {
  JsonDocument ack;
  ack["ma_thiet_bi"] = DEVICE_ID;
  ack["ma_lenh"] = commandId;
  ack["trang_thai_relay"] = relayState;
  ack["thoi_gian"] = isoNow();

  String payload;
  serializeJson(ack, payload);
  mqtt.publish((String(TOPIC_BASE) + "/ack").c_str(), payload.c_str());
}

void onMqttMessage(char* topic, byte* bytes, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) {
    message += static_cast<char>(bytes[i]);
  }

  if (String(topic) != String(TOPIC_BASE) + "/command") {
    return;
  }

  JsonDocument command;
  if (deserializeJson(command, message)) {
    Serial.println("MQTT command JSON khong hop le");
    return;
  }

  const char* deviceId = command["ma_thiet_bi"] | "";
  const char* action = command["hanh_dong"] | "";
  const char* commandId = command["ma_lenh"] | "";

  if (strcmp(deviceId, DEVICE_ID) != 0) {
    return;
  }

  if (strcmp(action, "Bật") == 0) {
    setRelay(true);
  } else if (strcmp(action, "Tắt") == 0) {
    setRelay(false);
  } else {
    Serial.println("MQTT command khong hop le");
    return;
  }

  publishAck(commandId);
}

void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.println("WiFi mat ket noi, dang ket noi lai...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 15000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  Serial.println(
    WiFi.status() == WL_CONNECTED
      ? "WiFi da ket noi lai"
      : "WiFi ket noi lai that bai"
  );
}

void connectMqtt() {
  while (!mqtt.connected()) {
    String clientId = "wokwi-energy-room-a101-" + WiFi.macAddress();
    clientId.replace(":", "");

    Serial.println("Dang ket noi MQTT...");
    if (mqtt.connect(clientId.c_str(), MQTT_USER, MQTT_PASSWORD)) {
      Serial.println("MQTT da ket noi");
      mqtt.subscribe((String(TOPIC_BASE) + "/command").c_str());
      mqtt.subscribe((String(TOPIC_BASE) + "/config").c_str());
    } else {
      Serial.print("MQTT loi, state=");
      Serial.println(mqtt.state());
      delay(2000);
    }
  }
}

void readButtons() {
  for (FaultButton& button : buttons) {
    bool state = digitalRead(button.pin);
    if (button.lastState && !state && millis() - lastButton > 250) {
      lastButton = millis();
      setMode(MODE_NAMES[currentMode == button.mode ? NORMAL : button.mode]);
    }
    button.lastState = state;
  }
}

void readBreaker() {
  bool state = digitalRead(BREAKER_PIN);
  if (lastBreakerState && !state && millis() - lastBreaker > 250) {
    lastBreaker = millis();
    setRelay(!relayState);
  }
  lastBreakerState = state;
}

void readSerialCommand() {
  if (!Serial.available()) {
    return;
  }

  String command = Serial.readStringUntil('\n');
  command.trim();
  command.toLowerCase();

  if (command == "on" || command == "bat") {
    setRelay(true);
  } else if (command == "off" || command == "tat") {
    setRelay(false);
  } else if (command == "normal") {
    setMode("binh_thuong");
  } else if (command.length() && !setMode(command.c_str())) {
    Serial.println(
      "Lenh: on | off | normal | qua_tai | sut_ap | tang_ap | ro_dien"
    );
  }
}

void drawOled() {
  if (!oledReady) {
    return;
  }

  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 0);
  oled.printf("Phong %s [TEST]", ROOM_ID);
  oled.setCursor(0, 12);
  oled.printf(
    "%.0f W (%.0f%%)",
    currentPower,
    currentPower * 100 / RATED_POWER_W
  );
  oled.setCursor(0, 22);
  oled.printf(
    "%.1fV %.2fA %.1fC",
    currentVoltage,
    currentAmps,
    currentTemperature
  );
  oled.setCursor(0, 32);
  oled.printf("Ro:%.1fmA %.3fkWh", currentLeak, energyKwh);
  oled.setCursor(0, 42);
  oled.printf("Dien phong: %s", relayState ? "CO" : "CAT");
  oled.setCursor(0, 54);
  if (currentMode != NORMAL) {
    oled.printf("!! %s", MODE_NAMES[currentMode]);
  } else {
    oled.print("Binh thuong");
  }
  oled.display();
}

void sampleAndPublish() {
  float usage = analogRead(POT_PIN) / 4095.0;
  float noise = 1.0 + random(-30, 31) / 1000.0;
  float voltage = NOMINAL_V + random(-20, 21) / 10.0;

  if (currentMode == SAG) {
    voltage = 175 + random(-30, 31) / 10.0;
  } else if (currentMode == SURGE) {
    voltage = 250 + random(-30, 31) / 10.0;
  }

  float loadValues[LOAD_COUNT + 1] = {0};
  float switchedPower = 0;
  int enabledLoads = 0;

  for (int i = 0; i < LOAD_COUNT; i++) {
    if (relayState && isLoadOn(i)) {
      loadValues[i] = loadPower(i, noise);
      enabledLoads++;
    }
    switchedPower += loadValues[i];
  }

  if (relayState) {
    loadValues[LOAD_COUNT] = 500 * usage * noise;
    if (currentMode == OVERLOAD) {
      loadValues[LOAD_COUNT] += 3500 * noise;
    }
    switchedPower += loadValues[LOAD_COUNT];
  }

  float power = ESSENTIAL_W * noise + switchedPower;
  float current = power / (voltage * POWER_FACTOR);
  float leak = relayState ? random(30, 120) / 10.0 : 0.5;

  if (currentMode == LEAK && relayState) {
    leak = random(350, 550) / 10.0;
  }

  float temperature = dht.readTemperature();
  if (isnan(temperature)) {
    temperature = 30;
  }
  if (currentMode == OVERLOAD && relayState) {
    temperature += 15;
  }

  unsigned long now = millis();
  energyKwh += power * ((now - lastSample) / 3600000.0) / 1000.0;
  lastSample = now;
  currentPower = power;
  currentVoltage = voltage;
  currentAmps = current;
  currentTemperature = temperature;
  currentLeak = leak;

  if (power > RATED_POWER_W * 1.2) {
    Serial.println("!! CANH BAO: QUA TAI");
  }
  if (voltage < 198 || voltage > 242) {
    Serial.println("!! CANH BAO: DIEN AP BAT THUONG");
  }
  if (leak >= 30) {
    Serial.println("!! CANH BAO: RO DIEN");
  }

  JsonDocument document;
  document["ma_thiet_bi"] = DEVICE_ID;
  document["ma_phong"] = ROOM_ID;
  document["thoi_gian_do"] = isoNow();
  document["uptime_s"] = now / 1000;
  document["cong_suat_w"] = roundf(power * 10) / 10.0;
  document["dien_ap_v"] = roundf(voltage * 10) / 10.0;
  document["dong_dien_a"] = roundf(current * 100) / 100.0;
  document["nhiet_do_c"] = roundf(temperature * 10) / 10.0;
  document["dong_ro_ma"] = roundf(leak * 10) / 10.0;
  document["dien_nang_kwh"] = roundf(energyKwh * 10000) / 10000.0;
  document["trang_thai_relay"] = relayState;
  document["dinh_muc_w"] = RATED_POWER_W;
  document["che_do_gia_lap"] = MODE_NAMES[currentMode];
  document["so_thiet_bi_bat"] = enabledLoads;

  JsonObject details = document["chi_tiet_mo_phong"].to<JsonObject>();
  for (int i = 0; i < LOAD_COUNT; i++) {
    details[loads[i].key] = roundf(loadValues[i] * 10) / 10.0;
  }
  details["o_cam"] = roundf(loadValues[LOAD_COUNT] * 10) / 10.0;

  String payload;
  serializeJson(document, payload);
  Serial.println(payload);

  if (mqtt.publish(
    (String(TOPIC_BASE) + "/telemetry").c_str(),
    payload.c_str()
  )) {
    Serial.println("Telemetry da gui");
  } else {
    Serial.println("Gui telemetry that bai");
  }
}

void setup() {
  Serial.begin(115200);
  Serial.println("=== TEST GIA LAP PHONG HOC + MQTT ===");
  Serial.println(
    "Go lenh: on | off | normal | qua_tai | sut_ap | tang_ap | ro_dien"
  );

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH);
  pinMode(ALARM_PIN, OUTPUT);
  pinMode(BREAKER_PIN, INPUT_PULLUP);

  for (FaultButton& button : buttons) {
    pinMode(button.pin, INPUT_PULLUP);
  }
  for (int i = 0; i < LOAD_COUNT; i++) {
    pinMode(loads[i].switchPin, INPUT_PULLUP);
    pinMode(loads[i].ledPin, OUTPUT);
  }

  dht.begin();
  Wire.begin(21, 22);
  oledReady = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  Serial.println("WiFi da ket noi");

  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  tls.setInsecure();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(1024);
  mqtt.setKeepAlive(30);
  mqtt.setSocketTimeout(10);
  mqtt.setCallback(onMqttMessage);

  updateLoadLeds();
  lastSample = millis();
}

void loop() {
  ensureWifi();
  if (!mqtt.connected()) {
    connectMqtt();
  }
  mqtt.loop();

  readBreaker();
  readButtons();
  readSerialCommand();
  updateLoadLeds();

  digitalWrite(
    ALARM_PIN,
    currentMode != NORMAL || currentPower > RATED_POWER_W * 1.2
      ? HIGH
      : LOW
  );

  if (millis() - lastOled > 500) {
    lastOled = millis();
    drawOled();
  }

  if (millis() - lastSample >= SAMPLE_INTERVAL) {
    sampleAndPublish();
  }
}
