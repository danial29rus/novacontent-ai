import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { DatabaseBackup, Mail, Megaphone, Ticket, Activity, Coins, CreditCard, LifeBuoy, MessageSquare, Search, TrendingUp, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ProviderDot } from "@/components/Brand";
import { Badge, Button, Card, Field, PageHeader } from "@/components/ui";
import { get, patch, post } from "@/lib/api";
import { PromoTab, TrafficTab } from "./Growth";
import { UserDetail } from "./UserDetail";
import { bytes, date, number, rub, tokens } from "@/lib/format";
import type { AIModel, User } from "@/lib/types";

type Overview = {
  users: number;
  new_users: number;
  active_users: number;
  messages: number;
  revenue_kopeks: number;
  open_tickets: number;
  daily: { day: string; spent: number; topups: number }[];
  by_model: { model: string; messages: number; tokens: number }[];
};

const TABS = [
  { id: "overview", label: "Обзор", icon: TrendingUp },
  { id: "costs", label: "Затраты", icon: Activity },
  { id: "users", label: "Пользователи", icon: Users },
  { id: "traffic", label: "Трафик", icon: Megaphone },
  { id: "promo", label: "Промокоды", icon: Ticket },
  { id: "models", label: "Модели", icon: Coins },
  { id: "payments", label: "Платежи", icon: CreditCard },
  { id: "tickets", label: "Обращения", icon: LifeBuoy },
] as const;

const tooltipStyle = { background: "#161625", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12 };

function Stat({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Users }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between text-zinc-400">
        <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-3 text-2xl font-extrabold">{value}</p>
    </Card>
  );
}

type Backups = {
  configured: boolean; healthy: boolean; age_hours: number | null; count: number; total_bytes: number;
  last: { state: string; at: string; file: string; size_bytes: number; s3: string; message: string } | null;
  files: { name: string; size_bytes: number; created_at: string }[];
};

function BackupCard() {
  const { data } = useQuery({ queryKey: ["admin", "backups"], queryFn: () => get<Backups>("/admin/backups"), refetchInterval: 60_000 });
  if (!data) return null;
  const s3 = data.last?.s3;
  return (
    <Card className={clsx("flex flex-col gap-4 p-5 sm:flex-row sm:items-center", !data.healthy && "border-rose-500/40 bg-rose-500/[0.06]")}>
      <span className={clsx("grid h-11 w-11 shrink-0 place-items-center rounded-2xl", data.healthy ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-500/15 text-rose-300")}>
        <DatabaseBackup className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-bold">
          {data.healthy ? "Бэкапы в порядке" : data.count ? "Бэкап устарел или с ошибкой" : "Бэкапов ещё нет"}
        </p>
        <p className="text-sm text-zinc-400">
          {data.last?.state === "ok"
            ? `Последний: ${date(data.last.at)} · ${bytes(data.last.size_bytes)} · всего ${data.count} (${bytes(data.total_bytes)})`
            : data.last?.message || "Сервис backup делает дамп каждый день в 04:00 (МСК)"}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge tone={data.healthy ? "green" : "rose"}>{data.age_hours !== null ? `${data.age_hours} ч назад` : "—"}</Badge>
        <Badge tone={s3 === "ok" ? "green" : s3 === "failed" ? "rose" : "zinc"}>
          {s3 === "ok" ? "копия в S3" : s3 === "failed" ? "S3: ошибка" : "только на сервере"}
        </Badge>
      </div>
    </Card>
  );
}

function OverviewTab() {
  const { data } = useQuery({ queryKey: ["admin", "overview"], queryFn: () => get<Overview>("/admin/overview") });
  if (!data) return null;
  return (
    <div className="space-y-6">
      <BackupCard />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Пользователи" value={`${number(data.users)} (+${data.new_users})`} icon={Users} />
        <Stat label="Активные · 30 дн" value={number(data.active_users)} icon={TrendingUp} />
        <Stat label="Сообщения · 30 дн" value={number(data.messages)} icon={MessageSquare} />
        <Stat label="Выручка · 30 дн" value={rub(data.revenue_kopeks)} icon={CreditCard} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card className="p-5">
          <h3 className="font-bold">Списано ✦ по дням</h3>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.daily}>
                <CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} />
                <XAxis dataKey="day" tickFormatter={(d) => d.slice(5)} tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={tokens} tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => tokens(v)} cursor={{ fill: "rgba(255,255,255,.03)" }} />
                <Bar dataKey="spent" name="Потрачено" fill="#a78bfa" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="font-bold">По моделям</h3>
          <div className="mt-4 space-y-3">
            {data.by_model.map((m) => {
              const max = Math.max(...data.by_model.map((x) => x.tokens), 1);
              return (
                <div key={m.model}>
                  <div className="flex justify-between text-sm"><span className="font-semibold">{m.model}</span><span className="text-zinc-400">{tokens(m.tokens)}</span></div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/5">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${(m.tokens / max) * 100}%` }} className="h-full rounded-full bg-gradient-to-r from-nova-500 to-aqua-400" />
                  </div>
                  <p className="mt-1 text-[11px] text-zinc-500">{number(m.messages)} ответов</p>
                </div>
              );
            })}
            {!data.by_model.length && <p className="text-sm text-zinc-500">Пока нет данных</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}

type CostRow = { key: string; calls: number; prompt_tokens: number; completion_tokens: number; cost_rub: number; charged: number; margin_rub: number };
type Costs = {
  usd_rub: number;
  cost_rub: number;
  charged_sparks: number;
  revenue_rub: number;
  gross_margin_rub: number;
  calls: number;
  tokens: number;
  outstanding_sparks: number;
  by_kind: CostRow[];
  by_model: CostRow[];
  daily: { day: string; cost_rub: number; charged: number }[];
  top_users: { email: string; cost_rub: number; charged: number; calls: number }[];
};

const KIND_LABELS: Record<string, string> = {
  chat: "💬 Чаты", studio: "✨ Студия", service: "💼 Услуги", summary: "🧠 Сжатие памяти", embedding: "📚 Индексация RAG",
};
const money = (v: number) => `${v.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;

function CostTable({ title, rows, label }: { title: string; rows: CostRow[]; label?: (k: string) => string }) {
  return (
    <Card className="overflow-x-auto p-5">
      <h3 className="font-bold">{title}</h3>
      <table className="mt-3 w-full min-w-[520px] text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-zinc-500">
          <tr><th className="py-2">Источник</th><th>Вызовы</th><th>Токены (вх/вых)</th><th>Себестоимость</th><th>Списано</th><th>Маржа</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-white/[0.04]">
              <td className="py-2.5 font-semibold">{label ? label(r.key) : r.key}</td>
              <td>{number(r.calls)}</td>
              <td className="font-mono text-xs text-zinc-400">{tokens(r.prompt_tokens)} / {tokens(r.completion_tokens)}</td>
              <td className="text-rose-300">{money(r.cost_rub)}</td>
              <td>{number(r.charged)} ✦</td>
              <td className={r.margin_rub >= 0 ? "text-emerald-300" : "text-rose-300"}>{money(r.margin_rub)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="py-6 text-center text-sm text-zinc-500">Нет данных</p>}
    </Card>
  );
}

function CostsTab() {
  const [days, setDays] = useState(30);
  const { data } = useQuery({ queryKey: ["admin", "costs", days], queryFn: () => get<Costs>(`/admin/costs?days=${days}`) });
  if (!data) return null;
  const markup = data.cost_rub > 0 ? data.charged_sparks / data.cost_rub : 0;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">Курс для расчёта: {data.usd_rub} ₽/$ · 1 ✦ ≈ 1 ₽</p>
        <div className="flex gap-1 rounded-xl border border-white/10 p-1">
          {[7, 30, 90, 365].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={clsx("rounded-lg px-3 py-1 text-xs font-semibold", d === days ? "bg-white/10 text-white" : "text-zinc-400")}>{d} дн</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Себестоимость AI" value={money(data.cost_rub)} icon={Activity} />
        <Stat label="Выручка (оплаты)" value={money(data.revenue_rub)} icon={CreditCard} />
        <Stat label="Валовая маржа" value={money(data.gross_margin_rub)} icon={TrendingUp} />
        <Stat label="Наценка на usage" value={markup ? `×${markup.toFixed(1)}` : "—"} icon={Coins} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Списано искр" value={`${number(data.charged_sparks)} ✦`} icon={Coins} />
        <Stat label="Вызовов моделей" value={number(data.calls)} icon={MessageSquare} />
        <Stat label="Искр на балансах (обязательства)" value={`${number(data.outstanding_sparks)} ✦`} icon={Users} />
      </div>
      <Card className="p-5">
        <h3 className="font-bold">Себестоимость и списания по дням, ₽</h3>
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.daily}>
              <CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} />
              <XAxis dataKey="day" tickFormatter={(d) => d.slice(5)} tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,.03)" }} formatter={(v: number) => money(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="cost_rub" name="Себестоимость" fill="#fb7185" radius={[6, 6, 0, 0]} />
              <Bar dataKey="charged" name="Списано (✦≈₽)" fill="#a78bfa" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <CostTable title="По типам задач" rows={data.by_kind} label={(k) => KIND_LABELS[k] ?? k} />
      <CostTable title="По моделям" rows={data.by_model} />
      <Card className="overflow-x-auto p-5">
        <h3 className="font-bold">Самые затратные пользователи</h3>
        <table className="mt-3 w-full min-w-[420px] text-sm">
          <tbody>
            {data.top_users.map((u) => (
              <tr key={u.email} className="border-t border-white/[0.04]">
                <td className="py-2.5">{u.email}</td>
                <td className="text-zinc-400">{number(u.calls)} вызовов</td>
                <td className="text-rose-300">{money(u.cost_rub)}</td>
                <td>{number(u.charged)} ✦</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function UsersTab() {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const { data: users = [] } = useQuery({ queryKey: ["admin", "users", q], queryFn: () => get<User[]>(`/admin/users?q=${encodeURIComponent(q)}`) });

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-white/[0.06] p-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Email или имя" className="field pl-9" />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr><th className="px-4 py-3">Пользователь</th><th className="px-4 py-3">Баланс</th><th className="px-4 py-3">Статус</th><th className="px-4 py-3">Последний вход</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} onClick={() => setSelected(u.id)} className="cursor-pointer border-t border-white/[0.04] transition hover:bg-white/[0.03]">
                <td className="px-4 py-3"><p className="font-semibold">{u.name} {u.role === "admin" && <Badge>admin</Badge>}</p><p className="text-xs text-zinc-500">{u.email}</p></td>
                <td className="px-4 py-3">{number(u.balance)} ✦</td>
                <td className="px-4 py-3">{u.status === "active" ? <Badge tone="green">активен</Badge> : <Badge tone="rose">заблокирован</Badge>}</td>
                <td className="px-4 py-3 text-zinc-400">{u.last_seen_at ? date(u.last_seen_at) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AnimatePresence>{selected !== null && <UserDetail userId={selected} onClose={() => setSelected(null)} />}</AnimatePresence>
    </Card>
  );
}

function ModelsTab() {
  const qc = useQueryClient();
  const { data: models = [] } = useQuery({ queryKey: ["admin", "models"], queryFn: () => get<AIModel[]>("/admin/models") });
  const save = async (m: AIModel, data: Partial<AIModel>) => {
    try {
      await patch(`/admin/models/${m.id}`, data);
      qc.invalidateQueries({ queryKey: ["admin", "models"] });
      qc.invalidateQueries({ queryKey: ["models"] });
      toast.success("Сохранено");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {models.map((m) => (
        <Card key={m.id} className={clsx("p-5", !m.is_active && "opacity-60")}>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 font-bold"><ProviderDot provider={m.provider} /> {m.title}</span>
            <div className="flex gap-2">
              {m.is_default ? <Badge>по умолчанию</Badge> : <Button size="sm" variant="ghost" onClick={() => save(m, { is_default: true })}>Сделать основной</Button>}
              <Button size="sm" variant="secondary" onClick={() => save(m, { is_active: !m.is_active })}>{m.is_active ? "Выключить" : "Включить"}</Button>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              save(m, {
                provider_model: String(f.get("provider_model")), input_price: Number(f.get("input_price")), output_price: Number(f.get("output_price")),
                cost_input_usd: Number(f.get("cost_input_usd")), cost_output_usd: Number(f.get("cost_output_usd")),
              });
            }}
            className="mt-4 grid grid-cols-2 gap-3 sm:items-end"
          >
            <div className="col-span-2"><Field label="ID у провайдера"><input name="provider_model" defaultValue={m.provider_model} className="field font-mono text-xs" /></Field></div>
            <Field label="✦ / 1M вход"><input name="input_price" type="number" step="1" min="0" defaultValue={m.input_price} className="field" /></Field>
            <Field label="✦ / 1M выход"><input name="output_price" type="number" step="1" min="0" defaultValue={m.output_price} className="field" /></Field>
            <Field label="$ / 1M вход (себест.)"><input name="cost_input_usd" type="number" step="0.01" min="0" defaultValue={m.cost_input_usd} className="field" /></Field>
            <Field label="$ / 1M выход (себест.)"><input name="cost_output_usd" type="number" step="0.01" min="0" defaultValue={m.cost_output_usd} className="field" /></Field>
            <Button type="submit" variant="secondary" className="col-span-2">Сохранить</Button>
          </form>
        </Card>
      ))}
    </div>
  );
}

function PaymentsTab() {
  const { data = [] } = useQuery({ queryKey: ["admin", "payments"], queryFn: () => get<any[]>("/admin/payments") });
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-zinc-500">
          <tr><th className="px-4 py-3">#</th><th className="px-4 py-3">Пользователь</th><th className="px-4 py-3">Сумма</th><th className="px-4 py-3">Токены</th><th className="px-4 py-3">Статус</th><th className="px-4 py-3">Дата</th></tr>
        </thead>
        <tbody>
          {data.map((p) => (
            <tr key={p.id} className="border-t border-white/[0.04]">
              <td className="px-4 py-3 text-zinc-500">{p.id}</td>
              <td className="px-4 py-3">{p.email}</td>
              <td className="px-4 py-3 font-semibold">{rub(p.amount_kopeks)}</td>
              <td className="px-4 py-3 font-mono">{tokens(p.tokens)}</td>
              <td className="px-4 py-3"><Badge tone={p.status === "succeeded" ? "green" : p.status === "pending" ? "amber" : "rose"}>{p.status}</Badge> <span className="text-xs text-zinc-500">{p.provider}</span></td>
              <td className="px-4 py-3 text-zinc-400">{date(p.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!data.length && <p className="py-10 text-center text-sm text-zinc-500">Платежей пока нет</p>}
    </Card>
  );
}

type MailStatus = { enabled: boolean; host: string | null; port: number; user: string | null; support_email: string;
  last: { ok: boolean | null; at: string | null; error: string | null; to: string | null } };

function MailPanel() {
  const { data, refetch } = useQuery({ queryKey: ["admin", "mail"], queryFn: () => get<MailStatus>("/admin/mail") });
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data) return null;
  const test = async () => {
    setTesting(true);
    setError(null);
    try {
      const r = await post<{ ok: boolean; to?: string; error?: string }>("/admin/mail/test");
      if (r.ok) toast.success(`Тестовое письмо отправлено на ${r.to} — проверьте ящик`);
      else setError(r.error ?? "Не удалось отправить");
      refetch();
    } finally {
      setTesting(false);
    }
  };
  const ok = data.enabled && data.last.ok !== false;
  return (
    <Card className={clsx("p-4 sm:p-5", !ok && "border-amber-400/30 bg-amber-400/[0.05]")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Mail className={clsx("h-5 w-5 shrink-0", ok ? "text-emerald-300" : "text-amber-300")} />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">
            {!data.enabled ? "Почта не настроена — письма не отправляются" : data.last.ok === false ? "Последнее письмо не ушло" : "Почта подключена"}
          </p>
          <p className="text-zinc-400">
            Обращения приходят на {data.support_email}
            {data.enabled && ` · SMTP ${data.host}:${data.port} (${data.user})`}
            {data.last.at && ` · последняя отправка ${date(data.last.at)}`}
          </p>
        </div>
        <Button size="sm" variant="secondary" loading={testing} onClick={test}>Проверить почту</Button>
      </div>
      {(error || data.last.error) && <p className="mt-3 rounded-xl bg-rose-500/10 p-3 text-xs text-rose-200">{error || data.last.error}</p>}
    </Card>
  );
}

function TicketsTab() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["admin", "tickets"], queryFn: () => get<any[]>("/admin/tickets") });
  return (
    <div className="space-y-3">
      <MailPanel />
      {data.map((t) => (
        <Card key={t.id} className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-bold">{t.subject}</p>
            <div className="flex items-center gap-2">
              <Badge tone={t.status === "open" ? "amber" : "zinc"}>{t.status === "open" ? "открыт" : "закрыт"}</Badge>
              {t.status === "open" && (
                <Button size="sm" variant="secondary" onClick={async () => { await post(`/admin/tickets/${t.id}/close`); qc.invalidateQueries({ queryKey: ["admin", "tickets"] }); }}>
                  Закрыть
                </Button>
              )}
            </div>
          </div>
          <p className="mt-1 text-xs text-zinc-500">{t.email} · {date(t.created_at)}</p>
          <p className="mt-3 whitespace-pre-line text-sm text-zinc-300">{t.message}</p>
          {t.reply ? (
            <div className="mt-4 rounded-xl border border-nova-400/20 bg-nova-500/[0.06] p-3">
              <p className="text-xs text-nova-300">Ответ · {date(t.replied_at)}</p>
              <p className="mt-1 whitespace-pre-line text-sm text-zinc-300">{t.reply}</p>
            </div>
          ) : (
            <form
              className="mt-4 flex flex-col gap-2 sm:flex-row"
              onSubmit={async (e) => {
                e.preventDefault();
                const message = String(new FormData(e.currentTarget).get("message") ?? "");
                try {
                  const res = await post<{ emailed: boolean }>(`/admin/tickets/${t.id}/reply`, { message });
                  toast[res.emailed ? "success" : "warning"](res.emailed ? `Ответ сохранён и отправляется на ${t.email}` : "Ответ сохранён, но почта не настроена — письмо не ушло");
                  qc.invalidateQueries({ queryKey: ["admin", "tickets"] });
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
            >
              <textarea name="message" required minLength={2} rows={2} placeholder="Ответ уйдёт пользователю на почту…" className="field flex-1 resize-y" />
              <Button type="submit" className="sm:self-end">Ответить</Button>
            </form>
          )}
        </Card>
      ))}
      {!data.length && <p className="py-10 text-center text-sm text-zinc-500">Обращений нет</p>}
    </div>
  );
}

export default function Admin() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("overview");
  return (
    <div>
      <PageHeader title="Админка" subtitle="Пользователи, баланс, модели и цены, платежи и поддержка." />
      <div className="-mx-1 mb-6 flex gap-1 overflow-x-auto px-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)} className={clsx("relative flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition", tab === id ? "text-white" : "text-zinc-400 hover:text-white")}>
            {tab === id && <motion.span layoutId="admin-tab" className="absolute inset-0 rounded-xl border border-white/10 bg-white/[0.07]" />}
            <Icon className="relative h-4 w-4" /> <span className="relative">{label}</span>
          </button>
        ))}
      </div>
      <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        {tab === "overview" && <OverviewTab />}
        {tab === "costs" && <CostsTab />}
        {tab === "users" && <UsersTab />}
        {tab === "traffic" && <TrafficTab />}
        {tab === "promo" && <PromoTab />}
        {tab === "models" && <ModelsTab />}
        {tab === "payments" && <PaymentsTab />}
        {tab === "tickets" && <TicketsTab />}
      </motion.div>
    </div>
  );
}
