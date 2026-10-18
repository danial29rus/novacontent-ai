import clsx from "clsx";
import { useId } from "react";
import { Link } from "react-router-dom";

export function LogoMark({ className }: { className?: string }) {
  // Unique per instance: a shared id resolves to the first <defs>, which may sit in a hidden subtree.
  const gradient = useId();
  return (
    <svg viewBox="0 0 64 64" className={clsx("h-8 w-8", className)} aria-hidden>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset=".55" stopColor="#e879f9" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="#11111d" />
      <rect x=".5" y=".5" width="63" height="63" rx="17.5" fill="none" stroke="rgba(255,255,255,.08)" />
      <path d="M32 11c2 12 9 19 21 21-12 2-19 9-21 21-2-12-9-19-21-21 12-2 19-9 21-21z" fill={`url(#${gradient})`} />
    </svg>
  );
}

export function Logo({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5 font-extrabold tracking-tight">
      <LogoMark />
      <span className="text-lg">
        nova<span className="text-gradient">ai</span>
      </span>
    </Link>
  );
}

/** Slow-drifting color fields behind the app. Pure CSS, GPU-friendly. */
export function Aurora({ intense }: { intense?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className={clsx(
          "absolute -left-[20%] -top-[30%] h-[70vmax] w-[70vmax] animate-drift rounded-full blur-[120px]",
          intense ? "bg-nova-600/30" : "bg-nova-600/15",
        )}
      />
      <div
        className={clsx(
          "absolute -right-[25%] top-[10%] h-[60vmax] w-[60vmax] animate-drift rounded-full blur-[130px] [animation-delay:-6s]",
          intense ? "bg-fuchsia-600/20" : "bg-fuchsia-600/10",
        )}
      />
      <div
        className={clsx(
          "absolute -bottom-[35%] left-[20%] h-[55vmax] w-[55vmax] animate-drift rounded-full blur-[120px] [animation-delay:-12s]",
          intense ? "bg-cyan-500/20" : "bg-cyan-500/[0.08]",
        )}
      />
      <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,.06)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]" />
    </div>
  );
}

const AGENT_COLORS: Record<string, string> = {
  violet: "from-violet-500/30 to-fuchsia-500/10 ring-violet-400/30",
  cyan: "from-cyan-500/30 to-sky-500/10 ring-cyan-400/30",
  emerald: "from-emerald-500/30 to-teal-500/10 ring-emerald-400/30",
  amber: "from-amber-500/30 to-orange-500/10 ring-amber-400/30",
  rose: "from-rose-500/30 to-pink-500/10 ring-rose-400/30",
};

export const AGENT_COLOR_KEYS = Object.keys(AGENT_COLORS);

export function AgentAvatar({ emoji, color, size = "md" }: { emoji: string; color: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      className={clsx(
        "grid shrink-0 place-items-center rounded-2xl bg-gradient-to-br ring-1",
        AGENT_COLORS[color] ?? AGENT_COLORS.violet,
        { "h-8 w-8 text-base": size === "sm", "h-11 w-11 text-xl": size === "md", "h-14 w-14 text-2xl": size === "lg" },
      )}
    >
      {emoji}
    </span>
  );
}

export function ProviderDot({ provider }: { provider: string }) {
  return (
    <span
      className={clsx(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        provider === "anthropic" ? "bg-orange-400 shadow-[0_0_10px_#fb923c]" : "bg-emerald-400 shadow-[0_0_10px_#34d399]",
      )}
    />
  );
}
