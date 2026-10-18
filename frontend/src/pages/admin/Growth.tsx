import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Button, Card, Field, Modal } from "@/components/ui";
import { get, patch, post } from "@/lib/api";
import { date, number, rub } from "@/lib/format";

type Promo = {
  id: number; code: string; kind: "gift" | "topup"; value: number; min_topup_rub: number; max_uses: number | null;
  uses: number; new_users_only: boolean; expires_at: string | null; source: string; note: string; is_active: boolean;
  created_at: string; signups: number; payments: number; revenue_rub: number; sparks_given: number;
};
type Channel = { key: string; signups: number; paying: number; revenue_rub: number; payments: number; conversion: number; arpu_rub: number };
type Traffic = {
  signups: number; referred_signups: number; referral_paid_sparks: number;
  by_source: Channel[]; by_campaign: Channel[]; by_promo: Channel[];
  daily: { day: string; signups: number }[];
  referrers: { email: string; code: string; invited: number; paying: number; revenue_rub: number; earned: number }[];
};

const tooltipStyle = { background: "#161625", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12 };
const PUBLIC = window.location.origin;

function PromoForm({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<"gift" | "topup">("gift");
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null);
    setSaving(true);
    try {
      await post("/admin/promo", {
        code: f.get("code"), kind, value: num("value"), min_topup_rub: num("min_topup_rub") ?? 0, max_uses: num("max_uses"),
        new_users_only: f.get("new_users_only") === "on", source: f.get("source"), note: f.get("note"),
        expires_at: f.get("expires_at") ? new Date(String(f.get("expires_at"))).toISOString() : null,
      });
      toast.success("Промокод создан");
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {([["gift", "🎁 Подарок искрами", "Сразу начисляет ✦"], ["topup", "💳 Бонус к оплате", "+% искр к пополнению"]] as const).map(([k, t, d]) => (
          <button type="button" key={k} onClick={() => setKind(k)}
            className={clsx("rounded-2xl border p-3 text-left transition", kind === k ? "border-nova-400/50 bg-nova-500/10" : "border-white/10 hover:border-white/20")}>
            <span className="block text-sm font-semibold">{t}</span><span className="text-xs text-zinc-400">{d}</span>
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Код"><input name="code" required minLength={3} pattern="[A-Za-z0-9_-]+" className="field uppercase" placeholder="AUTUMN50" /></Field>
        <Field label={kind === "gift" ? "Искр в подарок" : "Бонус, %"}><input name="value" type="number" required min={1} className="field" placeholder={kind === "gift" ? "100" : "20"} /></Field>
        {kind === "topup" && <Field label="Мин. сумма оплаты, ₽"><input name="min_topup_rub" type="number" min={0} className="field" placeholder="1000" /></Field>}
        <Field label="Лимит активаций" hint="Пусто — без лимита"><input name="max_uses" type="number" min={1} className="field" /></Field>
        <Field label="Действует до"><input name="expires_at" type="datetime-local" className="field" /></Field>
        <Field label="Источник трафика" hint="Для аналитики: blogger-anna, tg-ads…"><input name="source" className="field" placeholder="telegram-ads" /></Field>
      </div>
      <Field label="Заметка"><input name="note" className="field" placeholder="Интеграция у блогера, 20 октября" /></Field>
      <label className="flex items-center gap-2 text-sm text-zinc-300"><input name="new_users_only" type="checkbox" className="h-4 w-4 accent-nova-500" /> Только для тех, кто ещё не платил</label>
      <Button type="submit" loading={saving} className="w-full">Создать промокод</Button>
    </form>
  );
}

export function PromoTab() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const { data: promos = [] } = useQuery({ queryKey: ["admin", "promo"], queryFn: () => get<Promo[]>("/admin/promo") });
  const toggle = async (p: Promo) => {
    await patch(`/admin/promo/${p.id}`, { is_active: !p.is_active });
    qc.invalidateQueries({ queryKey: ["admin", "promo"] });
  };
  const copyLink = (p: Promo) => {
    navigator.clipboard.writeText(`${PUBLIC}/?promo=${p.code}${p.source ? `&utm_source=${encodeURIComponent(p.source)}` : ""}`);
    toast.success("Ссылка с промокодом скопирована");
  };

  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Новый промокод</Button></div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>{["Код", "Тип", "Активации", "Регистрации", "Оплаты", "Выручка", "Выдано ✦", "Срок", ""].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr>
          </thead>
          <tbody>
            {promos.map((p) => (
              <tr key={p.id} className={clsx("border-t border-white/[0.04]", !p.is_active && "opacity-50")}>
                <td className="px-4 py-3">
                  <p className="font-mono font-bold">{p.code}</p>
                  <p className="text-xs text-zinc-500">{p.source || "—"}{p.note && ` · ${p.note}`}</p>
                </td>
                <td className="px-4 py-3">
                  {p.kind === "gift" ? <Badge tone="green">+{p.value} ✦</Badge> : <Badge tone="amber">+{p.value}% к оплате</Badge>}
                  {p.min_topup_rub > 0 && <p className="mt-1 text-[11px] text-zinc-500">от {number(p.min_topup_rub)} ₽</p>}
                  {p.new_users_only && <p className="mt-1 text-[11px] text-zinc-500">только новые</p>}
                </td>
                <td className="px-4 py-3">{p.uses}{p.max_uses ? ` / ${p.max_uses}` : ""}</td>
                <td className="px-4 py-3">{p.signups}</td>
                <td className="px-4 py-3">{p.payments}</td>
                <td className="px-4 py-3 font-semibold">{rub(p.revenue_rub * 100)}</td>
                <td className="px-4 py-3">{number(p.sparks_given)}</td>
                <td className="px-4 py-3 text-xs text-zinc-400">{p.expires_at ? date(p.expires_at) : "бессрочно"}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => copyLink(p)}>Ссылка</Button>
                    <Button size="sm" variant="secondary" onClick={() => toggle(p)}>{p.is_active ? "Выключить" : "Включить"}</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!promos.length && <p className="py-10 text-center text-sm text-zinc-500">Промокодов пока нет</p>}
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="Новый промокод" wide>
        <PromoForm onDone={() => { setCreating(false); qc.invalidateQueries({ queryKey: ["admin", "promo"] }); }} />
      </Modal>
    </div>
  );
}

function ChannelTable({ title, rows, empty }: { title: string; rows: Channel[]; empty: string }) {
  const max = Math.max(...rows.map((r) => r.signups), 1);
  return (
    <Card className="overflow-x-auto p-5">
      <h3 className="font-bold">{title}</h3>
      <table className="mt-3 w-full min-w-[560px] text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-zinc-500">
          <tr><th className="py-2">Канал</th><th>Регистрации</th><th>Платящие</th><th>Конверсия</th><th>Выручка</th><th>ARPU</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-white/[0.04]">
              <td className="py-2.5 font-semibold">{r.key === "—" ? empty : r.key}</td>
              <td>
                <span className="flex items-center gap-2">
                  {r.signups}
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/5"><span className="block h-full rounded-full bg-nova-400" style={{ width: `${(r.signups / max) * 100}%` }} /></span>
                </span>
              </td>
              <td>{r.paying}</td>
              <td className={r.conversion >= 10 ? "text-emerald-300" : "text-zinc-400"}>{r.conversion}%</td>
              <td className="font-semibold">{rub(r.revenue_rub * 100)}</td>
              <td className="text-zinc-400">{rub(r.arpu_rub * 100)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function TrafficTab() {
  const [days, setDays] = useState(30);
  const { data } = useQuery({ queryKey: ["admin", "traffic", days], queryFn: () => get<Traffic>(`/admin/traffic?days=${days}`) });
  if (!data) return null;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">
          Ссылка с меткой: <span className="font-mono text-zinc-300">{PUBLIC}/?utm_source=канал&utm_campaign=кампания&promo=КОД</span>
        </p>
        <div className="flex gap-1 rounded-xl border border-white/10 p-1">
          {[7, 30, 90, 365].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={clsx("rounded-lg px-3 py-1 text-xs font-semibold", d === days ? "bg-white/10 text-white" : "text-zinc-400")}>{d} дн</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-5"><p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Регистрации</p><p className="mt-2 text-2xl font-extrabold">{number(data.signups)}</p></Card>
        <Card className="p-5"><p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">По рефералке</p><p className="mt-2 text-2xl font-extrabold">{number(data.referred_signups)}</p></Card>
        <Card className="p-5"><p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Выплачено рефералам</p><p className="mt-2 text-2xl font-extrabold">{number(data.referral_paid_sparks)} ✦</p></Card>
      </div>
      <Card className="p-5">
        <h3 className="font-bold">Регистрации по дням</h3>
        <div className="mt-4 h-52">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.daily}>
              <defs><linearGradient id="su" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#22d3ee" stopOpacity={0.4} /><stop offset="1" stopColor="#22d3ee" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} />
              <XAxis dataKey="day" tickFormatter={(d) => d.slice(5)} tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="signups" name="Регистрации" stroke="#22d3ee" strokeWidth={2} fill="url(#su)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <ChannelTable title="Источники (utm_source / рефералка / промокод)" rows={data.by_source} empty="до трекинга" />
      <ChannelTable title="Кампании (utm_campaign)" rows={data.by_campaign} empty="без кампании" />
      <ChannelTable title="Промокоды при регистрации" rows={data.by_promo} empty="без промокода" />
      <Card className="overflow-x-auto p-5">
        <h3 className="font-bold">Топ рефереров</h3>
        <table className="mt-3 w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr><th className="py-2">Пользователь</th><th>Код</th><th>Пригласил</th><th>Платящих</th><th>Принесли выручки</th><th>Заработал</th></tr>
          </thead>
          <tbody>
            {data.referrers.map((r) => (
              <tr key={r.code} className="border-t border-white/[0.04]">
                <td className="py-2.5">{r.email}</td><td className="font-mono text-xs">{r.code}</td><td>{r.invited}</td><td>{r.paying}</td>
                <td className="font-semibold">{rub(r.revenue_rub * 100)}</td><td className="text-emerald-300">{number(r.earned)} ✦</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.referrers.length && <p className="py-6 text-center text-sm text-zinc-500">Пока никто никого не пригласил</p>}
      </Card>
    </div>
  );
}
