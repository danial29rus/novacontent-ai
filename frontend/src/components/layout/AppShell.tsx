import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bot,
  Briefcase,
  Gift,
  LifeBuoy,
  BookOpen,
  FolderKanban,
  LayoutDashboard,
  Library as LibraryIcon,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  Shield,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Aurora, Logo } from "@/components/Brand";
import { Spinner } from "@/components/ui";
import { useChats, useMe } from "@/hooks/data";
import { get, post } from "@/lib/api";
import { useUnreadTickets } from "@/pages/app/Support";
import { sparks } from "@/lib/format";
import { LegalLinks } from "@/pages/Legal";

const NAV = [
  { to: "/app", label: "Главная", icon: LayoutDashboard, end: true },
  { to: "/app/chat", label: "Чаты", icon: MessageSquare },
  { to: "/app/services", label: "Услуги", icon: Briefcase },
  { to: "/app/agents", label: "Агенты", icon: Bot },
  { to: "/app/studio", label: "Студия", icon: Sparkles },
  { to: "/app/projects", label: "Проекты и паки", icon: FolderKanban },
  { to: "/app/knowledge", label: "База знаний", icon: BookOpen },
  { to: "/app/library", label: "Библиотека", icon: LibraryIcon },
  { to: "/app/billing", label: "Баланс", icon: Wallet },
  { to: "/app/referral", label: "Пригласить друга", icon: Gift },
  { to: "/app/support", label: "Поддержка", icon: LifeBuoy },
];

const MOBILE_TABS = [NAV[0], NAV[1], NAV[2], NAV[3], NAV[8]];

function BalanceCard({ onNavigate }: { onNavigate?: () => void }) {
  const { data: user } = useMe();
  if (!user) return null;
  const low = user.balance < 100;
  return (
    <Link
      to="/app/billing"
      onClick={onNavigate}
      className="group relative block overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-nova-600/25 via-fuchsia-600/10 to-cyan-500/10 p-4 transition hover:border-nova-400/40"
    >
      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-nova-500/30 blur-2xl transition group-hover:scale-125" />
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Баланс</p>
      <motion.p key={user.balance} initial={{ opacity: 0.4, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-1 text-2xl font-extrabold">
        {sparks(user.balance)}
      </motion.p>
      <p className={clsx("mt-2 inline-flex items-center gap-1 text-xs font-semibold", low ? "text-amber-300" : "text-nova-300")}>
        <Plus className="h-3.5 w-3.5" /> {low ? "Пора пополнить" : "Пополнить"}
      </p>
    </Link>
  );
}

/** Unread support replies for the user; tickets waiting for an answer for admins. */
function useNavBadges(): Record<string, number> {
  const { data: user } = useMe();
  const { data: mine } = useUnreadTickets();
  const { data: staff } = useQuery({
    queryKey: ["admin", "ticket-counts"],
    queryFn: () => get<{ unread: number; open: number }>("/admin/tickets/counts"),
    enabled: user?.role === "admin",
    refetchInterval: 30_000,
  });
  return { "/app/support": mine?.count ?? 0, "/app/admin": staff?.unread ?? 0 };
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { data: user } = useMe();
  const { data: chats } = useChats();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const badges = useNavBadges();

  const logout = async () => {
    await post("/auth/logout");
    qc.clear();
    navigate("/");
  };

  return (
    <div className="flex h-full flex-col gap-5 p-4">
      <div className="flex items-center justify-between px-1 pt-1">
        <Logo to="/app" />
      </div>

      <button
        onClick={() => {
          navigate("/app/chat");
          onNavigate?.();
        }}
        className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-nova-500 to-fuchsia-500 py-2.5 text-sm font-semibold shadow-glow transition hover:brightness-110 active:scale-[.98]"
      >
        <Plus className="h-4 w-4" /> Новый чат
      </button>

      <nav className="space-y-0.5">
        {[...NAV, ...(user?.role === "admin" ? [{ to: "/app/admin", label: "Админка", icon: Shield }] : [])].map(
          ({ to, label, icon: Icon, end }: (typeof NAV)[number]) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onNavigate}
              className={({ isActive }) =>
                clsx(
                  "relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
                  isActive ? "text-white" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-xl border border-white/10 bg-white/[0.07]"
                      transition={{ type: "spring", damping: 30, stiffness: 400 }}
                    />
                  )}
                  <Icon className={clsx("relative h-4 w-4", isActive && "text-nova-300")} />
                  <span className="relative">{label}</span>
                  {!!badges[to] && (
                    <span className="relative ml-auto min-w-[1.25rem] rounded-full bg-fuchsia-500 px-1.5 text-center text-[10px] font-bold leading-5 text-white">
                      {badges[to]}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ),
        )}
      </nav>

      {!!chats?.length && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Недавние чаты</p>
          {chats.slice(0, 12).map((chat) => (
            <NavLink
              key={chat.id}
              to={`/app/chat/${chat.id}`}
              onClick={onNavigate}
              className={({ isActive }) =>
                clsx(
                  "block truncate rounded-lg px-3 py-1.5 text-[13px] transition",
                  isActive ? "bg-white/[0.06] text-white" : "text-zinc-400 hover:text-zinc-100",
                )
              }
            >
              {chat.title}
            </NavLink>
          ))}
        </div>
      )}
      {!chats?.length && <div className="flex-1" />}

      <BalanceCard onNavigate={onNavigate} />

      <div className="border-t border-white/[0.06] pt-3">
        <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Документы</p>
        <LegalLinks showIcons className="flex-col items-start gap-1 px-1 text-[11px] text-zinc-500" />
      </div>

      <div className="flex items-center gap-3 rounded-xl px-1">
        <Link to="/app/profile" onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-nova-400 to-aqua-400 text-sm font-bold text-ink-950">
            {user?.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{user?.name}</span>
            <span className="block truncate text-xs text-zinc-500">{user?.email}</span>
          </span>
        </Link>
        <button onClick={logout} className="rounded-lg p-2 text-zinc-500 transition hover:bg-white/5 hover:text-white" aria-label="Выйти">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function AppShell() {
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  const { data: user } = useMe();
  const isChat = location.pathname.startsWith("/app/chat");

  useEffect(() => setDrawer(false), [location.pathname]);

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <Aurora />

      <aside className="hidden w-[272px] shrink-0 border-r border-white/[0.06] bg-ink-900/60 backdrop-blur-xl lg:block">
        <Sidebar />
      </aside>

      <AnimatePresence>
        {drawer && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawer(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 w-[86%] max-w-[300px] border-r border-white/10 bg-ink-900 lg:hidden"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
            >
              <button className="absolute right-3 top-4 rounded-lg p-2 text-zinc-400" onClick={() => setDrawer(false)} aria-label="Закрыть меню">
                <X className="h-5 w-5" />
              </button>
              <Sidebar onNavigate={() => setDrawer(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-white/[0.06] bg-ink-950/70 px-4 py-3 backdrop-blur-xl lg:hidden">
          <button onClick={() => setDrawer(true)} className="rounded-lg p-1.5 text-zinc-300" aria-label="Открыть меню">
            <Menu className="h-5 w-5" />
          </button>
          <Logo to="/app" />
          <Link to="/app/billing" className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold">
            {user ? sparks(user.balance) : "—"}
          </Link>
        </header>

        <main className={clsx("min-h-0 flex-1", isChat ? "overflow-hidden" : "overflow-y-auto pb-24 lg:pb-0")}>
          <AnimatePresence mode="wait">
            <motion.div
              key={isChat ? "chat" : location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className={clsx(isChat ? "h-full" : "mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10")}
            >
              <Suspense fallback={<div className="grid h-64 place-items-center"><Spinner /></div>}>
                <Outlet />
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>

        {!isChat && (
          <nav className="fixed inset-x-3 bottom-3 z-30 flex justify-around rounded-2xl border border-white/10 bg-ink-850/90 px-1 py-1.5 shadow-2xl backdrop-blur-xl lg:hidden"
               style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}>
            {MOBILE_TABS.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  clsx("flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10px] font-semibold transition",
                    isActive ? "text-nova-300" : "text-zinc-500")
                }
              >
                <Icon className="h-5 w-5" />
                {label.split(" ")[0]}
              </NavLink>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
