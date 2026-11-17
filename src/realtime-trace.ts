// Opt-in timing diagnostics. Callers pass IDs/times/states only, never payloads
// containing credentials. No database writes and no change to event contracts.
export function realtimeTrace(stage: string, fields: Record<string, unknown>) {
  if (process.env.REALTIME_TRACE !== 'true') return;
  console.info(JSON.stringify({ trace: 'energy-realtime', stage, at: new Date().toISOString(), ...fields }));
}
