/** Coerce any agent output value to a React-safe string */
export const safe = (v: unknown): string =>
    typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);

/** Coerce any agent output value to an array of strings */
export const safeArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)];
