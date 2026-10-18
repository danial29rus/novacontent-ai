import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { get } from "@/lib/api";
import { rub, sparks } from "@/lib/format";
import type { Estimates as EstimatesData, Package } from "@/lib/types";

export const useEstimates = () =>
  useQuery({ queryKey: ["estimates"], queryFn: () => get<EstimatesData>("/billing/estimates"), staleTime: 300_000 });

/** "How many sparks do I need?" — pick a scenario, see the breakdown and the package that covers it. */
export function EstimatesPicker({ packages, onPick }: { packages: Package[]; onPick?: (p: Package) => void }) {
  const { data } = useEstimates();
  const [active, setActive] = useState(1);
  if (!data) return <div className="skeleton h-72" />;
  const scenario = data.scenarios[active] ?? data.scenarios[0];
  const pkg = packages.find((p) => p.slug === scenario.package);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_1fr]">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
        {data.scenarios.map((s, i) => (
          <button
            key={s.title}
            onClick={() => setActive(i)}
            className={clsx(
              "relative flex shrink-0 items-center gap-3 rounded-2xl px-4 py-3 text-left transition lg:w-full",
              i === active ? "text-white" : "text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-100",
            )}
          >
            {i === active && <motion.span layoutId="est-tab" className="absolute inset-0 rounded-2xl border border-nova-400/40 bg-nova-500/10" />}
            <span className="relative text-2xl">{s.emoji}</span>
            <span className="relative">
              <span className="block whitespace-nowrap text-sm font-semibold lg:whitespace-normal">{s.title}</span>
              <span className="block text-xs text-zinc-500">≈ {sparks(s.sparks)}</span>
            </span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={scenario.title}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.2 }}
          className="glass rounded-3xl p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-zinc-400">{scenario.description}</p>
              <p className="mt-2 text-4xl font-extrabold">≈ {sparks(scenario.sparks)}</p>
              <p className="text-sm text-zinc-500">примерно {rub(scenario.sparks * 100)}</p>
            </div>
            {pkg && (
              <button
                onClick={() => onPick?.(pkg)}
                className="group flex items-center gap-3 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.07] px-4 py-3 text-left transition hover:border-emerald-400/50"
              >
                <span>
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-emerald-300">Хватит пакета</span>
                  <span className="block font-bold">{pkg.title} · {rub(pkg.price_kopeks)}</span>
                </span>
                {onPick && <ArrowRight className="h-4 w-4 text-emerald-300 transition group-hover:translate-x-0.5" />}
              </button>
            )}
          </div>
          <div className="mt-5 space-y-2">
            {scenario.items.map((item) => (
              <div key={item.label} className="flex items-center gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate text-zinc-300">{item.label}</span>
                <span className="h-px flex-1 border-t border-dashed border-white/10" />
                <span className="shrink-0 text-zinc-200">{sparks(item.sparks)}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
