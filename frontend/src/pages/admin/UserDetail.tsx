import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft, Ban, Bot, BookOpen, CreditCard, FileText, FolderKanban, KeyRound, LifeBuoy, MessageSquare,
  Shield, Sparkles, UserPlus, Wallet, Wand2, X,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { MessageView } from "@/components/chat/MessageView";
import { Markdown } from "@/components/chat/Markdown";
import { Badge, Button, Card, Field, Spinner } from "@/components/ui";
import { get, patch, post } from "@/lib/api";
import { date, number, relative, rub } from "@/lib/format";
import type { Message, User } from "@/lib/types";

type Summary = {
  user: User;
  last_login: string | null;
  counts: Record<"chats" | "messages" | "generations" | "agents" | "projects" | "knowledge_bases" | "logins" | "tickets", number>;
  spent_sparks: number;
  paid_rub: number;
  cost_rub: number;
  by_kind: { kind: string; calls: number; charged: number }[];
  models: { model: string; calls: number }[];
  tools: { tool: string; title: string; runs: number }[];
};
type Event = { at: string; type: string; title: string; detail: string; amount: number | null; ref: { chat_id?: number; generation_id?: number } | null };
type Content = {
  chats: { id: number; title: string; messages: number; updated_at: string; has_summary: boolean }[];
  projects: { id: number; name: string; description: string; tone: string; brand_context: string; created_at: string }[];
  agents: { id: number; name: string; emoji: string; description: string; system_prompt: string; created_at: string }[];
  knowledge_bases: { id: number; name: string; documents: number; created_at: string }[];
};

const EVENT_STYLE: Record<string, { icon: typeof Bot; tone: string; label: string }> = {
  account: { icon: UserPlus, tone: "bg-emerald-400/15 text-emerald-300", label: "Аккаунт" },
  login: { icon: KeyRound, tone: "bg-white/5 text-zinc-400", label: "Входы" },
  chat: { icon: MessageSquare, tone: "bg-nova-500/15 text-nova-300", label: "Чаты" },
  message: { icon: MessageSquare, tone: "bg-nova-500/15 text-nova-300", label: "Сообщения" },
  answer: { icon: Sparkles, tone: "bg-fuchsia-500/15 text-fuchsia-300", label: "Ответы AI" },
  service: { icon: Wand2, tone: "bg-amber-400/15 text-amber-300", label: "Услуги" },
  studio: { icon: Sparkles, tone: "bg-amber-400/15 text-amber-300", label: "Студия" },
  agent: { icon: Bot, tone: "bg-cyan-400/15 text-cyan-300", label: "Агенты" },
  project: { icon: FolderKanban, tone: "bg-pink-400/15 text-pink-300", label: "Проекты" },
  knowledge: { icon: BookOpen, tone: "bg-cyan-400/15 text-cyan-300", label: "База знаний" },
  document: { icon: FileText, tone: "bg-cyan-400/15 text-cyan-300", label: "Документы" },
  payment: { icon: CreditCard, tone: "bg-emerald-400/15 text-emerald-300", label: "Оплаты" },
  balance: { icon: Wallet, tone: "bg-emerald-400/15 text-emerald-300", label: "Баланс" },
  ticket: { icon: LifeBuoy, tone: "bg-rose-400/15 text-rose-300", label: "Поддержка" },
  admin: { icon: Shield, tone: "bg-amber-400/15 text-amber-300", label: "Админ" },
};

const KIND_LABELS: Record<string, string> = { chat: "Чаты", studio: "Студия", service: "Услуги", summary: "Сжатие памяти", embedding: "Индексация" };

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-extrabold">{value}</p>
    </div>
  );
}

function ChatViewer({ userId, chatId, onBack }: { userId: number; chatId: number; onBack: () => void }) {
  const { data: messages } = useQuery({ queryKey: ["admin", "user-chat", userId, chatId], queryFn: () => get<Message[]>(`/admin/users/${userId}/chats/${chatId}`) });
  return (
    <div>
      <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /> К списку чатов</Button>
      <div className="mt-4 space-y-6">
        {!messages && <Spinner />}
        {messages?.map((m) => (
          <div key={m.id}>
            <p className="mb-1 text-[11px] text-zinc-500">{date(m.created_at)}{m.cost ? ` · −${m.cost} ✦ · ${m.prompt_tokens}/${m.completion_tokens} ток.` : ""}</p>
            <MessageView message={m} />
          </div>
        ))}
        {messages && !messages.length && <p className="text-sm text-zinc-500">Чат пуст</p>}
      </div>
    </div>
  );
}

function GenerationViewer({ userId, id, onClose }: { userId: number; id: number; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ["admin", "gen", userId, id], queryFn: () => get<{ title: string; input: Record<string, string>; output: string; cost: number; model_slug: string; created_at: string }>(`/admin/users/${userId}/generations/${id}`) });
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h4 className="font-bold">{data?.title ?? "…"}</h4>
        <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      {data && (
        <>
          <p className="mt-1 text-xs text-zinc-500">{date(data.created_at)} · {data.model_slug} · −{data.cost} ✦</p>
          <div className="mt-3 space-y-1 rounded-xl bg-white/[0.03] p-3 text-xs text-zinc-400">
            {Object.entries(data.input).map(([k, v]) => <p key={k}><span className="text-zinc-500">{k}:</span> {v}</p>)}
          </div>
          <div className="mt-4 max-h-[50vh] overflow-y-auto"><Markdown>{data.output}</Markdown></div>
        </>
      )}
    </Card>
  );
}

function Timeline({ userId, onOpenChat }: { userId: number; onOpenChat: (id: number) => void }) {
  const { data: events } = useQuery({ queryKey: ["admin", "activity", userId], queryFn: () => get<Event[]>(`/admin/users/${userId}/activity?limit=1000`) });
  const [filter, setFilter] = useState<string>("all");
  const [generation, setGeneration] = useState<number | null>(null);
  const types = useMemo(() => [...new Set((events ?? []).map((e) => e.type))], [events]);
  if (!events) return <Spinner />;
  const visible = filter === "all" ? events : events.filter((e) => e.type === filter);

  // Group by calendar day for readability.
  const days = new Map<string, Event[]>();
  for (const e of visible) {
    const key = new Date(e.at).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
    days.set(key, [...(days.get(key) ?? []), e]);
  }

  return (
    <div>
      <div className="-mx-1 mb-5 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {["all", ...types].map((t) => (
          <button key={t} onClick={() => setFilter(t)}
            className={clsx("shrink-0 rounded-full px-3 py-1 text-xs font-semibold ring-1 transition",
              filter === t ? "bg-nova-500/20 text-white ring-nova-400/40" : "text-zinc-400 ring-white/10 hover:text-white")}>
            {t === "all" ? `Все · ${events.length}` : `${EVENT_STYLE[t]?.label ?? t} · ${events.filter((e) => e.type === t).length}`}
          </button>
        ))}
      </div>
      <AnimatePresence>{generation && <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-5"><GenerationViewer userId={userId} id={generation} onClose={() => setGeneration(null)} /></motion.div>}</AnimatePresence>
      <div className="space-y-6">
        {[...days.entries()].map(([day, items]) => (
          <div key={day}>
            <p className="sticky top-0 z-10 mb-2 bg-ink-850/95 py-1 text-xs font-bold uppercase tracking-wider text-zinc-500 backdrop-blur">{day}</p>
            <div className="relative space-y-1 border-l border-white/[0.07] pl-5">
              {items.map((e, i) => {
                const style = EVENT_STYLE[e.type] ?? EVENT_STYLE.admin;
                const clickable = e.ref?.chat_id || e.ref?.generation_id;
                return (
                  <button key={i} disabled={!clickable}
                    onClick={() => (e.ref?.chat_id ? onOpenChat(e.ref.chat_id) : e.ref?.generation_id && setGeneration(e.ref.generation_id))}
                    className={clsx("relative flex w-full gap-3 rounded-xl px-2 py-2 text-left", clickable && "transition hover:bg-white/[0.04]")}>
                    <span className={clsx("absolute -left-[33px] top-2.5 grid h-6 w-6 place-items-center rounded-full ring-4 ring-ink-850", style.tone)}>
                      <style.icon className="h-3 w-3" />
                    </span>
                    <span className="w-12 shrink-0 pt-0.5 font-mono text-[11px] text-zinc-500">
                      {new Date(e.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{e.title}</span>
                      {e.detail && <span className="line-clamp-2 block text-xs text-zinc-400">{e.detail}</span>}
                    </span>
                    {e.amount !== null && e.amount !== 0 && (
                      <span className={clsx("shrink-0 text-sm font-semibold", e.amount > 0 ? "text-emerald-300" : "text-zinc-400")}>
                        {e.amount > 0 ? "+" : ""}{number(e.amount)} ✦
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function UserDetail({ userId, onClose }: { userId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"overview" | "activity" | "chats" | "content">("overview");
  const [openChat, setOpenChat] = useState<number | null>(null);
  const { data: s } = useQuery({ queryKey: ["admin", "summary", userId], queryFn: () => get<Summary>(`/admin/users/${userId}/summary`) });
  const { data: content } = useQuery({ queryKey: ["admin", "content", userId], queryFn: () => get<Content>(`/admin/users/${userId}/content`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin"] });

  const adjust = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      const { balance } = await post<{ balance: number }>(`/admin/users/${userId}/balance`, { amount: Number(f.get("amount")), comment: f.get("comment") });
      toast.success(`Новый баланс: ${number(balance)} ✦`);
      form.reset();
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const update = async (data: Partial<User>) => {
    try {
      await patch(`/admin/users/${userId}`, data);
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const goChat = (id: number) => { setTab("chats"); setOpenChat(id); };

  const TABS = [
    { id: "overview", label: "Обзор" },
    { id: "activity", label: "Лента действий" },
    { id: "chats", label: `Чаты · ${content?.chats.length ?? 0}` },
    { id: "content", label: "Проекты и агенты" },
  ] as const;

  // Portal: ancestors with transform/backdrop-filter would otherwise trap position:fixed.
  return createPortal(
    <motion.div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", damping: 32, stiffness: 300 }}
        className="flex h-full w-full max-w-4xl flex-col border-l border-white/10 bg-ink-850 shadow-2xl">
        <div className="flex items-start gap-4 border-b border-white/[0.06] p-5 sm:p-6">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-nova-400 to-aqua-400 text-lg font-bold text-ink-950">
            {s?.user.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold">
              {s?.user.name ?? "…"}
              {s?.user.role === "admin" && <Badge>admin</Badge>}
              {s?.user.status === "blocked" && <Badge tone="rose">заблокирован</Badge>}
            </h2>
            <p className="truncate text-sm text-zinc-400">{s?.user.email}</p>
            {s && <p className="mt-0.5 text-xs text-zinc-500">с нами с {date(s.user.created_at)} · последний вход {s.last_login ? relative(s.last_login) : "—"}</p>}
            {s && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone="aqua">источник: {s.user.signup_source || "до трекинга"}</Badge>
                {s.user.signup_campaign && <Badge tone="zinc">кампания: {s.user.signup_campaign}</Badge>}
                {s.user.signup_promo && <Badge tone="amber">промокод: {s.user.signup_promo}</Badge>}
                {s.user.referred_by_id && <Badge tone="nova">по приглашению #{s.user.referred_by_id}</Badge>}
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть"><X className="h-5 w-5" /></Button>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06] px-4 sm:px-6">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => { setTab(t.id); setOpenChat(null); }}
              className={clsx("relative shrink-0 px-3 py-3 text-sm font-semibold transition", tab === t.id ? "text-white" : "text-zinc-400 hover:text-white")}>
              {t.label}
              {tab === t.id && <motion.span layoutId="user-tab" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-gradient-to-r from-nova-400 to-aqua-400" />}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          {!s && <Spinner />}
          {s && tab === "overview" && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Баланс" value={`${number(s.user.balance)} ✦`} />
                <Stat label="Оплатил" value={rub(s.paid_rub * 100)} />
                <Stat label="Потратил" value={`${number(s.spent_sparks)} ✦`} />
                <Stat label="Себестоимость" value={`${s.cost_rub.toLocaleString("ru-RU")} ₽`} />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Чатов" value={s.counts.chats} />
                <Stat label="Сообщений" value={s.counts.messages} />
                <Stat label="Генераций" value={s.counts.generations} />
                <Stat label="Входов" value={s.counts.logins} />
                <Stat label="Агентов" value={s.counts.agents} />
                <Stat label="Проектов" value={s.counts.projects} />
                <Stat label="Баз знаний" value={s.counts.knowledge_bases} />
                <Stat label="Обращений" value={s.counts.tickets} />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Card className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Чем пользуется</p>
                  {s.by_kind.map((k) => <p key={k.kind} className="mt-2 flex justify-between text-sm"><span>{KIND_LABELS[k.kind] ?? k.kind}</span><span className="text-zinc-400">{k.calls} · {number(k.charged)} ✦</span></p>)}
                  {!s.by_kind.length && <p className="mt-2 text-sm text-zinc-500">—</p>}
                </Card>
                <Card className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Модели</p>
                  {s.models.map((m) => <p key={m.model} className="mt-2 flex justify-between text-sm"><span>{m.model}</span><span className="text-zinc-400">{m.calls}</span></p>)}
                  {!s.models.length && <p className="mt-2 text-sm text-zinc-500">—</p>}
                </Card>
                <Card className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Услуги и Студия</p>
                  {s.tools.map((t) => <p key={t.tool} className="mt-2 flex justify-between gap-2 text-sm"><span className="truncate">{t.title}</span><span className="text-zinc-400">{t.runs}</span></p>)}
                  {!s.tools.length && <p className="mt-2 text-sm text-zinc-500">—</p>}
                </Card>
              </div>
              <Card className="p-4 sm:p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Управление</p>
                <form onSubmit={adjust} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                  <Field label="Начислить / списать ✦"><input name="amount" type="number" required className="field" placeholder="+500 или −100" /></Field>
                  <Field label="Комментарий"><input name="comment" required minLength={2} className="field" placeholder="Компенсация за сбой" /></Field>
                  <Button type="submit">Применить</Button>
                </form>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant={s.user.status === "active" ? "danger" : "secondary"} onClick={() => update({ status: s.user.status === "active" ? "blocked" : "active" })}>
                    <Ban className="h-3.5 w-3.5" /> {s.user.status === "active" ? "Заблокировать" : "Разблокировать"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => update({ role: s.user.role === "admin" ? "user" : "admin" })}>
                    <Shield className="h-3.5 w-3.5" /> {s.user.role === "admin" ? "Снять админа" : "Сделать админом"}
                  </Button>
                </div>
              </Card>
            </div>
          )}
          {tab === "activity" && <Timeline userId={userId} onOpenChat={goChat} />}
          {tab === "chats" && (openChat ? <ChatViewer userId={userId} chatId={openChat} onBack={() => setOpenChat(null)} /> : (
            <div className="space-y-2">
              {content?.chats.map((c) => (
                <button key={c.id} onClick={() => setOpenChat(c.id)} className="glass flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition hover:border-nova-400/30">
                  <MessageSquare className="h-4 w-4 shrink-0 text-nova-300" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{c.title}</span>
                    <span className="text-xs text-zinc-500">{c.messages} сообщений · {relative(c.updated_at)}{c.has_summary ? " · память сжата" : ""}</span>
                  </span>
                </button>
              ))}
              {content && !content.chats.length && <p className="text-sm text-zinc-500">Чатов нет</p>}
            </div>
          ))}
          {tab === "content" && content && (
            <div className="space-y-6">
              <section>
                <h3 className="mb-2 font-bold">Проекты · {content.projects.length}</h3>
                {content.projects.map((p) => (
                  <details key={p.id} className="glass mb-2 rounded-2xl px-4 py-3">
                    <summary className="cursor-pointer text-sm font-semibold">{p.name} <span className="font-normal text-zinc-500">· {date(p.created_at)}</span></summary>
                    <p className="mt-2 text-xs text-zinc-400">{p.description}{p.tone && ` · тон: ${p.tone}`}</p>
                    {p.brand_context && <p className="mt-2 whitespace-pre-line text-xs text-zinc-500">{p.brand_context}</p>}
                  </details>
                ))}
              </section>
              <section>
                <h3 className="mb-2 font-bold">Агенты · {content.agents.length}</h3>
                {content.agents.map((a) => (
                  <details key={a.id} className="glass mb-2 rounded-2xl px-4 py-3">
                    <summary className="cursor-pointer text-sm font-semibold">{a.emoji} {a.name} <span className="font-normal text-zinc-500">· {date(a.created_at)}</span></summary>
                    <p className="mt-2 whitespace-pre-line text-xs text-zinc-400">{a.system_prompt}</p>
                  </details>
                ))}
              </section>
              <section>
                <h3 className="mb-2 font-bold">Базы знаний · {content.knowledge_bases.length}</h3>
                {content.knowledge_bases.map((k) => (
                  <p key={k.id} className="glass mb-2 rounded-2xl px-4 py-3 text-sm"><BookOpen className="mr-2 inline h-4 w-4 text-aqua-300" />{k.name} <span className="text-zinc-500">· {k.documents} док.</span></p>
                ))}
              </section>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
