/** Remembers how a visitor arrived (?ref, ?promo, ?utm_*) until they sign up. */
const KEY = "nova_attribution";
const PARAMS = ["ref", "promo", "utm_source", "utm_campaign"] as const;
export type Attribution = Partial<Record<(typeof PARAMS)[number], string>>;

export function captureAttribution(search: string): void {
  const params = new URLSearchParams(search);
  const found: Attribution = {};
  for (const p of PARAMS) {
    const v = params.get(p);
    if (v) found[p] = v.slice(0, 100);
  }
  if (!Object.keys(found).length) return;
  try {
    // First touch wins for ref/source, but a newer promo replaces an old one.
    const prev = readAttribution();
    localStorage.setItem(KEY, JSON.stringify({ ...found, ...prev, ...(found.promo ? { promo: found.promo } : {}) }));
  } catch {
    /* storage unavailable: attribution is best-effort */
  }
}

export function readAttribution(): Attribution {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Attribution;
  } catch {
    return {};
  }
}

export function clearAttribution(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
