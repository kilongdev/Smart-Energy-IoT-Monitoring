# Alert flow check — 2026-11-18

## Follow-up: direct alert updates

- `Alerts.publishAlert` sends the persisted record in the existing management-only
  `alert` event. Per-incident serialization keeps emission order. Detection,
  recovery, interrupted recovery and Telegram delivery all use this path.
- Active incidents also emit updated measurements without repeated toast messages.
- `web/alert-live.ts` applies records directly and overlays socket changes received
  during an HTTP read, preventing stale responses from restoring an old status.
  Legacy ID-only events and reconnect still trigger normal HTTP reconciliation.
- Heatmap, thresholds, recovery timers and role scopes are unchanged by this follow-up.
- Build and 62/62 tests pass, including persisted socket payloads, unchanged-state
  readings, stale HTTP responses, three incident cycles and interrupted recovery.
- Rebuilt the Docker API; current `.env` maps it to localhost:3001. Stopped the
  duplicate local Node backend. Socket connection to the new container succeeds.
- End-to-end Wokwi transition latency has not been established by these tests.

## Findings

- `Telemetry.enqueueSlow` shared four slots across all devices, allowed concurrent
  evaluation of samples from the same device, and dropped queued work above 200.
  Replay could enqueue unfinished work again. This separated live readings from
  incident evaluation and introduced ordering/queueing problems.
- The 60-second rule-presence cache delayed newly enabled rules.
- Duplicate telemetry was sent through `processFast` using a new receive time,
  allowing replay to overwrite relay metadata. Processing now uses the stored row.
- Docker API and Node backend/watch were running simultaneously during inspection.
  Local Docker and the old Node processes were stopped for measurement.
- Even with local `SIM_VIRTUAL=false`, another source continued publishing virtual
  devices. Stored telemetry also had receive times different from this backend's
  receipt of the same sample. Multiple workers sharing MongoDB do not share the
  in-process Socket.IO emitter: one may persist/send Telegram while another serves
  the browser without receiving that event.

## Changes

- Await persistence and evaluation in each device's queue; no shared dropping queue.
- Check enabled rules directly; avoid evaluation leases for devices with no rules.
- Use stored duplicate rows and monotonic `lastSeen`; do not replay duplicate relay
  values with a newly manufactured receive timestamp.
- Invalidate energy rollups for every persisted sample. The previous per-device
  60-second throttle lost invalidation for late data in another hour.
- Project only time/power when calculating rollups.
- Fetch active alerts/history concurrently and remove telemetry-triggered catalog
  refreshes. Existing periodic reconciliation and command refresh remain.
- Reject occupied local HTTP port before connecting another backend to MQTT.

No alert thresholds, recovery durations, firmware or Command–ACK logic changed.

## Verification

- `npm test`: 59/59 passed after changes.
- Added three-cycle lifecycle regression; subsequent alert-lifecycle run: 22/22.
- `npm run build`: passed; `git diff --check`: passed.
- Standalone frontend typecheck: 18 TS2339 errors in unchanged `web/HeatPlan.tsx`.
- Live A101 MQTT observed: sample timestamp to observer receipt ranged roughly
  0–3.6 seconds, with clock resynchronization jumps. This is not a pure network
  latency measurement. Evaluation logs included delays around 2.7–6.2 seconds,
  but another writer was still processing shared telemetry, so this is not an
  isolated performance benchmark of the corrected backend.
- No claim of three successful live Wokwi/Telegram/browser cycles. This remains
  pending isolation of the external backend and observation of overload/recovery.

For local testing, keep exactly one backend and one publisher per device. Do not
start Docker API alongside `npm run start:dev`. The port guard cannot detect a
backend on another machine. Production multi-worker deployment requires a shared
event transport for Socket.IO; sharing MongoDB alone does not provide it.
