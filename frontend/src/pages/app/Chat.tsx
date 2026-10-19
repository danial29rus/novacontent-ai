import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, Brain, Check, ChevronDown, MessageSquare, Pin, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { AgentAvatar, LogoMark } from "@/components/Brand";
import { Composer } from "@/components/chat/Composer";
import { MessageView } from "@/components/chat/MessageView";
import { ModelPicker } from "@/components/chat/ModelPicker";
import { Button, Spinner } from "@/components/ui";
import { useAgents, useChats, useKnowledge, useModels, useSetBalance } from "@/hooks/data";
import { ApiError, del, get, patch, post, stream } from "@/lib/api";
import { relative } from "@/lib/format";
import type { Chat, Message, SourceRef } from "@/lib/types";

type Draft = { role: "user" | "assistant"; content: string; sources: SourceRef[]; cost: number; model_slug: string | null; id: number | string };

// Survives StrictMode double-effects: each navigation's initial message is sent once.
const consumedInitial = new Set<string>();

const SUGGESTIONS = [
  "Придумай 10 идей для постов о моём продукте",
  "Объясни, как работает RAG, простыми словами",
  "Составь план запуска лендинга на 2 недели",
  "Перепиши текст в более дружелюбном тоне",
];

function KnowledgePicker({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const { data: bases = [] } = useKnowledge();
  const [open, setOpen] = useState(false);
  const current = bases.find((b) => b.id === value);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition",
          current ? "border-aqua-400/40 bg-aqua-400/10 text-aqua-200" : "border-white/10 bg-white/[0.04] text-zinc-400 hover:text-zinc-200",
        )}
      >
        <BookOpen className="h-3.5 w-3.5" />
        <span className="max-w-[10rem] truncate">{current ? `База: ${current.name}` : "Подключить базу знаний"}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute bottom-full left-0 z-30 mb-2 w-64 rounded-2xl border border-white/10 bg-ink-850/95 p-1.5 shadow-2xl backdrop-blur-xl"
          >
            <button onClick={() => { onChange(null); setOpen(false); }} className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-white/[0.05]">
              Без базы знаний {value === null && <Check className="h-4 w-4 text-nova-300" />}
            </button>
            {bases.map((b) => (
              <button key={b.id} onClick={() => { onChange(b.id); setOpen(false); }} className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-white/[0.05]">
                <span className="truncate">{b.name} <span className="text-xs text-zinc-500">· {b.documents_count} док.</span></span>
                {value === b.id && <Check className="h-4 w-4 text-nova-300" />}
              </button>
            ))}
            <Link to="/app/knowledge" className="mt-1 block rounded-xl px-3 py-2 text-xs font-semibold text-nova-300 hover:bg-white/[0.05]">+ Создать базу знаний</Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChatList({ activeId }: { activeId?: number }) {
  const { data: chats, isLoading } = useChats();
  const [q, setQ] = useState("");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const filtered = useMemo(() => (chats ?? []).filter((c) => c.title.toLowerCase().includes(q.toLowerCase())), [chats, q]);

  const remove = async (chat: Chat) => {
    await del(`/chats/${chat.id}`);
    qc.invalidateQueries({ queryKey: ["chats"] });
    if (chat.id === activeId) navigate("/app/chat");
  };
  const togglePin = async (chat: Chat) => {
    await patch(`/chats/${chat.id}`, { pinned: !chat.pinned });
    qc.invalidateQueries({ queryKey: ["chats"] });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по чатам" className="field pl-9" />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {isLoading && <div className="grid h-20 place-items-center"><Spinner /></div>}
        {filtered.map((chat) => (
          <div
            key={chat.id}
            className={clsx("group relative flex items-center rounded-xl transition", chat.id === activeId ? "bg-white/[0.07]" : "hover:bg-white/[0.04]")}
          >
            <Link to={`/app/chat/${chat.id}`} className="min-w-0 flex-1 px-3 py-2.5">
              <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                {chat.pinned && <Pin className="h-3 w-3 shrink-0 text-nova-300" />}
                <span className="truncate">{chat.title}</span>
              </span>
              <span className="text-[11px] text-zinc-500">{relative(chat.updated_at)}</span>
            </Link>
            <div className="mr-1.5 flex opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
              <button onClick={() => togglePin(chat)} className="rounded-lg p-1.5 text-zinc-500 hover:text-white" aria-label="Закрепить"><Pin className="h-3.5 w-3.5" /></button>
              <button onClick={() => remove(chat)} className="rounded-lg p-1.5 text-zinc-500 hover:text-rose-300" aria-label="Удалить"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
        {!isLoading && !filtered.length && <p className="px-3 py-6 text-center text-sm text-zinc-500">Чатов пока нет</p>}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { chatId } = useParams();
  const id = chatId ? Number(chatId) : undefined;
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setBalance = useSetBalance();
  const { data: models = [] } = useModels();
  const { data: agents = [] } = useAgents();
  const { data: knowledgeBases = [] } = useKnowledge();

  const { data: chat } = useQuery({ queryKey: ["chat", id], queryFn: () => get<Chat>(`/chats/${id}`), enabled: !!id });
  const { data: history, isLoading } = useQuery({
    queryKey: ["messages", id],
    queryFn: () => get<Message[]>(`/chats/${id}/messages`),
    enabled: !!id,
  });

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [newModel, setNewModel] = useState<number | null>(null);
  const [newKb, setNewKb] = useState<number | null>(null);
  const [newAgent, setNewAgent] = useState<number | null>((location.state as { agentId?: number } | null)?.agentId ?? null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const agent = agents.find((a) => a.id === (chat?.agent_id ?? newAgent));
  const messages: Draft[] = useMemo(() => [...(history ?? []), ...drafts], [history, drafts]);

  useEffect(() => {
    setDrafts([]);
    setListOpen(false);
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: busy ? "auto" : "smooth", block: "end" });
  }, [messages.length, drafts]);

  const send = useCallback(
    async (chatIdToUse: number, text: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setDrafts([
        { id: "u", role: "user", content: text, sources: [], cost: 0, model_slug: null },
        { id: "a", role: "assistant", content: "", sources: [], cost: 0, model_slug: null },
      ]);
      const patchAssistant = (fn: (d: Draft) => Draft) => setDrafts((ds) => ds.map((d) => (d.id === "a" ? fn(d) : d)));
      try {
        await stream(`/chats/${chatIdToUse}/messages`, { content: text }, {
          signal: controller.signal,
          onEvent: (event, data) => {
            if (event === "meta") patchAssistant((d) => ({ ...d, sources: data.sources, model_slug: data.model }));
            if (event === "delta") patchAssistant((d) => ({ ...d, content: d.content + data.text }));
            if (event === "done") setBalance(data.balance);
            if (event === "error") toast.error(data.message);
          },
        });
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          toast.error((e as Error).message, e instanceof ApiError && e.status === 402
            ? { action: { label: "Пополнить", onClick: () => navigate("/app/billing") } } : undefined);
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
        await qc.invalidateQueries({ queryKey: ["messages", chatIdToUse] });
        setDrafts([]);
        qc.invalidateQueries({ queryKey: ["chats"] });
        qc.invalidateQueries({ queryKey: ["chat", chatIdToUse] });
        qc.invalidateQueries({ queryKey: ["me"] });
      }
    },
    [qc, setBalance, navigate],
  );

  // Send the first message after a brand-new chat was created and we navigated to it.
  useEffect(() => {
    const initial = (location.state as { initial?: string } | null)?.initial;
    if (id && initial && !consumedInitial.has(location.key)) {
      consumedInitial.add(location.key);
      send(id, initial);
    }
  }, [id, location.key, location.state, send]);

  const onSend = async (text: string) => {
    if (id) return send(id, text);
    try {
      const created = await post<Chat>("/chats", { model_id: newModel, agent_id: newAgent, knowledge_base_id: newKb });
      qc.invalidateQueries({ queryKey: ["chats"] });
      navigate(`/app/chat/${created.id}`, { state: { initial: text } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const updateChat = async (data: Partial<Chat>) => {
    if (!id) return;
    const updated = await patch<Chat>(`/chats/${id}`, data);
    qc.setQueryData(["chat", id], updated);
  };

  const modelId = id ? chat?.model_id ?? null : newModel ?? agent?.model_id ?? null;
  const kbId = id ? chat?.knowledge_base_id ?? null : newKb;
  const modelTitle = models.find((m) => m.id === modelId)?.title;
  const kbName = knowledgeBases.find((b) => b.id === kbId)?.name;

  const toolbar = (
    <>
      <KnowledgePicker value={kbId} onChange={(v) => (id ? updateChat({ knowledge_base_id: v }) : setNewKb(v))} />
      {chat?.summary && (
        <span title={chat.summary} className="hidden items-center gap-1 rounded-xl border border-white/10 px-2.5 py-1.5 text-xs text-zinc-400 sm:flex">
          <Brain className="h-3.5 w-3.5 text-nova-300" /> Память сжата
        </span>
      )}
    </>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-72 shrink-0 border-r border-white/[0.06] bg-ink-900/30 xl:block">
        <ChatList activeId={id} />
      </aside>

      <AnimatePresence>
        {listOpen && (
          <motion.div className="fixed inset-0 z-40 bg-black/60 xl:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setListOpen(false)}>
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute inset-y-0 right-0 w-[85%] max-w-sm border-l border-white/10 bg-ink-900"
            >
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <span className="font-bold">Чаты</span>
                <button onClick={() => setListOpen(false)} className="p-1 text-zinc-400"><X className="h-5 w-5" /></button>
              </div>
              <div className="h-[calc(100%-53px)]"><ChatList activeId={id} /></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2.5 sm:px-5">
          {agent && <AgentAvatar emoji={agent.emoji} color={agent.color} size="sm" />}
          <h1 className="min-w-0 flex-1 truncate text-sm font-bold sm:text-base">{chat?.title ?? (agent ? agent.name : "Новый чат")}</h1>
          {kbName && (
            <span className="hidden max-w-[14rem] items-center gap-1.5 truncate rounded-full border border-aqua-400/30 bg-aqua-400/10 px-2.5 py-1 text-xs font-semibold text-aqua-200 sm:flex" title="Ответы опираются на документы этой базы">
              <BookOpen className="h-3.5 w-3.5 shrink-0" /> {kbName}
            </span>
          )}
          <ModelPicker value={modelId} align="right" onChange={(m) => (id ? updateChat({ model_id: m }) : setNewModel(m))} />
          <Button variant="ghost" size="icon" className="xl:hidden" onClick={() => setListOpen(true)} aria-label="Список чатов">
            <MessageSquare className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
            {id && isLoading && <div className="grid h-40 place-items-center"><Spinner /></div>}

            {!id && (
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center pt-[8vh] text-center">
                {agent ? <AgentAvatar emoji={agent.emoji} color={agent.color} size="lg" /> : (
                  <motion.div animate={{ rotate: [0, 8, -8, 0], scale: [1, 1.05, 1] }} transition={{ duration: 6, repeat: Infinity }}>
                    <LogoMark className="h-16 w-16" />
                  </motion.div>
                )}
                <h2 className="mt-5 text-2xl font-extrabold tracking-tight sm:text-3xl">
                  {agent ? agent.name : <>Чем помочь <span className="text-gradient">сегодня?</span></>}
                </h2>
                <p className="mt-2 max-w-md text-sm text-zinc-400">
                  {agent ? agent.description : `Модель: ${modelTitle ?? "по умолчанию"}. Подключите базу знаний, чтобы отвечать по вашим документам.`}
                </p>

                {!agent && (
                  <div className="mt-8 flex max-w-2xl flex-wrap justify-center gap-2">
                    {agents.slice(0, 4).map((a) => (
                      <button key={a.id} onClick={() => setNewAgent(a.id)} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] py-1.5 pl-1.5 pr-3.5 text-sm font-semibold transition hover:border-nova-400/40 hover:bg-white/[0.06]">
                        <AgentAvatar emoji={a.emoji} color={a.color} size="sm" /> {a.name}
                      </button>
                    ))}
                  </div>
                )}
                {agent && <button onClick={() => setNewAgent(null)} className="mt-3 text-xs font-semibold text-zinc-500 hover:text-zinc-300">Без агента</button>}

                <div className="mt-6 grid w-full max-w-2xl gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s, i) => (
                    <motion.button
                      key={s}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 + i * 0.06 }}
                      onClick={() => onSend(s)}
                      className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-left text-sm text-zinc-300 transition hover:-translate-y-0.5 hover:border-white/15 hover:bg-white/[0.05]"
                    >
                      {s}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}

            <div className="space-y-7">
              {messages.map((m, i) => (
                <MessageView key={m.id} message={m} streaming={busy && m.id === "a" && i === messages.length - 1} />
              ))}
            </div>
            <div ref={bottomRef} className="h-4" />
          </div>
        </div>

        <div className="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-6 sm:pb-5" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <Composer onSend={onSend} onStop={() => abortRef.current?.abort()} busy={busy} toolbar={toolbar} autoFocus />
          <p className="mt-2 text-center text-[11px] text-zinc-600">AI может ошибаться. Проверяйте важное.</p>
        </div>
      </section>
    </div>
  );
}
