import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight, BookOpen, Bot, MessageSquare, Sparkles, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { AgentAvatar } from "@/components/Brand";
import { Card, listMotion } from "@/components/ui";
import { useAgents, useChats, useMe, useServices } from "@/hooks/data";
import { ServiceCard } from "./Services";
import { get } from "@/lib/api";
import { relative, sparks } from "@/lib/format";

const ACTIONS = [
  { to: "/app/chat", icon: MessageSquare, title: "Новый чат", text: "GPT-6 Luna или Terra", tint: "from-nova-500/25" },
  { to: "/app/studio", icon: Sparkles, title: "Студия", text: "Пост, план, сценарий", tint: "from-fuchsia-500/25" },
  { to: "/app/agents", icon: Bot, title: "Создать агента", text: "Своя роль и модель", tint: "from-emerald-500/20" },
  { to: "/app/knowledge", icon: BookOpen, title: "База знаний", text: "Загрузить документы", tint: "from-cyan-500/25" },
];

function greeting() {
  const h = new Date().getHours();
  return h < 6 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер";
}

export default function Home() {
  const { data: user } = useMe();
  const { data: chats = [] } = useChats();
  const { data: agents = [] } = useAgents();
  const { data: services = [] } = useServices();
  const { data: usage = [] } = useQuery({ queryKey: ["usage"], queryFn: () => get<{ day: string; spent: number }[]>("/billing/usage") });
  const spent = usage.reduce((s, d) => s + d.spent, 0);

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <p className="text-sm font-semibold text-nova-300">{greeting()},</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">{user?.name} 👋</h1>
      </motion.div>

      <motion.div variants={listMotion.container} initial="hidden" animate="show" className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ACTIONS.map(({ to, icon: Icon, title, text, tint }) => (
          <motion.div key={to} variants={listMotion.item}>
            <Link to={to} className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br ${tint} to-transparent p-4 transition hover:-translate-y-0.5 hover:border-white/20 sm:p-5`}>
              <Icon className="h-6 w-6 text-white/90" />
              <p className="mt-6 font-bold">{title}</p>
              <p className="text-xs text-zinc-400 sm:text-sm">{text}</p>
              <ArrowRight className="absolute right-4 top-4 h-4 w-4 -translate-x-1 text-zinc-500 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" />
            </Link>
          </motion.div>
        ))}
      </motion.div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="min-w-0 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-zinc-400">Баланс</p>
              <p className="mt-1 text-3xl font-extrabold">{sparks(user?.balance ?? 0)}</p>
              <p className="mt-1 text-xs text-zinc-500">Потрачено за 14 дней: {sparks(spent)}</p>
            </div>
            <Link to="/app/billing" aria-label="Пополнить" className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white/[0.06] px-3 py-2 text-sm font-semibold transition hover:bg-white/10">
              <Wallet className="h-4 w-4" /> <span className="hidden sm:inline">Пополнить</span>
            </Link>
          </div>
          <div className="mt-5 h-36">
            {usage.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={usage} margin={{ left: 0, right: 0, top: 5, bottom: 0 }}>
                  <defs>
                    <linearGradient id="spend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#a78bfa" stopOpacity={0.5} />
                      <stop offset="1" stopColor="#a78bfa" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" tickFormatter={(d) => d.slice(5)} tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#161625", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12 }}
                    formatter={(v: number) => [sparks(v), "Потрачено"]}
                  />
                  <Area type="monotone" dataKey="spent" stroke="#a78bfa" strokeWidth={2} fill="url(#spend)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center rounded-xl border border-dashed border-white/10 text-sm text-zinc-500">
                Здесь появится график расходов
              </div>
            )}
          </div>
        </Card>

        <Card className="min-w-0 p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">Недавние чаты</h2>
            <Link to="/app/chat" className="text-xs font-semibold text-nova-300">Все</Link>
          </div>
          <div className="mt-3 space-y-1">
            {chats.slice(0, 5).map((c) => (
              <Link key={c.id} to={`/app/chat/${c.id}`} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition hover:bg-white/[0.04]">
                <span className="truncate text-sm">{c.title}</span>
                <span className="shrink-0 text-[11px] text-zinc-500">{relative(c.updated_at)}</span>
              </Link>
            ))}
            {!chats.length && <p className="py-8 text-center text-sm text-zinc-500">Начните первый диалог ✦</p>}
          </div>
        </Card>
      </div>

      <div className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Популярные услуги</h2>
          <Link to="/app/services" className="text-xs font-semibold text-nova-300">Все услуги</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {services.slice(0, 3).map((s) => <ServiceCard key={s.slug} s={s} />)}
        </div>
      </div>

      <div className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Агенты</h2>
          <Link to="/app/agents" className="text-xs font-semibold text-nova-300">Все агенты</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {agents.slice(0, 4).map((a) => (
            <Link key={a.id} to="/app/chat" state={{ agentId: a.id }}>
              <Card hover className="h-full p-4">
                <AgentAvatar emoji={a.emoji} color={a.color} />
                <p className="mt-3 font-bold">{a.name}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-400">{a.description}</p>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
