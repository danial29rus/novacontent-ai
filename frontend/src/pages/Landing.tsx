import { useQuery } from "@tanstack/react-query";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, Bot, BookOpen, Check, Layers, MessageSquare, ShieldCheck, Sparkles, Wallet, Zap, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EstimatesPicker } from "@/components/Estimates";
import { LegalLinks, usePublicConfig } from "@/pages/Legal";
import { CustomTopup, PackageCard } from "@/pages/app/Billing";
import { Aurora, Logo, LogoMark, ProviderDot } from "@/components/Brand";
import { Button } from "@/components/ui";
import { useMe } from "@/hooks/data";
import { get } from "@/lib/api";
import type { Package } from "@/lib/types";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.6, ease: [0.22, 1, 0.36, 1] } }),
};

const DEMO = [
  { role: "user", text: "Собери контент-план запуска кофейни на неделю" },
  {
    role: "ai",
    text: "Готово ✦ Опирался на вашу базу знаний [1]:\n\nПн — история бренда · пост\nВт — закулисье обжарки · Reels\nСр — опрос «ваш идеальный капучино»",
  },
];

function TypingDemo() {
  const [shown, setShown] = useState(0);
  const full = DEMO[1].text;
  useEffect(() => {
    if (shown >= full.length) {
      const t = setTimeout(() => setShown(0), 3500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setShown((s) => s + 2), shown === 0 ? 900 : 22);
    return () => clearTimeout(t);
  }, [shown, full.length]);

  return (
    <div className="relative">
      <div className="absolute -inset-6 rounded-[2.5rem] bg-gradient-to-br from-nova-500/30 via-fuchsia-500/20 to-cyan-400/20 blur-3xl" />
      <div className="glass relative overflow-hidden rounded-3xl">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
            <span className="ml-3 flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold">
              <ProviderDot provider="openai" /> GPT-5.6 Terra
            </span>
          </div>
        </div>
        <div className="space-y-4 p-5 sm:p-6">
          <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-nova-500 to-fuchsia-500 px-4 py-2.5 text-sm font-medium shadow-glow">
            {DEMO[0].text}
          </div>
          <div className="flex gap-3">
            <LogoMark className="h-8 w-8 shrink-0" />
            <div className="min-h-[132px] flex-1 whitespace-pre-line rounded-2xl rounded-tl-md border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm leading-6 text-zinc-200">
              <span className={shown < full.length ? "caret" : ""}>{full.slice(0, shown)}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pl-11">
            <span className="rounded-full border border-aqua-400/30 bg-aqua-400/10 px-2.5 py-1 text-[11px] font-semibold text-aqua-300">
              [1] brand-book.pdf
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-zinc-400">−6 ✦</span>
          </div>
        </div>
        <div className="border-t border-white/[0.06] p-4">
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-ink-900/80 px-4 py-3 text-sm text-zinc-500">
            Спросите что угодно…
            <span className="ml-auto grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-nova-500 to-fuchsia-500 text-white">
              <ArrowRight className="h-4 w-4" />
            </span>
          </div>
        </div>
      </div>

      <motion.div
        className="glass absolute -bottom-10 -left-4 hidden items-center gap-3 rounded-2xl px-4 py-3 sm:flex lg:-left-10"
        animate={{ y: [0, -10, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      >
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-400/15 text-lg">📈</span>
        <div>
          <p className="text-xs text-zinc-400">Агент</p>
          <p className="text-sm font-bold">Маркетолог</p>
        </div>
      </motion.div>
      <motion.div
        className="glass absolute -right-3 -top-6 hidden items-center gap-2 rounded-2xl px-4 py-3 sm:flex lg:-right-8"
        animate={{ y: [0, 10, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 1 }}
      >
        <BookOpen className="h-4 w-4 text-aqua-300" />
        <span className="text-sm font-semibold">RAG · 3 источника</span>
      </motion.div>
    </div>
  );
}

const FEATURES = [
  { icon: MessageSquare, title: "Чаты с лучшими моделями", text: "GPT-6 Luna и GPT-5.6 Terra в одном окне. Переключайте модель прямо посреди диалога." },
  { icon: Bot, title: "Свои AI-агенты", text: "Задайте роль, характер, модель и подключите базу знаний — агент готов за минуту." },
  { icon: BookOpen, title: "База знаний (RAG)", text: "Загрузите PDF, заметки, регламенты — ответы будут опираться на ваши документы со ссылками." },
  { icon: Layers, title: "Готовые контент-паки", text: "Запуск продукта, неделя контента, Reels — сценарии из нескольких шагов в один клик." },
  { icon: Zap, title: "Умная память диалога", text: "Длинные чаты автоматически сжимаются в конспект — модель помнит главное и не тратит лишнего." },
  { icon: Wallet, title: "Честный баланс", text: "Платите искрами ✦ только за то, что используете. Прозрачная история списаний." },
];

const SERVICES_PREVIEW = [
  ["🤖", "Собери AI-агента", "5 вопросов — и готовый агент для вашего бизнеса"],
  ["🏭", "Контент-завод", "10 готовых постов в одном стиле"],
  ["🗓️", "Контент-план на месяц", "30 дней с рубриками и целями"],
  ["🎬", "Сценарии Reels", "5 вирусных роликов с раскадровкой"],
  ["💎", "Упаковка бренда", "Позиционирование, УТП, tone of voice"],
  ["🛬", "Текст лендинга", "Продающая структура и офферы"],
  ["📧", "Email-цепочка", "5 писем от знакомства до продажи"],
  ["📣", "Рекламные объявления", "15 объявлений для таргета и Директа"],
];

const FAQ = [
  ["Что такое Искры ✦?", "Внутренняя валюта Nova: 1 ✦ ≈ 1 ₽. Сообщение в чате стоит от 1 ✦ (зависит от модели и длины), услуги — фиксированная цена. Чем больше пакет, тем больше бонусных искр."],
  ["Мои документы видят другие?", "Нет. База знаний доступна только вам и вашим агентам. Ключи провайдеров хранятся на сервере и никогда не попадают в браузер."],
  ["Можно ли сменить модель в середине чата?", "Да, контекст диалога сохраняется — следующий ответ просто придёт от другой модели."],
  ["Сгорают ли искры?", "Нет, баланс не ограничен по сроку."],
];

export default function Landing() {
  const { data: user } = useMe();
  const { data: packages } = useQuery({ queryKey: ["packages"], queryFn: () => get<Package[]>("/billing/packages") });
  const { scrollY } = useScroll();
  const headerBg = useTransform(scrollY, [0, 80], ["rgba(7,7,13,0)", "rgba(7,7,13,0.75)"]);
  const cta = user ? "/app/billing" : "/register";
  const navigate = useNavigate();
  const supportEmail = usePublicConfig().data?.support_email ?? "support@24nova-ai.ru";

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <Aurora intense />

      <motion.header style={{ backgroundColor: headerBg }} className="fixed inset-x-0 top-0 z-40 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-8 text-sm text-zinc-400 md:flex">
            <a href="#features" className="transition hover:text-white">Возможности</a>
            <a href="#services" className="transition hover:text-white">Услуги</a>
            <a href="#pricing" className="transition hover:text-white">Цены</a>
            <a href="#faq" className="transition hover:text-white">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            {!user && (
              <Link to="/login" className="hidden px-3 text-sm font-semibold text-zinc-300 hover:text-white sm:block">
                Войти
              </Link>
            )}
            <Link to={cta}>
              <Button size="sm">{user ? "Открыть кабинет" : "Начать бесплатно"}</Button>
            </Link>
          </div>
        </div>
      </motion.header>

      <section className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-32 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-40">
        <motion.div initial="hidden" animate="show">
          <motion.p variants={fadeUp} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-zinc-300">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            GPT-6 · RAG · агенты
          </motion.p>
          <motion.h1 variants={fadeUp} custom={1} className="mt-6 text-[2.6rem] font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
            Ваша AI-студия, <br />
            <span className="text-gradient">которая знает ваш бизнес</span>
          </motion.h1>
          <motion.p variants={fadeUp} custom={2} className="mt-6 max-w-xl text-lg text-zinc-400">
            Общайтесь с лучшими моделями, создавайте своих агентов, загружайте документы и запускайте готовые контент-паки — всё в одном красивом пространстве.
          </motion.p>
          <motion.div variants={fadeUp} custom={3} className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link to={cta}>
              <Button size="lg" className="w-full sm:w-auto">
                Попробовать бесплатно <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <a href="#features">
              <Button size="lg" variant="secondary" className="w-full sm:w-auto">Как это работает</Button>
            </a>
          </motion.div>
          <motion.p variants={fadeUp} custom={4} className="mt-5 flex items-center gap-2 text-sm text-zinc-500">
            <Check className="h-4 w-4 text-emerald-400" /> 50 ✦ в подарок при регистрации
          </motion.p>
        </motion.div>

        <motion.div initial={{ opacity: 0, scale: 0.95, y: 30 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}>
          <TypingDemo />
        </motion.div>
      </section>

      <section id="models" className="border-y border-white/[0.06] bg-white/[0.015] py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-4 px-4 text-sm font-semibold text-zinc-400">
          {[["openai", "GPT-6 Luna"], ["openai", "GPT-5.6 Terra"]].map(([p, n]) => (
            <span key={n} className="flex items-center gap-2.5"><ProviderDot provider={p} /> {n}</span>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true, margin: "-80px" }} className="mx-auto max-w-2xl text-center">
          <motion.h2 variants={fadeUp} className="text-3xl font-extrabold tracking-tight sm:text-4xl">Всё, что нужно для работы с AI</motion.h2>
          <motion.p variants={fadeUp} custom={1} className="mt-4 text-zinc-400">Без VPN, без зарубежных карт и без десятка подписок.</motion.p>
        </motion.div>
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }, i) => (
            <motion.div
              key={title}
              variants={fadeUp}
              custom={i}
              className="glass group relative overflow-hidden rounded-3xl p-6 transition duration-300 hover:-translate-y-1 hover:border-nova-400/30"
            >
              <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-nova-500/0 blur-2xl transition duration-500 group-hover:bg-nova-500/25" />
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-nova-500/25 to-aqua-400/10 text-nova-300 ring-1 ring-white/10">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-5 font-bold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-400">{text}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      <section id="services" className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Услуги под ключ</h2>
          <p className="mt-4 text-zinc-400">Заполните бриф — получите готовый результат за минуту.</p>
        </div>
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICES_PREVIEW.map(([emoji, title, text], i) => (
            <motion.div key={title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }}
              className="glass rounded-2xl p-5 transition hover:-translate-y-1 hover:border-nova-400/30">
              <span className="text-3xl">{emoji}</span>
              <h3 className="mt-3 font-bold">{title}</h3>
              <p className="mt-1 text-sm text-zinc-400">{text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Пополняйте, когда нужно</h2>
          <p className="mt-4 text-zinc-400">Искры ✦ — наша валюта: 1 ✦ ≈ 1 ₽. Без подписки, не сгорают, до +30% бонусом.</p>
        </div>
        <div className="mt-12">
          <EstimatesPicker packages={packages ?? []} />
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(packages ?? []).map((p, i) => (
            <motion.div key={p.id} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06, duration: 0.5 }}>
              <PackageCard p={p} onBuy={() => navigate(cta)} />
            </motion.div>
          ))}
        </div>
        <motion.div className="mt-4" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
          <CustomTopup onBuy={() => navigate(cta)} ctaLabel={(sum) => (user ? `Пополнить на ${sum}` : `Начать — пополнить на ${sum}`)} />
        </motion.div>
      </section>

      <section id="faq" className="mx-auto max-w-3xl px-4 pb-24 sm:px-6">
        <h2 className="text-center text-3xl font-extrabold tracking-tight">Частые вопросы</h2>
        <div className="mt-10 space-y-3">
          {FAQ.map(([q, a]) => (
            <details key={q} className="glass group rounded-2xl px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {q}
                <span className="text-xl text-nova-300 transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm leading-6 text-zinc-400">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-nova-600/30 via-fuchsia-600/15 to-cyan-500/15 px-6 py-14 text-center sm:px-12">
          <Sparkles className="mx-auto h-8 w-8 text-nova-300" />
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">Начните за 30 секунд</h2>
          <p className="mx-auto mt-3 max-w-lg text-zinc-300">Регистрация без карты. Приветственные искры сразу на балансе.</p>
          <Link to={cta} className="mt-8 inline-block">
            <Button size="lg">Создать аккаунт <ArrowRight className="h-4 w-4" /></Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-white/[0.06] py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-zinc-500 sm:flex-row sm:px-6">
          <Logo />
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <LegalLinks />
            <a href={`mailto:${supportEmail}`} className="flex items-center gap-1.5 text-nova-300 hover:text-nova-200"><Mail className="h-4 w-4" /> {supportEmail}</a>
          </nav>
          <p className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> © {new Date().getFullYear()} Nova AI</p>
        </div>
      </footer>
    </div>
  );
}
