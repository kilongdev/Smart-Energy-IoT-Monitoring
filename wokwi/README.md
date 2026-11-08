# Wokwi ESP32 MQTT demo

This project is the ESP32 side of the Smart Energy demo. It publishes
telemetry and receives relay commands through the same MQTT Cloud broker as
the Docker backend.

## Setup

1. Create a Wokwi ESP32 project and import `diagram.json`, `sketch.ino`, and
   `libraries.txt`.
2. Replace the placeholders in `sketch.ino` with the EMQX Cloud TLS host,
   username, and password.
3. Use port `8883`. Register a device on the dashboard and use **Kết nối ESP** to copy its ID/topic. Only use these example IDs if the demo devices were seeded:
   - ID: `44444444-4444-4444-8444-444444444444`
   - Topic: `campus/demo/device1`
4. Configure the repository `.env` with the same broker:

```dotenv
MQTT_URL=mqtts://YOUR_EMQX_HOST:8883
MQTT_USERNAME=your-emqx-username
MQTT_PASSWORD=your-emqx-password
```

Do not commit real credentials or publish them in a public Wokwi project.

## Demo flow

### Add another ESP from the dashboard

In **Danh mục → Thiết bị → Thêm thiết bị**, select a room and enter a name.
MAC and MQTT topic are optional; an omitted topic is generated uniquely.
After saving, **Kết nối ESP** shows the device ID, topic, room label and sample
interval as a copyable Wokwi configuration. Replace the corresponding constants
in a copy of this sketch, then copy the Client ID line into `connectMqtt()`.
Keep the working EMQX settings. Use one registered device per running ESP.
You can reopen the instructions using **Kết nối ESP** in the device list.
The selected room in the dashboard determines where the backend stores telemetry.

1. Start the backend with `docker compose up -d --build`.
2. Run the Wokwi simulation.
3. Open the dashboard and select the seeded device.
4. Confirm telemetry updates at SAMPLE_INTERVAL (the supplied sketch defaults to two seconds).
5. Press **Bật** or **Tắt** in the dashboard.
6. Confirm the relay LED changes and the command log receives a successful
   ACK.
