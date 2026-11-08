#pragma once
#define WIFI_SSID "YOUR_WIFI"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
// This firmware uses MQTT TCP (1883). For EMQX TLS (8883), use the Wokwi
// implementation or add TLS support before deploying to physical hardware.
#define MQTT_HOST "YOUR_MQTT_TCP_ENDPOINT"
#define MQTT_USER "YOUR_EMQX_USERNAME"
#define MQTT_PASS "YOUR_EMQX_PASSWORD"
#define DEVICE_ID "44444444-4444-4444-8444-444444444444"
#define TOPIC_BASE "campus/demo/device1"
#define RELAY_PIN 2
