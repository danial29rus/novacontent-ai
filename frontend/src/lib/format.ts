const compact = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("ru-RU");

export const tokens = (n: number) => (Math.abs(n) >= 10_000 ? compact.format(n) : full.format(n));
/** Platform currency: Sparks. 1 ✦ ≈ 1 ₽. */
export const sparks = (n: number) => `${full.format(n)} ✦`;
export const CURRENCY = "Искры";
export const number = (n: number) => full.format(n);
export const rub = (kopeks: number) =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(kopeks / 100);

export function relative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} дн назад`;
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export const date = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const bytes = (n: number) =>
  n < 1024 ? `${n} Б` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1024 ** 2).toFixed(1)} МБ`;

export const TOOL_LABELS: Record<string, string> = {
  post: "Пост",
  plan: "Контент-план",
  rewrite: "Редактор тона",
  ideas: "Идеи",
  script: "Сценарий видео",
};
