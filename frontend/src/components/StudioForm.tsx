import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Wand2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Markdown } from "@/components/chat/Markdown";
import { ModelPicker } from "@/components/chat/ModelPicker";
import { Button, Field } from "@/components/ui";
import { ApiError, post } from "@/lib/api";
import { TOOL_LABELS, sparks } from "@/lib/format";
import type { Generation, Tool } from "@/lib/types";

const TOOL_FIELDS: Record<Tool, { name: string; label: string; textarea?: boolean; placeholder: string }[]> = {
  post: [
    { name: "topic", label: "О чём пост", textarea: true, placeholder: "Открытие второй кофейни в центре города" },
    { name: "platform", label: "Площадка", placeholder: "Telegram, Instagram, VK…" },
    { name: "tone", label: "Тон", placeholder: "Тёплый, с юмором" },
  ],
  plan: [
    { name: "topic", label: "Тема / продукт", textarea: true, placeholder: "Онлайн-школа английского для IT" },
    { name: "period", label: "Период", placeholder: "2 недели" },
    { name: "audience", label: "Аудитория", placeholder: "Разработчики 25–35 лет" },
  ],
  rewrite: [
    { name: "text", label: "Исходный текст", textarea: true, placeholder: "Вставьте текст, который нужно улучшить" },
    { name: "tone", label: "Нужный тон", placeholder: "Дружелюбный и уверенный" },
  ],
  ideas: [
    { name: "topic", label: "Ниша / тема", textarea: true, placeholder: "Студия йоги для начинающих" },
    { name: "platform", label: "Площадка", placeholder: "Reels и сторис" },
  ],
  script: [
    { name: "topic", label: "О чём ролик", textarea: true, placeholder: "3 ошибки при выборе кроссовок для бега" },
    { name: "notes", label: "Длительность и стиль", placeholder: "30 секунд, динамично" },
  ],
};

export const TOOL_EMOJI: Record<Tool, string> = { post: "📝", plan: "🗓️", rewrite: "🎚️", ideas: "💡", script: "🎬" };

export function StudioForm({ initialTool = "post", projectId, lockTool }: { initialTool?: Tool; projectId?: number; lockTool?: boolean }) {
  const [tool, setTool] = useState<Tool>(initialTool);
  const [model, setModel] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Generation | null>(null);
  const [copied, setCopied] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    setLoading(true);
    setResult(null);
    try {
      const g = await post<Generation>("/studio/generate", { tool, input, model_id: model, project_id: projectId ?? null });
      setResult(g);
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["library"] });
    } catch (err) {
      toast.error((err as Error).message, err instanceof ApiError && err.status === 402
        ? { action: { label: "Пополнить", onClick: () => navigate("/app/billing") } } : undefined);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {!lockTool && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {(Object.keys(TOOL_FIELDS) as Tool[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTool(t); setResult(null); }}
              className={clsx(
                "relative flex shrink-0 items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition",
                tool === t ? "text-white" : "text-zinc-400 hover:text-zinc-100",
              )}
            >
              {tool === t && <motion.span layoutId="tool-tab" className="absolute inset-0 rounded-2xl border border-nova-400/40 bg-nova-500/15" />}
              <span className="relative">{TOOL_EMOJI[t]}</span>
              <span className="relative">{TOOL_LABELS[t]}</span>
            </button>
          ))}
        </div>
      )}

      <form key={tool} onSubmit={submit} className="space-y-4">
        {TOOL_FIELDS[tool].map((f) => (
          <Field key={f.name} label={f.label}>
            {f.textarea ? (
              <textarea name={f.name} rows={4} required className="field resize-y" placeholder={f.placeholder} />
            ) : (
              <input name={f.name} className="field" placeholder={f.placeholder} />
            )}
          </Field>
        ))}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ModelPicker value={model} onChange={setModel} />
          <Button type="submit" loading={loading} size="lg"><Wand2 className="h-4 w-4" /> Сгенерировать</Button>
        </div>
      </form>

      <AnimatePresence mode="wait">
        {loading && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2.5 rounded-2xl border border-white/[0.06] p-5">
            {[90, 75, 82, 60].map((w, i) => <div key={i} className="skeleton h-3.5" style={{ width: `${w}%` }} />)}
          </motion.div>
        )}
        {result && (
          <motion.div key={result.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-nova-400/20 bg-gradient-to-b from-nova-500/[0.06] to-transparent p-5">
            <div className="mb-3 flex items-center justify-between text-xs text-zinc-500">
              <span>{result.model_slug} · −{sparks(result.cost)}</span>
              <button
                onClick={() => { navigator.clipboard.writeText(result.output); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                className="flex items-center gap-1 font-semibold text-zinc-400 hover:text-white"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Скопировано" : "Копировать"}
              </button>
            </div>
            <Markdown>{result.output}</Markdown>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
