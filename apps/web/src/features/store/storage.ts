/** localStorage can be unavailable (private mode, blocked storage, quota); the store then keeps state in memory only. */
export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    const value: unknown = raw ? JSON.parse(raw) : null;
    // Old or hand-edited data of the wrong shape (e.g. `null` or `{}` where a list belongs) falls back too.
    const sameShape = Array.isArray(fallback) ? Array.isArray(value) : typeof value === 'object' && value !== null && !Array.isArray(value);
    return sameShape ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Nordhem: could not persist "${key}"`, error);
  }
}
