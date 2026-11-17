// Serialize alert reads without dropping an invalidation received in flight.
// If another event arrives, discard the outdated result and immediately reread.
export function createAlertRefresh<T>(read: () => Promise<T>, commit: (value: T) => void,
  onError: (error: unknown) => void) {
  let pending: Promise<void> | undefined;
  let dirty = false;
  let disposed = false;
  return {
    request(invalidate = true): Promise<void> {
      if (disposed) return Promise.resolve();
      if (!pending || invalidate) dirty = true;
      if (pending) return pending;
      pending = (async () => {
        do {
          dirty = false;
          try {
            const value = await read();
            if (!disposed && !dirty) commit(value);
          } catch (error) { if (!disposed && !dirty) onError(error); }
        } while (dirty && !disposed);
      })().finally(() => { pending = undefined; });
      return pending;
    },
    dispose() { disposed = true; },
  };
}
