#!/bin/sh
set -eu
umask 077
if [ -f /mosquitto/data/passwords ]; then
  mosquitto_passwd -b /mosquitto/data/passwords energy_api "$MQTT_PASSWORD"
else
  mosquitto_passwd -b -c /mosquitto/data/passwords energy_api "$MQTT_PASSWORD"
fi
mosquitto_passwd -b /mosquitto/data/passwords energy_sim "$SIM_MQTT_PASSWORD"
cat > /mosquitto/data/acl <<'EOF'
user energy_api
topic readwrite campus/#

user energy_sim
topic read campus/demo/+/command
topic read campus/demo/+/config
topic write campus/demo/+/telemetry
topic write campus/demo/+/ack
EOF
cat > /mosquitto/data/mosquitto.conf <<'EOF'
listener 1883
allow_anonymous false
password_file /mosquitto/data/passwords
acl_file /mosquitto/data/acl
persistence true
persistence_location /mosquitto/data/
log_dest stdout
max_packet_size 8192
max_queued_messages 10000
EOF
chown -R mosquitto:mosquitto /mosquitto/data
exec mosquitto -c /mosquitto/data/mosquitto.conf
