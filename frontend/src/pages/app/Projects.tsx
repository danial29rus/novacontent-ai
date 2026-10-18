import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { FolderKanban, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button, Card, EmptyState, Field, listMotion, Modal, PageHeader } from "@/components/ui";
import { useProjects } from "@/hooks/data";
import { get, post, put } from "@/lib/api";
import { relative, TOOL_LABELS } from "@/lib/format";
import type { Pack, Project } from "@/lib/types";

export function ProjectForm({ project, onSaved }: { project?: Project; onSaved: (p: Project) => void }) {
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget).entries());
    setSaving(true);
    try {
      const saved = project
        ? await put<Project>(`/projects/${project.id}`, body)
        : await post<Project>("/projects", body);
      onSaved(saved);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Название"><input name="name" required minLength={2} defaultValue={project?.name} className="field" placeholder="Кофейня «Зерно»" /></Field>
      <Field label="Описание"><input name="description" defaultValue={project?.description} className="field" placeholder="Сеть кофеен в Казани" /></Field>
      <Field label="Тон бренда"><input name="tone" defaultValue={project?.tone} className="field" placeholder="Тёплый, дружелюбный, без пафоса" /></Field>
      <Field label="Память бренда" hint="Факты, продукты, цены, УТП — AI будет учитывать это в каждом ответе проекта.">
        <textarea name="brand_context" rows={6} defaultValue={project?.brand_context} className="field resize-y" placeholder="Открыты с 2019 года. Обжариваем зерно сами…" />
      </Field>
      <Button type="submit" loading={saving} className="w-full">{project ? "Сохранить" : "Создать проект"}</Button>
    </form>
  );
}

export default function Projects() {
  const { data: projects, isLoading } = useProjects();
  const { data: packs = [] } = useQuery({ queryKey: ["packs"], queryFn: () => get<Pack[]>("/packs") });
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  return (
    <div>
      <PageHeader
        title="Проекты и паки"
        subtitle="Проект хранит память бренда. Подключите к нему готовый контент-пак или соберите свой."
        action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Новый проект</Button>}
      />

      {!isLoading && !projects?.length ? (
        <EmptyState icon={<FolderKanban className="h-6 w-6" />} title="Создайте первый проект" text="Например, ваш бренд, клиент или продукт."
          action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Создать проект</Button>} />
      ) : (
        <motion.div variants={listMotion.container} initial="hidden" animate="show" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects?.map((p) => (
            <motion.div key={p.id} variants={listMotion.item}>
              <Link to={`/app/projects/${p.id}`}>
                <Card hover className="h-full p-5">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-500/25 to-nova-500/10 text-lg font-extrabold ring-1 ring-white/10">
                    {p.name.slice(0, 1).toUpperCase()}
                  </div>
                  <h3 className="mt-4 font-bold">{p.name}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{p.description || "Без описания"}</p>
                  <p className="mt-4 text-xs text-zinc-500">Обновлён {relative(p.updated_at)}</p>
                </Card>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      )}

      <h2 className="mb-4 mt-12 text-lg font-bold">Готовые контент-паки</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {packs.map((pack) => (
          <Card key={pack.id} className="flex flex-col p-5">
            <span className="text-3xl">{pack.emoji}</span>
            <h3 className="mt-3 font-bold">{pack.title}</h3>
            <p className="mt-1 text-sm text-zinc-400">{pack.description}</p>
            <ol className="mt-4 flex-1 space-y-1.5 text-xs text-zinc-400">
              {pack.steps.map((s, i) => (
                <li key={i} className="flex gap-2"><span className="font-mono text-nova-300">{i + 1}</span> {s.title} <span className="text-zinc-600">· {TOOL_LABELS[s.tool]}</span></li>
              ))}
            </ol>
          </Card>
        ))}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Новый проект" wide>
        <ProjectForm onSaved={(p) => { qc.invalidateQueries({ queryKey: ["projects"] }); setCreating(false); navigate(`/app/projects/${p.id}`); }} />
      </Modal>
    </div>
  );
}
