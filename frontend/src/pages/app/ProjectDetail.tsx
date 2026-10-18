import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft, MessageSquare, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { StudioForm, TOOL_EMOJI } from "@/components/StudioForm";
import { Badge, Button, Card, Field, listMotion, Modal, PageHeader, Spinner } from "@/components/ui";
import { del, get, post } from "@/lib/api";
import { TOOL_LABELS } from "@/lib/format";
import type { Chat, Generation, Pack, PackStep, Project, Tool } from "@/lib/types";
import { ProjectForm } from "./Projects";

type Details = { project: Project; packs: Pack[]; chats_count: number };

function CustomPackForm({ projectId, onDone }: { projectId: number; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [steps, setSteps] = useState<PackStep[]>([{ title: "", tool: "post" }]);
  const save = async () => {
    try {
      await post(`/projects/${projectId}/packs`, { title, steps: steps.filter((s) => s.title.trim()) });
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="space-y-4">
      <Field label="Название пака"><input value={title} onChange={(e) => setTitle(e.target.value)} className="field" placeholder="Мой еженедельный цикл" /></Field>
      <div className="space-y-2">
        <span className="label">Шаги</span>
        {steps.map((s, i) => (
          <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2">
            <input value={s.title} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className="field" placeholder={`Шаг ${i + 1}`} />
            <select value={s.tool} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, tool: e.target.value as Tool } : x)))} className="field w-40">
              {Object.entries(TOOL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <Button variant="ghost" size="icon" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label="Удалить шаг"><X className="h-4 w-4" /></Button>
          </motion.div>
        ))}
        {steps.length < 10 && <Button variant="secondary" size="sm" onClick={() => setSteps([...steps, { title: "", tool: "post" }])}><Plus className="h-3.5 w-3.5" /> Шаг</Button>}
      </div>
      <Button onClick={save} className="w-full" disabled={title.length < 2 || !steps.some((s) => s.title.trim())}>Создать пак</Button>
    </div>
  );
}

export default function ProjectDetail() {
  const { projectId } = useParams();
  const id = Number(projectId);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["project", id], queryFn: () => get<Details>(`/projects/${id}`) });
  const { data: catalog = [] } = useQuery({ queryKey: ["packs"], queryFn: () => get<Pack[]>("/packs") });
  const { data: generations = [] } = useQuery({ queryKey: ["library", id], queryFn: () => get<Generation[]>(`/library?project_id=${id}`) });
  const [modal, setModal] = useState<"edit" | "catalog" | "custom" | null>(null);
  const [step, setStep] = useState<PackStep | null>(null);

  if (isLoading || !data) return <div className="grid h-64 place-items-center"><Spinner /></div>;
  const { project, packs } = data;
  const refresh = () => qc.invalidateQueries({ queryKey: ["project", id] });

  const attach = async (packId: number) => {
    await post(`/projects/${id}/packs`, { pack_id: packId });
    toast.success("Пак подключён");
    setModal(null);
    refresh();
  };

  const openChat = async () => {
    const chat = await post<Chat>("/chats", { project_id: id, title: `Проект: ${project.name}` });
    qc.invalidateQueries({ queryKey: ["chats"] });
    navigate(`/app/chat/${chat.id}`);
  };

  const removeProject = async () => {
    if (!confirm(`Удалить проект «${project.name}»?`)) return;
    await del(`/projects/${id}`);
    qc.invalidateQueries({ queryKey: ["projects"] });
    navigate("/app/projects");
  };

  return (
    <div>
      <Link to="/app/projects" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white"><ArrowLeft className="h-4 w-4" /> Все проекты</Link>
      <PageHeader
        title={project.name}
        subtitle={project.description}
        action={
          <div className="flex flex-wrap gap-2">
            <Button onClick={openChat}><MessageSquare className="h-4 w-4" /> Чат проекта</Button>
            <Button variant="secondary" onClick={() => setModal("edit")}><Pencil className="h-4 w-4" /> Память бренда</Button>
            <Button variant="danger" size="icon" onClick={removeProject} aria-label="Удалить проект"><Trash2 className="h-4 w-4" /></Button>
          </div>
        }
      />

      {(project.tone || project.brand_context) && (
        <Card className="mb-8 p-5">
          {project.tone && <Badge>Тон: {project.tone}</Badge>}
          {project.brand_context && <p className="mt-3 line-clamp-3 whitespace-pre-line text-sm text-zinc-400">{project.brand_context}</p>}
        </Card>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">Контент-паки</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setModal("custom")}><Plus className="h-3.5 w-3.5" /> Свой пак</Button>
          <Button size="sm" onClick={() => setModal("catalog")}><Plus className="h-3.5 w-3.5" /> Из каталога</Button>
        </div>
      </div>

      <motion.div variants={listMotion.container} initial="hidden" animate="show" className="grid gap-4 lg:grid-cols-2">
        {packs.map((pack) => (
          <motion.div key={pack.id} variants={listMotion.item}>
            <Card className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold">{pack.title}</h3>
                  {pack.description && <p className="mt-1 text-sm text-zinc-400">{pack.description}</p>}
                </div>
                <button onClick={async () => { await del(`/projects/${id}/packs/${pack.id}`); refresh(); }} className="rounded-lg p-1.5 text-zinc-500 hover:text-rose-300" aria-label="Убрать пак">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 space-y-2">
                {pack.steps.map((s, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] text-sm">{TOOL_EMOJI[s.tool]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{s.title}</span>
                      <span className="text-[11px] text-zinc-500">{TOOL_LABELS[s.tool]}</span>
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => setStep(s)}><Play className="h-3 w-3" /> Запустить</Button>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        ))}
        {!packs.length && <p className="rounded-2xl border border-dashed border-white/10 py-10 text-center text-sm text-zinc-500 lg:col-span-2">Подключите готовый пак или соберите свой</p>}
      </motion.div>

      {!!generations.length && (
        <>
          <h2 className="mb-4 mt-10 text-lg font-bold">Материалы проекта</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {generations.slice(0, 9).map((g) => (
              <Card key={g.id} className="p-4">
                <Badge>{TOOL_EMOJI[g.tool]} {TOOL_LABELS[g.tool]}</Badge>
                <p className="mt-2 line-clamp-4 text-sm text-zinc-400">{g.output.replace(/[#*_`>|]/g, "")}</p>
              </Card>
            ))}
          </div>
        </>
      )}

      <Modal open={modal === "edit"} onClose={() => setModal(null)} title="Память бренда" wide>
        <ProjectForm project={project} onSaved={() => { refresh(); qc.invalidateQueries({ queryKey: ["projects"] }); setModal(null); }} />
      </Modal>
      <Modal open={modal === "catalog"} onClose={() => setModal(null)} title="Каталог паков" wide>
        <div className="grid gap-3 sm:grid-cols-2">
          {catalog.map((p) => (
            <button key={p.id} onClick={() => attach(p.id)} className="rounded-2xl border border-white/10 p-4 text-left transition hover:border-nova-400/40 hover:bg-white/[0.03]">
              <span className="text-2xl">{p.emoji}</span>
              <p className="mt-2 font-bold">{p.title}</p>
              <p className="mt-1 text-xs text-zinc-400">{p.description}</p>
            </button>
          ))}
        </div>
      </Modal>
      <Modal open={modal === "custom"} onClose={() => setModal(null)} title="Свой контент-пак" wide>
        <CustomPackForm projectId={id} onDone={() => { setModal(null); refresh(); }} />
      </Modal>
      <Modal open={!!step} onClose={() => setStep(null)} title={step?.title ?? ""} wide>
        {step && <StudioForm initialTool={step.tool} projectId={id} lockTool />}
      </Modal>
    </div>
  );
}
