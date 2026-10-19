import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { motion } from "framer-motion";
import { ArrowDownLeft, ArrowUpRight, Check, Gift, Shield, Sparkles, Ticket, Users, X } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ProviderDot } from "@/components/Brand";
import { EstimatesPicker, useEstimates } from "@/components/Estimates";
import { Button, Card, PageHeader } from "@/components/ui";
import { useMe, useModels, useServices, useSetBalance } from "@/hooks/data";
import { get, post } from "@/lib/api";
import { date, number, rub, sparks } from "@/lib/format";
import type { LedgerEntry, Package } from "@/lib/types";
import { usePublicConfig } from "@/pages/Legal";

const KIND: Record<LedgerEntry["kind"], { label: string; icon: typeof Gift; tone: string }> = {
  welcome: { label: "Бонус", icon: Gift, tone: "text-emerald-300 bg-emerald-400/10" },
  topup: { label: "Пополнение", icon: ArrowDownLeft, tone: "text-emerald-300 bg-emerald-400/10" },
  usage: { label: "Списание", icon: ArrowUpRight, tone: "text-zinc-300 bg-white/5" },
  admin: { label: "Корректировка", icon: Shield, tone: "text-amber-300 bg-amber-400/10" },
  refund: { label: "Возврат", icon: ArrowDownLeft, tone: "text-aqua-300 bg-aqua-400/10" },
  promo: { label: "Промокод", icon: Ticket, tone: "text-amber-300 bg-amber-400/10" },
  referral: { label: "Реферальный бонус", icon: Users, tone: "text-pink-300 bg-pink-400/10" },
};

const total = (p: Package) => p.tokens + Math.floor((p.tokens * p.bonus_percent) / 100);

export function PackageCard({ p, onBuy, loading, promo }: { p: Package; onBuy: () => void; loading?: boolean; promo?: AppliedPromo | null }) {
  const promoExtra = promo && p.price_kopeks / 100 >= promo.min_topup_rub ? Math.floor((total(p) * promo.value) / 100) : 0;
  return (
    <div className={clsx("relative rounded-3xl p-[1px]", p.highlight ? "bg-gradient-to-b from-nova-400 via-fuchsia-500/50 to-transparent" : "bg-white/[0.08]")}>
      <div className="flex h-full flex-col rounded-[calc(1.5rem-1px)] bg-ink-900/95 p-6">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-zinc-300">{p.title}</p>
          {p.highlight && <span className="flex items-center gap-1 rounded-full bg-nova-500/20 px-2 py-0.5 text-[11px] font-bold text-nova-200"><Sparkles className="h-3 w-3" /> Популярный</span>}
          {!p.highlight && p.bonus_percent >= 25 && <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-bold text-emerald-300">Максимум выгоды</span>}
        </div>
        <p className="mt-4 text-3xl font-extrabold">{rub(p.price_kopeks)}</p>
        <p className="mt-2 text-lg font-bold text-nova-200">{sparks(total(p) + promoExtra)}</p>
        {promoExtra > 0 && <p className="text-xs font-semibold text-amber-300">+{number(promoExtra)} ✦ по промокоду {promo!.code}</p>}
        <p className="text-sm text-zinc-500">
          {p.bonus_percent > 0 ? <>{sparks(p.tokens)} <span className="font-semibold text-emerald-300">+{p.bonus_percent}% бонусом</span></> : "без бонуса"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">{(p.price_kopeks / 100 / total(p)).toFixed(2).replace(".", ",")} ₽ за ✦</p>
        <Button className="mt-6" variant={p.highlight ? "primary" : "secondary"} loading={loading} onClick={onBuy}>Пополнить</Button>
      </div>
    </div>
  );
}

type Quote = { ladder: { from_rub: number; bonus_percent: number }[]; min_rub: number };
const QUICK = [500, 1500, 3000, 7500, 15000, 30000];

// Log-scale slider: fine control at small amounts, still reaches 100 000 ₽.
const SLIDER_MIN = 500;
const SLIDER_MAX = 100_000;
const POSITIONS = 1000;
const stepFor = (rub: number) => (rub < 2_000 ? 10 : rub < 10_000 ? 50 : 100);
const snap = (rub: number) => Math.round(rub / stepFor(rub)) * stepFor(rub);
const toAmount = (pos: number) => snap(SLIDER_MIN * Math.pow(SLIDER_MAX / SLIDER_MIN, pos / POSITIONS));
const toPosition = (rub: number) =>
  Math.round((Math.log(Math.min(Math.max(rub, SLIDER_MIN), SLIDER_MAX) / SLIDER_MIN) / Math.log(SLIDER_MAX / SLIDER_MIN)) * POSITIONS);

export function CustomTopup({ onBuy, loading = false, promo = null, ctaLabel }: {
  onBuy: (amount: number) => void; loading?: boolean; promo?: AppliedPromo | null; ctaLabel?: (amount: string) => string;
}) {
  const { data: quote } = useQuery({ queryKey: ["quote-ladder"], queryFn: () => get<Quote>("/billing/custom-quote?amount_rub=0"), staleTime: Infinity });
  const [amount, setAmount] = useState(2000);
  const min = quote?.min_rub ?? 500;
  const ladder = quote?.ladder ?? [];
  const bonus = [...ladder].reverse().find((l) => amount >= l.from_rub)?.bonus_percent ?? 0;
  const next = ladder.find((l) => l.from_rub > amount);
  const base = amount + Math.floor((amount * bonus) / 100);
  const promoExtra = promo && amount >= promo.min_topup_rub ? Math.floor((base * promo.value) / 100) : 0;
  const sparksTotal = base + promoExtra;
  const valid = amount >= min && amount <= 500_000;

  return (
    <Card className="relative overflow-hidden p-5 sm:p-6">
      <div className="absolute -left-16 -top-16 h-48 w-48 rounded-full bg-aqua-400/10 blur-3xl" />
      <div className="relative grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div>
          <h3 className="text-lg font-bold">Своя сумма</h3>
          <p className="mt-1 text-sm text-zinc-400">Пополните ровно на столько, сколько нужно. От {min} ₽, бонус растёт с суммой.</p>
          <div className="relative mt-4">
            <input
              type="number" inputMode="numeric" min={min} max={500000} step={100} value={amount || ""}
              onChange={(e) => setAmount(Math.max(0, Math.floor(Number(e.target.value))))}
              className="field h-14 pr-12 text-2xl font-extrabold"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xl font-bold text-zinc-500">₽</span>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <button type="button" onClick={() => setAmount((a) => Math.max(SLIDER_MIN, a - stepFor(a - 1)))} aria-label="Уменьшить"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 text-lg font-bold text-zinc-300 transition hover:bg-white/10 active:scale-95">−</button>
            <input
              type="range" min={0} max={POSITIONS} step={1} value={toPosition(amount)}
              onChange={(e) => setAmount(toAmount(Number(e.target.value)))}
              aria-label="Сумма пополнения"
              className="nova-range h-2 w-full cursor-pointer appearance-none rounded-full"
              style={{ background: `linear-gradient(90deg, #8b5cf6, #d946ef ${toPosition(amount) / 10}%, rgba(255,255,255,.08) ${toPosition(amount) / 10}%)` }}
            />
            <button type="button" onClick={() => setAmount((a) => Math.min(500_000, a + stepFor(a)))} aria-label="Увеличить"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 text-lg font-bold text-zinc-300 transition hover:bg-white/10 active:scale-95">+</button>
          </div>
          <div className="mt-1.5 flex justify-between px-12 text-[11px] text-zinc-500">
            <span>500 ₽</span><span>шаг {stepFor(amount)} ₽</span><span>100 000 ₽</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {QUICK.map((q) => (
              <button key={q} onClick={() => setAmount(q)} className={clsx("rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
                amount === q ? "border-nova-400/50 bg-nova-500/15 text-white" : "border-white/10 text-zinc-400 hover:text-white")}>
                {number(q)} ₽
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {ladder.map((l) => (
              <span key={l.from_rub} className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 transition",
                bonus === l.bonus_percent ? "bg-emerald-400/15 text-emerald-300 ring-emerald-400/40" : "text-zinc-500 ring-white/10")}>
                от {number(l.from_rub)} ₽ · +{l.bonus_percent}%
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-ink-950/50 p-5 text-center">
          <p className="text-sm text-zinc-400">Вы получите</p>
          <motion.p key={sparksTotal} initial={{ scale: 0.92, opacity: 0.5 }} animate={{ scale: 1, opacity: 1 }} className="mt-1 text-4xl font-extrabold text-gradient">
            {valid ? sparks(sparksTotal) : "—"}
          </motion.p>
          <p className="mt-1 h-5 text-sm">
            {valid && bonus > 0 && <span className="font-semibold text-emerald-300">+{number(base - amount)} ✦ бонусом ({bonus}%)</span>}
            {valid && promoExtra > 0 && <span className="ml-2 font-semibold text-amber-300">+{number(promoExtra)} ✦ промокод</span>}
          </p>
          {valid && next && (
            <p className="mt-2 text-xs text-zinc-500">Добавьте {number(next.from_rub - amount)} ₽ — и бонус вырастет до {next.bonus_percent}%</p>
          )}
          {!valid && <p className="mt-2 text-xs text-amber-300">Сумма от {min} до 500 000 ₽</p>}
          <Button className="mt-5 w-full" size="lg" disabled={!valid} loading={loading} onClick={() => onBuy(amount)}>
            {ctaLabel ? ctaLabel(valid ? rub(amount * 100) : "…") : `Пополнить на ${valid ? rub(amount * 100) : "…"}`}
          </Button>
        </div>
      </div>
    </Card>
  );
}

type AppliedPromo = { code: string; value: number; min_topup_rub: number };

function PromoBox({ applied, onApply, onGift }: { applied: AppliedPromo | null; onApply: (p: AppliedPromo | null) => void; onGift: (balance: number) => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    try {
      const res = await get<{ valid: boolean; kind?: "gift" | "topup"; value?: number; code?: string; min_topup_rub?: number; message: string }>(
        `/promo/check?code=${encodeURIComponent(code.trim())}`,
      );
      if (!res.valid) return toast.error(res.message);
      if (res.kind === "gift") {
        const r = await post<{ sparks: number; balance: number }>("/promo/redeem", { code: res.code });
        toast.success(`Промокод активирован: +${sparks(r.sparks)}`);
        onGift(r.balance);
      } else {
        onApply({ code: res.code!, value: res.value!, min_topup_rub: res.min_topup_rub ?? 0 });
        toast.success(res.message);
      }
      setCode("");
      setOpen(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (applied) {
    return (
      <span className="inline-flex items-center gap-2 self-start rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-sm font-semibold text-amber-200">
        <Ticket className="h-4 w-4" /> {applied.code} · +{applied.value}%{applied.min_topup_rub ? ` от ${number(applied.min_topup_rub)} ₽` : ""}
        <button onClick={() => onApply(null)} className="text-amber-300/70 hover:text-white" aria-label="Убрать промокод"><X className="h-3.5 w-3.5" /></button>
      </span>
    );
  }
  return open ? (
    <motion.form initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} onSubmit={submit} className="flex gap-2">
      <input autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ПРОМОКОД" className="field w-44 uppercase tracking-wider" />
      <Button type="submit" loading={busy}>Применить</Button>
    </motion.form>
  ) : (
    <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 self-start text-sm font-semibold text-nova-300 hover:text-nova-200">
      <Ticket className="h-4 w-4" /> Есть промокод?
    </button>
  );
}

export default function Billing() {
  const { data: user } = useMe();
  const { data: models = [] } = useModels();
  const { data: services = [] } = useServices();
  const { data: estimates } = useEstimates();
  const { data: packages = [] } = useQuery({ queryKey: ["packages"], queryFn: () => get<Package[]>("/billing/packages") });
  const { data: ledger = [] } = useQuery({ queryKey: ["ledger"], queryFn: () => get<LedgerEntry[]>("/billing/ledger") });
  const [buying, setBuying] = useState<string | null>(null);
  const [promo, setPromo] = useState<AppliedPromo | null>(null);
  const { data: config } = usePublicConfig();
  const packagesRef = useRef<HTMLDivElement>(null);
  const setBalance = useSetBalance();
  const qc = useQueryClient();

  const buy = async (pkg: Package) => {
    setBuying(pkg.slug);
    try {
      const res = await post<{ confirmation_url: string | null; balance: number }>("/billing/topup", { package_slug: pkg.slug, promo_code: promo?.code ?? null });
      if (res.confirmation_url) {
        window.location.href = res.confirmation_url;
        return;
      }
      setBalance(res.balance);
      toast.success(`Зачислено ${sparks(total(pkg))}`);
      qc.invalidateQueries({ queryKey: ["ledger"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBuying(null);
    }
  };

  const buyCustom = async (amount: number) => {
    setBuying("custom");
    try {
      const res = await post<{ confirmation_url: string | null; balance: number; payment: { tokens: number } }>("/billing/topup", { amount_rub: amount, promo_code: promo?.code ?? null });
      if (res.confirmation_url) {
        window.location.href = res.confirmation_url;
        return;
      }
      setBalance(res.balance);
      toast.success(`Зачислено ${sparks(res.payment.tokens)}`);
      qc.invalidateQueries({ queryKey: ["ledger"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBuying(null);
    }
  };

  return (
    <div>
      {config && !config.payments_enabled && (
        <div className="mb-6 rounded-2xl border border-amber-400/30 bg-amber-400/[0.08] p-4 text-sm text-amber-200">
          Приём оплаты подключается. Чтобы пополнить баланс прямо сейчас, напишите нам в{" "}
          <Link to="/app/support" className="font-semibold underline">«Поддержку»</Link>.
        </div>
      )}
      <PageHeader title="Баланс" subtitle="Искры ✦ — валюта Nova. 1 ✦ ≈ 1 ₽, не сгорают, чем больше пакет — тем больше бонус." />

      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-nova-600/40 via-fuchsia-600/20 to-cyan-500/20 p-6 sm:p-8">
        <motion.div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-fuchsia-500/30 blur-3xl" animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 8, repeat: Infinity }} />
        <motion.span className="absolute right-8 top-6 text-6xl text-white/20 sm:text-8xl" animate={{ rotate: [0, 15, 0], scale: [1, 1.1, 1] }} transition={{ duration: 6, repeat: Infinity }}>✦</motion.span>
        <p className="relative text-sm font-semibold text-white/70">Доступно</p>
        <motion.p key={user?.balance} initial={{ scale: 0.96, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} className="relative mt-1 text-4xl font-extrabold tracking-tight sm:text-5xl">
          {sparks(user?.balance ?? 0)}
        </motion.p>
        <p className="relative mt-1 text-white/70">≈ {rub((user?.balance ?? 0) * 100)}</p>
      </div>

      <h2 className="mb-1 mt-10 text-lg font-bold">Сколько искр мне нужно?</h2>
      <p className="mb-4 text-sm text-zinc-400">Примерный расчёт по реальным ценам моделей и услуг.</p>
      <EstimatesPicker packages={packages} onPick={() => packagesRef.current?.scrollIntoView({ behavior: "smooth" })} />

      <div ref={packagesRef} className="mb-4 mt-10 flex scroll-mt-6 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-bold">Пополнить</h2>
        <PromoBox applied={promo} onApply={setPromo} onGift={(b) => { setBalance(b); qc.invalidateQueries({ queryKey: ["ledger"] }); }} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {packages.map((p, i) => (
          <motion.div key={p.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <PackageCard p={p} promo={promo} loading={buying === p.slug} onBuy={() => buy(p)} />
          </motion.div>
        ))}
      </div>
      <div className="mt-4">
        <CustomTopup promo={promo} onBuy={buyCustom} loading={buying === "custom"} />
      </div>

      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.3fr]">
        <div className="space-y-6">
          <Card className="p-5 sm:p-6">
            <h2 className="font-bold">Цена сообщения в чате</h2>
            <p className="mt-1 text-xs text-zinc-500">Обычное сообщение · с базой знаний</p>
            <div className="mt-4 space-y-2">
              {models.map((m) => {
                const e = estimates?.per_message.find((x) => x.slug === m.slug);
                return (
                  <div key={m.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.02] px-3 py-2.5">
                    <span className="flex items-center gap-2 text-sm font-semibold"><ProviderDot provider={m.provider} /> {m.title}</span>
                    <span className="text-xs text-zinc-300">{e ? `~${e.sparks} ✦ · ~${e.sparks_rag} ✦` : "—"}</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-zinc-500">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              Считается по фактической длине. Если модель не ответила — искры не списываются.
            </p>
          </Card>
          <Card className="p-5 sm:p-6">
            <h2 className="font-bold">Услуги · фиксированная цена</h2>
            <div className="mt-4 space-y-1.5">
              {services.map((s) => (
                <div key={s.slug} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-zinc-300">{s.emoji} {s.title}</span>
                  <span className="shrink-0 text-zinc-200">{sparks(s.price)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card className="h-fit p-5 sm:p-6">
          <h2 className="font-bold">История операций</h2>
          <div className="mt-4 divide-y divide-white/[0.05]">
            {ledger.map((e) => {
              const k = KIND[e.kind];
              return (
                <div key={e.id} className="flex items-center gap-3 py-3">
                  <span className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-xl", k.tone)}><k.icon className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{e.description || k.label}</p>
                    <p className="text-[11px] text-zinc-500">{date(e.created_at)}</p>
                  </div>
                  <span className={clsx("shrink-0 text-sm font-semibold", e.amount > 0 ? "text-emerald-300" : "text-zinc-300")}>
                    {e.amount > 0 ? "+" : ""}{number(e.amount)} ✦
                  </span>
                </div>
              );
            })}
            {!ledger.length && <p className="py-8 text-center text-sm text-zinc-500">Операций пока нет</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
