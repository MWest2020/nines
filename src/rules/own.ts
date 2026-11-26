// Look a key up on a plain record without falling through to Object.prototype. Names come
// from content and from the player, so "constructor" or "__proto__" must mean "not found".

export function own<T>(rec: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return rec !== undefined && Object.hasOwn(rec, key) ? rec[key] : undefined;
}

export const has = (rec: Readonly<Record<string, unknown>> | undefined, key: string): boolean =>
  rec !== undefined && Object.hasOwn(rec, key);

/** Set an own data property, even for a key such as "__proto__". */
export function setOwn<T>(rec: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(rec, key, { value, writable: true, enumerable: true, configurable: true });
}
