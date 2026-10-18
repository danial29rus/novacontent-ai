import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { motion } from "framer-motion";
import { MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AGENT_COLOR_KEYS, AgentAvatar } from "@/components/Brand";
import { Badge, Button, Card, Field, listMotion, Modal, PageHeader } from "@/components/ui";
import { useAgents, useKnowledge, useModels } from "@/hooks/data";
import { del, post, put } from "@/lib/api";
import type { Agent } from "@/lib/types";

const EMOJIS = ["✦", "🤖", "✍️", "📈", "🧑‍💻", "📚", "🎨", "🧠", "⚖️", "🎬", "💡", "🛍️"];

function AgentForm({ agent, onDone }: { agent?: Agent; onDone: () => void }) {
  const { data: models = [] } = useModels();
  const { data: bases = [] } = useKnowledge();
  const qc = useQueryClient();
  const [emoji, setEmoji] = useState(agent?.emoji ?? "✦");
  const [color, setColor] = useState(agent?.color ?? "violet");
  const [temperature, setTemperature] = useState(agent?.temperature ?? 0.7);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      name: f.get("name"),
      description: f.get("description"),
      system_prompt: f.get("system_prompt"),
      model_id: Number(f.get("model_id")) || null,
      knowledge_base_id: Number(f.get("knowledge_base_id")) || null,
      emoji,
      color,
      temperature,
    };
    setSaving(true);
    try {
      agent ? await put(`/agents/${agent.id}`, body) : await post("/agents", body);
      toast.success(agent ? "Агент обновлён" : "Агент создан");
      qc.invalidateQueries({ queryKey: ["agents"] });
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center gap-4">
        <AgentAvatar emoji={emoji} color={color} size="lg" />
        <div className="flex-1 space-y-2">
          <div className="flex flex-wrap gap-1">
            {EMOJIS.map((e) => (
              <button type="button" key={e} onClick={() => setEmoji(e)} className={clsx("h-8 w-8 rounded-lg text-lg transition", emoji === e ? "bg-white/15" : "hover:bg-white/5")}>{e}</button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {AGENT_COLOR_KEYS.map((c) => (
              <button type="button" key={c} onClick={() => setColor(c)} aria-label={c}
                className={clsx("h-6 w-6 rounded-full ring-2 transition", color === c ? "ring-white" : "ring-transparent", {
                  "bg-violet-500": c === "violet", "bg-cyan-500": c === "cyan", "bg-emerald-500": c === "emerald", "bg-amber-500": c === "amber", "bg-rose-500": c === "rose",
                })} />
            ))}
          </div>
        </div>
      </div>
      <Field label="Имя"><input name="name" required minLength={2} defaultValue={agent?.name} className="field" placeholder="Например, SMM-менеджер" /></Field>
      <Field label="Короткое описание"><input name="description" maxLength={300} defaultValue={agent?.description} className="field" placeholder="Что умеет этот агент" /></Field>
      <Field label="Инструкция (системный промпт)" hint="Опишите роль, стиль, ограничения и формат ответов.">
        <textarea name="system_prompt" required minLength={10} rows={6} defaultValue={agent?.system_prompt} className="field resize-y"
          placeholder="Ты — опытный SMM-менеджер бренда натуральной косметики. Пиши тепло, без канцелярита…" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Модель">
          <select name="model_id" defaultValue={agent?.model_id ?? ""} className="field">
            <option value="">По умолчанию</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
        </Field>
        <Field label="База знаний">
          <select name="knowledge_base_id" defaultValue={agent?.knowledge_base_id ?? ""} className="field">
            <option value="">Не подключена</option>
            {bases.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label={`Креативность · ${temperature.toFixed(1)}`}>
        <input type="range" min={0} max={1.5} step={0.1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} className="w-full accent-nova-500" />
        <span className="flex justify-between text-[11px] text-zinc-500"><span>Точно</span><span>Креативно</span></span>
      </Field>
      <Button type="submit" loading={saving} className="w-full">{agent ? "Сохранить" : "Создать агента"}</Button>
    </form>
  );
}

export default function Agents() {
  const { data: agents = [] } = useAgents();
  const [editing, setEditing] = useState<Agent | "new" | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const builtIn = agents.filter((a) => a.user_id === null);
  const mine = agents.filter((a) => a.user_id !== null);

  const remove = async (a: Agent) => {
    if (!confirm(`Удалить агента «${a.name}»?`)) return;
    await del(`/agents/${a.id}`);
    qc.invalidateQueries({ queryKey: ["agents"] });
  };

  const AgentCard = ({ a }: { a: Agent }) => (
    <motion.div variants={listMotion.item}>
      <Card hover className="flex h-full flex-col p-5">
        <div className="flex items-start justify-between">
          <AgentAvatar emoji={a.emoji} color={a.color} />
          {a.user_id === null ? <Badge tone="zinc">Встроенный</Badge> : (
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" onClick={() => setEditing(a)} aria-label="Изменить"><Pencil className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" onClick={() => remove(a)} aria-label="Удалить"><Trash2 className="h-4 w-4" /></Button>
            </div>
          )}
        </div>
        <h3 className="mt-4 font-bold">{a.name}</h3>
        <p className="mt-1 flex-1 text-sm leading-6 text-zinc-400">{a.description || a.system_prompt.slice(0, 120)}</p>
        <div className="mt-4 flex items-center gap-2">
          {a.knowledge_base_id && <Badge tone="aqua">RAG</Badge>}
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => navigate("/app/chat", { state: { agentId: a.id } })}>
            <MessageSquare className="h-3.5 w-3.5" /> Начать чат
          </Button>
        </div>
      </Card>
    </motion.div>
  );

  return (
    <div>
      <PageHeader
        title="Агенты"
        subtitle="Агент — это AI с заданной ролью, моделью и вашей базой знаний. Создайте своего за минуту."
        action={<Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Новый агент</Button>}
      />

      {!!mine.length && (
        <>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">Мои агенты</h2>
          <motion.div variants={listMotion.container} initial="hidden" animate="show" className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mine.map((a) => <AgentCard key={a.id} a={a} />)}
          </motion.div>
        </>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">Готовые агенты</h2>
      <motion.div variants={listMotion.container} initial="hidden" animate="show" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {builtIn.map((a) => <AgentCard key={a.id} a={a} />)}
        <motion.button variants={listMotion.item} onClick={() => setEditing("new")}
          className="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 text-zinc-400 transition hover:border-nova-400/50 hover:text-white">
          <Plus className="h-7 w-7" />
          <span className="mt-2 font-semibold">Создать своего</span>
        </motion.button>
      </motion.div>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Новый агент" : "Настройки агента"} wide>
        {editing !== null && <AgentForm agent={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}
