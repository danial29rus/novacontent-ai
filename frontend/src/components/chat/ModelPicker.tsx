import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ProviderDot } from "@/components/Brand";
import { useModels } from "@/hooks/data";

export function ModelPicker({ value, onChange, align = "left" }: { value: number | null; onChange: (id: number) => void; align?: "left" | "right" }) {
  const { data: models = [] } = useModels();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = models.find((m) => m.id === value) ?? models.find((m) => m.is_default) ?? models[0];

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-semibold transition hover:border-white/20 hover:bg-white/[0.07]"
      >
        {current && <ProviderDot provider={current.provider} />}
        <span className="max-w-[9rem] truncate">{current?.title ?? "Модель"}</span>
        <ChevronDown className={clsx("h-4 w-4 text-zinc-500 transition", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className={clsx(
              "absolute z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-ink-850/95 p-1.5 shadow-2xl backdrop-blur-xl",
              align === "right" ? "right-0" : "left-0",
            )}
          >
            {models.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
                className={clsx(
                  "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition",
                  m.id === current?.id ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
                )}
              >
                <span className="mt-1.5"><ProviderDot provider={m.provider} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {m.title}
                    {m.badge && <span className="rounded-full bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-bold text-zinc-300">{m.badge}</span>}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-zinc-400">{m.description}</span>
                  <span className="mt-1 block font-mono text-[10px] text-zinc-500">
                    ~{Math.max(1, Math.ceil((2500 * m.input_price + 700 * m.output_price) / 1e6))} ✦ за сообщение
                  </span>
                </span>
                {m.id === current?.id && <Check className="mt-1 h-4 w-4 text-nova-300" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
