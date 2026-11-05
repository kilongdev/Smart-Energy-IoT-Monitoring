# Wokwi ESP32 MQTT demo

This project is the ESP32 side of the Smart Energy demo. It publishes
telemetry and receives relay commands through the same MQTT Cloud broker as
the Docker backend.

## Setup

1. Create a Wokwi ESP32 project and import `diagram.json`, `sketch.ino`, and
   `libraries.txt`.
2. Replace the placeholders in `sketch.ino` with the EMQX Cloud TLS host,
   username, and password.
3. Use port `8883` and the seeded device values:
   - ID: `44444444-4444-4444-8444-444444444444`
   - Topic: `campus/demo/device1`
4. Configure the repository `.env` with the same broker:

```dotenv
MQTT_URL=mqtts://k264d6cc.ala.asia-southeast1.emqxsl.com:8883
MQTT_USERNAME=your-emqx-username
MQTT_PASSWORD=your-emqx-password
```

For the simulator container, use these optional overrides if the broker ACL
separates device credentials:

```dotenv
SIM_MQTT_URL=mqtts://k264d6cc.ala.asia-southeast1.emqxsl.com:8883
SIM_MQTT_USERNAME=your-emqx-username
SIM_MQTT_PASSWORD=your-emqx-password
```

Do not commit real credentials or publish them in a public Wokwi project.

## Demo flow

1. Start the backend with `docker compose up -d --build`.
2. Run the Wokwi simulation.
3. Open the dashboard and select the seeded device.
4. Confirm telemetry updates every five seconds.
5. Press **Bật** or **Tắt** in the dashboard.
6. Confirm the relay LED changes and the command log receives a successful
   ACK.
