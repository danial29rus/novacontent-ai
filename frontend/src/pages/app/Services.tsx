import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Copy, MessageSquare, Sparkles, Wand2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { AgentAvatar } from "@/components/Brand";
import { Markdown } from "@/components/chat/Markdown";
import { Badge, Button, Card, Field, listMotion, PageHeader, Spinner } from "@/components/ui";
import { useMe, useProjects, useServices, useSetBalance } from "@/hooks/data";
import { ApiError, post } from "@/lib/api";
import { rub, sparks } from "@/lib/format";
import type { Agent, Generation, Service } from "@/lib/types";

const LOADING_STEPS = ["Изучаю бриф…", "Продумываю структуру…", "Пишу черновик…", "Шлифую формулировки…", "Почти готово…"];

function Runner({ service }: { service: Service }) {
  const { data: user } = useMe();
  const { data: projects = [] } = useProjects();
  const setBalance = useSetBalance();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<{ generation: Generation; agent: Agent | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const enough = (user?.balance ?? 0) >= service.price;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    const { project_id, ...input } = data;
    setLoading(true);
    setResult(null);
    setStep(0);
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1)), 2500);
    try {
      const res = await post<{ generation: Generation; agent: Agent | null; balance: number }>(
        `/services/${service.slug}/run`, { input, project_id: project_id ? Number(project_id) : null },
      );
      setResult(res);
      setBalance(res.balance);
      qc.invalidateQueries({ queryKey: ["library"] });
      if (res.agent) qc.invalidateQueries({ queryKey: ["agents"] });
      toast.success(res.agent ? "Агент создан!" : "Готово!");
    } catch (err) {
      toast.error((err as Error).message, err instanceof ApiError && err.status === 402
        ? { action: { label: "Пополнить", onClick: () => navigate("/app/billing") } } : undefined);
    } finally {
      clearInterval(timer);
      setLoading(false);
    }
  };

  return (
    <div>
      <Link to="/app/services" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Все услуги
      </Link>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <div className="mb-6 flex items-start gap-4">
            <motion.span initial={{ scale: 0.6, rotate: -15 }} animate={{ scale: 1, rotate: 0 }} className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-nova-500/30 to-fuchsia-500/10 text-3xl ring-1 ring-white/10">
              {service.emoji}
            </motion.span>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{service.title}</h1>
              <p className="mt-1.5 text-sm text-zinc-400">{service.description}</p>
            </div>
          </div>

          <Card className="p-5 sm:p-6">
            <form onSubmit={submit} className="space-y-4">
              {service.fields.map((f) => (
                <Field key={f.name} label={f.label + (f.required ? "" : " · необязательно")}>
                  {f.options.length ? (
                    <select name={f.name} required={f.required} className="field">
                      {f.options.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  ) : f.textarea ? (
                    <textarea name={f.name} required={f.required} rows={3} className="field resize-y" placeholder={f.placeholder} />
                  ) : (
                    <input name={f.name} required={f.required} className="field" placeholder={f.placeholder} />
                  )}
                </Field>
              ))}
              {!!projects.length && (
                <Field label="Проект · память бренда" hint="AI учтёт тон и факты из проекта">
                  <select name="project_id" className="field">
                    <option value="">Без проекта</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
              )}
              <Button type="submit" size="lg" loading={loading} disabled={!enough} className="w-full">
                <Wand2 className="h-4 w-4" /> Запустить за {sparks(service.price)}
              </Button>
              {!enough && (
                <p className="text-center text-sm text-amber-300">
                  Не хватает искр · <Link to="/app/billing" className="font-semibold underline">пополнить баланс</Link>
                </p>
              )}
            </form>
          </Card>

          <AnimatePresence mode="wait">
            {loading && (
              <motion.div key="loading" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-6 flex items-center gap-4 rounded-2xl border border-nova-400/20 bg-nova-500/[0.06] p-5">
                <Spinner className="h-6 w-6" />
                <AnimatePresence mode="wait">
                  <motion.span key={step} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="font-semibold">
                    {LOADING_STEPS[step]}
                  </motion.span>
                </AnimatePresence>
              </motion.div>
            )}
            {result && (
              <motion.div key="result" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-4">
                {result.agent && (
                  <div className="flex flex-col gap-4 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.06] p-5 sm:flex-row sm:items-center">
                    <AgentAvatar emoji={result.agent.emoji} color={result.agent.color} size="lg" />
                    <div className="flex-1">
                      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">Агент готов</p>
                      <p className="text-lg font-bold">{result.agent.name}</p>
                    </div>
                    <Button onClick={() => navigate("/app/chat", { state: { agentId: result.agent!.id } })}>
                      <MessageSquare className="h-4 w-4" /> Начать чат
                    </Button>
                  </div>
                )}
                <Card className="p-5 sm:p-6">
                  <div className="mb-4 flex items-center justify-between text-xs text-zinc-500">
                    <span>Сохранено в библиотеку · −{sparks(result.generation.cost)}</span>
                    <button onClick={() => { navigator.clipboard.writeText(result.generation.output); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                      className="flex items-center gap-1 font-semibold text-zinc-400 hover:text-white">
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Скопировано" : "Копировать"}
                    </button>
                  </div>
                  <Markdown>{result.generation.output}</Markdown>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <aside className="h-fit space-y-4 lg:sticky lg:top-6">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-nova-600/30 via-fuchsia-600/15 to-cyan-500/10 p-6">
            <p className="text-sm text-zinc-300">Стоимость запуска</p>
            <p className="mt-1 text-3xl font-extrabold">{sparks(service.price)}</p>
            <p className="text-sm text-zinc-400">≈ {rub(service.price * 100)} · фиксированно</p>
            <ul className="mt-5 space-y-2 text-sm">
              {service.perks.map((p) => <li key={p} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /> {p}</li>)}
            </ul>
            <p className="mt-5 text-xs text-zinc-400">На балансе: {sparks(user?.balance ?? 0)}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function ServiceCard({ s }: { s: Service }) {
  return (
    <Link to={`/app/services/${s.slug}`} className="group block h-full">
      <Card hover className="relative flex h-full flex-col overflow-hidden p-5">
        <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-nova-500/0 blur-2xl transition duration-500 group-hover:bg-nova-500/25" />
        <div className="flex items-start justify-between">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.05] text-2xl ring-1 ring-white/10 transition group-hover:scale-110">{s.emoji}</span>
          {s.badge && <Badge tone={s.badge === "Хит" ? "amber" : "nova"}>{s.badge}</Badge>}
        </div>
        <h3 className="mt-4 font-bold">{s.title}</h3>
        <p className="mt-1 flex-1 text-sm leading-6 text-zinc-400">{s.description}</p>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-nova-200">{sparks(s.price)}</span>
          <span className="flex items-center gap-1 text-xs font-semibold text-zinc-400 transition group-hover:text-white">
            Запустить <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
          </span>
        </div>
      </Card>
    </Link>
  );
}

export default function Services() {
  const { slug } = useParams();
  const { data: services = [], isLoading } = useServices();
  const [category, setCategory] = useState("Все");
  const categories = useMemo(() => ["Все", ...new Set(services.map((s) => s.category))], [services]);

  if (isLoading) return <div className="grid h-64 place-items-center"><Spinner /></div>;
  const active = services.find((s) => s.slug === slug);
  if (slug && active) return <Runner service={active} />;

  const visible = category === "Все" ? services : services.filter((s) => s.category === category);
  const hero = services.find((s) => s.slug === "agent-builder");

  return (
    <div>
      <PageHeader title="Услуги" subtitle="Готовые AI-решения под ключ: заполните бриф — получите результат. Фиксированная цена за запуск." />

      {hero && (
        <Link to={`/app/services/${hero.slug}`}>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="group relative mb-8 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-nova-600/40 via-fuchsia-600/20 to-cyan-500/15 p-6 sm:p-8">
            <motion.div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-fuchsia-500/30 blur-3xl" animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 7, repeat: Infinity }} />
            <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
              <motion.span animate={{ y: [0, -6, 0] }} transition={{ duration: 4, repeat: Infinity }} className="text-6xl">{hero.emoji}</motion.span>
              <div className="flex-1">
                <Badge tone="amber"><Sparkles className="h-3 w-3" /> Хит</Badge>
                <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">{hero.title}</h2>
                <p className="mt-1 max-w-xl text-zinc-300">{hero.description}</p>
              </div>
              <Button size="lg" className="shrink-0">Собрать за {sparks(hero.price)} <ArrowRight className="h-4 w-4" /></Button>
            </div>
          </motion.div>
        </Link>
      )}

      <div className="-mx-1 mb-6 flex gap-1 overflow-x-auto px-1">
        {categories.map((c) => (
          <button key={c} onClick={() => setCategory(c)}
            className={clsx("relative shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition", category === c ? "text-white" : "text-zinc-400 hover:text-white")}>
            {category === c && <motion.span layoutId="svc-cat" className="absolute inset-0 rounded-xl border border-white/10 bg-white/[0.07]" />}
            <span className="relative">{c}</span>
          </button>
        ))}
      </div>

      <motion.div key={category} variants={listMotion.container} initial="hidden" animate="show" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((s) => <motion.div key={s.slug} variants={listMotion.item}><ServiceCard s={s} /></motion.div>)}
      </motion.div>
    </div>
  );
}
