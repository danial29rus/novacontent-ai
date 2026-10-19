import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Library as LibraryIcon, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Markdown } from "@/components/chat/Markdown";
import { TOOL_EMOJI } from "@/components/StudioForm";
import { Badge, Button, Card, EmptyState, listMotion, Modal, PageHeader, Skeleton } from "@/components/ui";
import { useKnowledge, useServices } from "@/hooks/data";
import { toast } from "sonner";
import { del, get, post } from "@/lib/api";
import { date, relative, TOOL_LABELS, sparks } from "@/lib/format";
import type { Generation } from "@/lib/types";

export default function Library() {
  const { data: items, isLoading } = useQuery({ queryKey: ["library"], queryFn: () => get<Generation[]>("/library") });
  const [open, setOpen] = useState<Generation | null>(null);
  const qc = useQueryClient();
  const { data: services = [] } = useServices();
  const { data: bases = [] } = useKnowledge();
  const label = (g: Generation) => {
    const s = services.find((x) => x.slug === g.tool);
    return s ? `${s.emoji} ${s.title}` : `${TOOL_EMOJI[g.tool] ?? "✦"} ${TOOL_LABELS[g.tool] ?? g.tool}`;
  };

  const remove = async (g: Generation) => {
    await del(`/library/${g.id}`);
    setOpen(null);
    qc.invalidateQueries({ queryKey: ["library"] });
  };

  return (
    <div>
      <PageHeader title="Библиотека" subtitle="Всё, что вы сгенерировали в Студии и контент-паках." />
      {isLoading && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-44" />)}</div>}
      {items && !items.length && (
        <EmptyState icon={<LibraryIcon className="h-6 w-6" />} title="Пока пусто" text="Сгенерируйте первый материал в Студии."
          action={<Link to="/app/studio"><Button>Открыть Студию</Button></Link>} />
      )}
      <motion.div variants={listMotion.container} initial="hidden" animate="show" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items?.map((g) => (
          <motion.button key={g.id} variants={listMotion.item} onClick={() => setOpen(g)} className="text-left">
            <Card hover className="flex h-full flex-col p-5">
              <div className="flex items-center justify-between">
                <Badge>{label(g)}</Badge>
                <span className="text-[11px] text-zinc-500">{relative(g.created_at)}</span>
              </div>
              <p className="mt-3 line-clamp-5 flex-1 whitespace-pre-line text-sm leading-6 text-zinc-300">{g.output.replace(/[#*_`>|-]/g, "")}</p>
            </Card>
          </motion.button>
        ))}
      </motion.div>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? label(open) : ""} wide>
        {open && (
          <>
            <p className="mb-4 text-xs text-zinc-500">{date(open.created_at)} · {open.model_slug} · −{sparks(open.cost)}</p>
            <Markdown>{open.output}</Markdown>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              {bases.length > 0 && (
                <select
                  defaultValue=""
                  onChange={async (e) => {
                    const kbId = Number(e.target.value);
                    if (!kbId) return;
                    try {
                      await post(`/knowledge/${kbId}/text`, { title: label(open).replace(/^\S+\s/, "").slice(0, 100), text: open.output });
                      toast.success(`Добавлено в базу «${bases.find((b) => b.id === kbId)?.name}»`);
                    } catch (err) {
                      toast.error((err as Error).message);
                    }
                    e.target.value = "";
                  }}
                  className="field w-auto"
                  aria-label="Добавить в базу знаний"
                >
                  <option value="">В базу знаний…</option>
                  {bases.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
              <Button variant="secondary" onClick={() => navigator.clipboard.writeText(open.output)}>Копировать</Button>
              <Button variant="danger" onClick={() => remove(open)}><Trash2 className="h-4 w-4" /> Удалить</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
