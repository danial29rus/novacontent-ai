import { useServices } from "@/hooks/data";

/** Every paid service with its price, what the user fills in and what they get. Data comes from /services. */
export function ServiceCatalog() {
  const { data: services, isLoading } = useServices();
  if (isLoading) return <p className="text-sm text-zinc-500">Загружаем каталог услуг…</p>;
  if (!services?.length) return null;
  return (
    <div className="grid gap-3">
      {services.map((s) => (
        <div key={s.slug} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="font-bold text-white">{s.emoji} {s.title}</h3>
            <span className="shrink-0 rounded-full bg-nova-500/15 px-3 py-1 text-sm font-semibold text-nova-200">
              {s.price} ✦ ≈ {s.price} ₽ за запуск
            </span>
          </div>
          <p className="mt-1 text-xs uppercase tracking-wider text-zinc-500">{s.category}</p>
          <p className="mt-2 leading-7 text-zinc-300">{s.description}</p>
          {s.perks.length > 0 && <p className="mt-2 text-sm text-zinc-300"><b className="text-white">Что входит:</b> {s.perks.join(" · ")}.</p>}
          <p className="mt-1 text-sm text-zinc-400">
            <b className="text-zinc-300">Что вы заполняете:</b> {s.fields.map((f) => f.label + (f.required ? "" : " (по желанию)")).join(", ")}.
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            <b className="text-zinc-300">Результат:</b> {s.result === "agent"
              ? "готовый AI-агент в вашем аккаунте (раздел «Агенты») с инструкцией, которую можно редактировать."
              : "готовый текстовый документ на экране за 1–2 минуты; сохраняется в «Библиотеке», его можно скопировать, скачать и доработать в чате."}
          </p>
        </div>
      ))}
    </div>
  );
}
