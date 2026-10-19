import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { motion } from "framer-motion";
import { ArrowLeft, BookOpen, FileText, MessageSquare, Plus, Search, StickyNote, Trash2, UploadCloud } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge, Button, Card, EmptyState, Field, listMotion, Modal, PageHeader, Spinner } from "@/components/ui";
import { useKnowledge } from "@/hooks/data";
import { api, del, get, post } from "@/lib/api";
import { bytes, relative } from "@/lib/format";
import type { Doc, KnowledgeBase } from "@/lib/types";

function BaseDetail({ kb }: { kb: KnowledgeBase }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ filename: string; content: string; score: number }[] | null>(null);

  const { data: docs = [] } = useQuery({
    queryKey: ["docs", kb.id],
    queryFn: () => get<Doc[]>(`/knowledge/${kb.id}/documents`),
    // Poll while anything is still being indexed.
    refetchInterval: (q) => (q.state.data?.some((d) => d.status === "processing") ? 1500 : false),
  });

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const body = new FormData();
      body.append("file", file);
      try {
        await api(`/knowledge/${kb.id}/documents`, { method: "POST", body });
      } catch (e) {
        toast.error(`${file.name}: ${(e as Error).message}`);
      }
    }
    setUploading(false);
    qc.invalidateQueries({ queryKey: ["docs", kb.id] });
    qc.invalidateQueries({ queryKey: ["knowledge"] });
  };

  const addNote = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await post(`/knowledge/${kb.id}/text`, { title: f.get("title"), text: f.get("text") });
      setNoteOpen(false);
      qc.invalidateQueries({ queryKey: ["docs", kb.id] });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (query.trim()) setHits(await get(`/knowledge/${kb.id}/search?q=${encodeURIComponent(query)}`));
  };

  const askInChat = async () => {
    const chat = await post<{ id: number }>("/chats", { knowledge_base_id: kb.id, title: `По базе «${kb.name}»` });
    qc.invalidateQueries({ queryKey: ["chats"] });
    navigate(`/app/chat/${chat.id}`);
  };

  const removeBase = async () => {
    if (!confirm(`Удалить базу «${kb.name}» со всеми документами?`)) return;
    await del(`/knowledge/${kb.id}`);
    qc.invalidateQueries({ queryKey: ["knowledge"] });
    navigate("/app/knowledge");
  };

  return (
    <div>
      <Link to="/app/knowledge" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white"><ArrowLeft className="h-4 w-4" /> Все базы</Link>
      <PageHeader
        title={kb.name}
        subtitle={kb.description || "Документы разбиваются на фрагменты и индексируются. Подключите базу к чату или агенту — ответы будут со ссылками на источники."}
        action={
          <div className="flex gap-2">
            <Button onClick={askInChat} disabled={!docs.some((d) => d.status === "ready")}><MessageSquare className="h-4 w-4" /> Спросить по этой базе</Button>
            <Button variant="secondary" onClick={() => setNoteOpen(true)}><StickyNote className="h-4 w-4" /> Заметка</Button>
            <Button variant="danger" size="icon" onClick={removeBase} aria-label="Удалить базу"><Trash2 className="h-4 w-4" /></Button>
          </div>
        }
      />

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        className={clsx(
          "group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed px-6 py-12 text-center transition",
          drag ? "border-nova-400 bg-nova-500/10" : "border-white/10 hover:border-white/25 hover:bg-white/[0.02]",
        )}
      >
        <input ref={input} type="file" multiple hidden accept=".pdf,.txt,.md,.markdown,.csv,.json,.html" onChange={(e) => upload(e.target.files)} />
        <motion.div animate={drag ? { scale: 1.15, y: -4 } : { scale: 1, y: 0 }} className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-nova-500/25 to-aqua-400/15 text-nova-200 ring-1 ring-white/10">
          {uploading ? <Spinner /> : <UploadCloud className="h-6 w-6" />}
        </motion.div>
        <p className="mt-4 font-bold">Перетащите файлы или нажмите, чтобы выбрать</p>
        <p className="mt-1 text-sm text-zinc-500">PDF, TXT, Markdown, CSV, JSON, HTML · до 10 МБ</p>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          ["1", "Загрузите документы", "PDF, TXT, Markdown, CSV — или вставьте текст кнопкой «Заметка»."],
          ["2", "Дождитесь «Готов»", "Документ разбивается на фрагменты и индексируется за несколько секунд."],
          ["3", "Подключите к чату или агенту", "«Спросить по этой базе», кнопка «База знаний» под полем ввода в любом чате или поле «База знаний» в настройках агента."],
        ].map(([n, t, d]) => (
          <div key={n} className="flex gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-nova-500/20 text-sm font-bold text-nova-200">{n}</span>
            <span><span className="block text-sm font-semibold">{t}</span><span className="text-xs leading-5 text-zinc-400">{d}</span></span>
          </div>
        ))}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <h2 className="mb-3 font-bold">Документы · {docs.length}</h2>
          <motion.div variants={listMotion.container} initial="hidden" animate="show" className="space-y-2">
            {docs.map((d) => (
              <motion.div key={d.id} variants={listMotion.item} className="glass flex items-center gap-3 rounded-2xl px-4 py-3">
                <FileText className="h-5 w-5 shrink-0 text-zinc-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{d.filename}</p>
                  <p className="text-xs text-zinc-500">{bytes(d.size_bytes)} · {d.chunks_count} фрагм. · {relative(d.created_at)}</p>
                  {d.error && <p className="text-xs text-rose-300">{d.error}</p>}
                </div>
                {d.status === "processing" && <Badge tone="amber"><Spinner className="h-3 w-3 text-amber-300" /> Индексация</Badge>}
                {d.status === "ready" && <Badge tone="green">Готов</Badge>}
                {d.status === "failed" && <Badge tone="rose">Ошибка</Badge>}
                <button
                  onClick={async () => { await del(`/knowledge/${kb.id}/documents/${d.id}`); qc.invalidateQueries({ queryKey: ["docs", kb.id] }); }}
                  className="rounded-lg p-1.5 text-zinc-500 hover:text-rose-300" aria-label="Удалить"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </motion.div>
            ))}
            {!docs.length && <p className="rounded-2xl border border-dashed border-white/10 py-10 text-center text-sm text-zinc-500">Пока пусто — загрузите первый документ</p>}
          </motion.div>
        </div>

        <Card className="h-fit p-5">
          <h2 className="font-bold">Проверить поиск</h2>
          <p className="mt-1 text-xs text-zinc-500">Так модель находит фрагменты для ответа.</p>
          <form onSubmit={search} className="relative mt-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} className="field pl-9" placeholder="Например: условия возврата" />
          </form>
          <div className="mt-4 space-y-2">
            {hits?.map((h, i) => (
              <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate font-semibold text-aqua-300">{h.filename}</span>
                  <span className="text-zinc-500">{Math.round(h.score * 100)}%</span>
                </div>
                <p className="mt-1.5 line-clamp-4 text-xs leading-5 text-zinc-400">{h.content}</p>
              </div>
            ))}
            {hits && !hits.length && <p className="text-sm text-zinc-500">Ничего не найдено</p>}
          </div>
        </Card>
      </div>

      <Modal open={noteOpen} onClose={() => setNoteOpen(false)} title="Добавить заметку" wide>
        <form onSubmit={addNote} className="space-y-4">
          <Field label="Название"><input name="title" required className="field" placeholder="FAQ для клиентов" /></Field>
          <Field label="Текст"><textarea name="text" required minLength={20} rows={10} className="field resize-y" placeholder="Вставьте текст…" /></Field>
          <Button type="submit" className="w-full">Добавить в базу</Button>
        </form>
      </Modal>
    </div>
  );
}

export default function Knowledge() {
  const { kbId } = useParams();
  const { data: bases = [], isLoading } = useKnowledge();
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const active = bases.find((b) => b.id === Number(kbId));
  if (kbId && active) return <BaseDetail kb={active} />;
  if (kbId && isLoading) return <div className="grid h-64 place-items-center"><Spinner /></div>;

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const kb = await post<KnowledgeBase>("/knowledge", { name: f.get("name"), description: f.get("description") });
    qc.invalidateQueries({ queryKey: ["knowledge"] });
    setCreating(false);
    navigate(`/app/knowledge/${kb.id}`);
  };

  return (
    <div>
      <PageHeader
        title="База знаний"
        subtitle="Загрузите свои документы — и AI будет отвечать по ним, со ссылками на источники."
        action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Новая база</Button>}
      />
      {!isLoading && !bases.length ? (
        <EmptyState
          icon={<BookOpen className="h-6 w-6" />}
          title="Пока нет баз знаний"
          text="Например: «Регламенты компании», «Брендбук», «Ответы для поддержки»."
          action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Создать первую</Button>}
        />
      ) : (
        <motion.div variants={listMotion.container} initial="hidden" animate="show" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bases.map((b) => (
            <motion.div key={b.id} variants={listMotion.item}>
              <Link to={`/app/knowledge/${b.id}`}>
                <Card hover className="h-full p-5">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500/25 to-nova-500/10 text-aqua-300 ring-1 ring-white/10">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-bold">{b.name}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{b.description || "Без описания"}</p>
                  <p className="mt-4 text-xs text-zinc-500">{b.documents_count} документов</p>
                </Card>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Новая база знаний">
        <form onSubmit={create} className="space-y-4">
          <Field label="Название"><input name="name" required minLength={2} className="field" placeholder="Брендбук" /></Field>
          <Field label="Описание"><input name="description" className="field" placeholder="Для чего эта база" /></Field>
          <Button type="submit" className="w-full">Создать</Button>
        </form>
      </Modal>
    </div>
  );
}
