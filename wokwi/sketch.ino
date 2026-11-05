#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <DHT.h>

const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASSWORD = "";
const char* MQTT_HOST = "k264d6cc.ala.asia-southeast1.emqxsl.com";
const int MQTT_PORT = 8883;
const char* MQTT_USER = "dossdoss2k5";
const char* MQTT_PASSWORD = "YOUR_EMQX_PASSWORD";
const char* DEVICE_ID = "44444444-4444-4444-8444-444444444444";
const char* TOPIC_BASE = "campus/demo/device1";
const int RELAY_PIN = 2;
const int DHT_PIN = 4;

WiFiClientSecure tls;
PubSubClient mqtt(tls);
DHT dht(DHT_PIN, DHT22);
bool relayState = true;
unsigned long lastTelemetry = 0;
String lastCommand;
String lastAck;

String isoNow() {
  time_t now = time(nullptr);
  struct tm utc;
  gmtime_r(&now, &utc);
  char value[32];
  strftime(value, sizeof(value), "%Y-%m-%dT%H:%M:%S.000Z", &utc);
  return String(value);
}

void publishAck(const String& commandId, const char* error = nullptr) {
  String payload = "{\"ma_thiet_bi\":\"" + String(DEVICE_ID) +
    "\",\"ma_lenh\":\"" + commandId +
    "\",\"trang_thai_relay\":" + (relayState ? "true" : "false") +
    ",\"thoi_gian\":\"" + isoNow() + "\"";
  if (error) {
    payload += ",\"loi\":\"" + String(error) + "\"";
  }
  payload += "}";
  lastCommand = commandId;
  lastAck = payload;
  mqtt.publish((String(TOPIC_BASE) + "/ack").c_str(), payload.c_str());
}

void onMessage(char* topic, byte* bytes, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) {
    message += static_cast<char>(bytes[i]);
  }

  String commandTopic = String(TOPIC_BASE) + "/command";
  if (String(topic) != commandTopic || message.indexOf(DEVICE_ID) < 0) {
    return;
  }

  int idStart = message.indexOf("\"ma_lenh\":\"");
  int actionStart = message.indexOf("\"hanh_dong\":\"");
  if (idStart < 0 || actionStart < 0) {
    return;
  }

  idStart += 11;
  int idEnd = message.indexOf('"', idStart);
  String commandId = message.substring(idStart, idEnd);
  if (commandId == lastCommand) {
    mqtt.publish((String(TOPIC_BASE) + "/ack").c_str(), lastAck.c_str());
    return;
  }

  actionStart += 13;
  int actionEnd = message.indexOf('"', actionStart);
  String action = message.substring(actionStart, actionEnd);
  if (action != "Bật" && action != "Tắt") {
    publishAck(commandId, "Hành động không hợp lệ");
    return;
  }

  relayState = action == "Bật";
  digitalWrite(RELAY_PIN, relayState ? HIGH : LOW);
  publishAck(commandId);
}

void connectMqtt() {
  while (!mqtt.connected()) {
    String clientId = "wokwi-energy-device1-" + WiFi.macAddress();
    clientId.replace(":", "");
    Serial.println("Connecting to MQTT...");
    if (mqtt.connect(clientId.c_str(), MQTT_USER, MQTT_PASSWORD)) {
      Serial.println("MQTT connected");
      mqtt.subscribe((String(TOPIC_BASE) + "/command").c_str());
      mqtt.subscribe((String(TOPIC_BASE) + "/config").c_str());
    } else {
      Serial.print("MQTT failed, state=");
      Serial.println(mqtt.state());
      delay(2000);
    }
  }
}

void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.println("WiFi disconnected, reconnecting...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 15000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi reconnected");
  } else {
    Serial.println("WiFi reconnect failed");
  }
}

void setup() {
  Serial.begin(115200);
  Serial.println("ESP32 starting...");
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH);
  dht.begin();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  Serial.println("WiFi connected");

  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  tls.setInsecure();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setKeepAlive(30);
  mqtt.setSocketTimeout(10);
  mqtt.setCallback(onMessage);
}

void loop() {
  ensureWifi();
  if (!mqtt.connected()) {
    Serial.print("MQTT disconnected, state=");
    Serial.println(mqtt.state());
    connectMqtt();
  }
  mqtt.loop();

  if (millis() - lastTelemetry < 5000) {
    return;
  }
  lastTelemetry = millis();

  float temperature = dht.readTemperature();
  if (isnan(temperature)) {
    temperature = 30;
  }
  float power = relayState ? 600 + random(0, 100) : 0;
  float voltage = 220 + random(-20, 21) / 10.0;
  float current = power / voltage;
  String payload = "{\"ma_thiet_bi\":\"" + String(DEVICE_ID) +
    "\",\"thoi_gian_do\":\"" + isoNow() +
    "\",\"cong_suat_w\":" + String(power, 1) +
    ",\"dien_ap_v\":" + String(voltage, 1) +
    ",\"dong_dien_a\":" + String(current, 2) +
    ",\"nhiet_do_c\":" + String(temperature, 1) +
    ",\"trang_thai_relay\":" + (relayState ? "true" : "false") + "}";
  if (mqtt.publish((String(TOPIC_BASE) + "/telemetry").c_str(), payload.c_str())) {
    Serial.println("Telemetry published");
  } else {
    Serial.println("Telemetry publish failed");
  }
}
