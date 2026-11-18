const KEY = 'energy-token';
export function readAuthToken(session: Storage, local: Storage) {
  return session.getItem(KEY) || local.getItem(KEY);
}
export function clearAuthToken(session: Storage, local: Storage) {
  session.removeItem(KEY);
  local.removeItem(KEY);
}
export function saveAuthToken(token: string, remember: boolean, session: Storage, local: Storage) {
  clearAuthToken(session, local);
  (remember ? local : session).setItem(KEY, token);
}
