import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { forwardRef, useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "icon";
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold",
        "transition-all duration-200 active:scale-[.97] disabled:pointer-events-none disabled:opacity-50",
        {
          "bg-gradient-to-r from-nova-500 to-fuchsia-500 text-white shadow-glow hover:brightness-110":
            variant === "primary",
          "border border-white/10 bg-white/[0.04] text-zinc-100 hover:border-white/20 hover:bg-white/[0.08]":
            variant === "secondary",
          "text-zinc-300 hover:bg-white/[0.06] hover:text-white": variant === "ghost",
          "border border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20": variant === "danger",
          "h-8 px-3 text-xs": size === "sm",
          "h-10 px-4 text-sm": size === "md",
          "h-12 px-6 text-base": size === "lg",
          "h-9 w-9 p-0": size === "icon",
        },
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
});

export function Card({ className, children, hover }: { className?: string; children: ReactNode; hover?: boolean }) {
  return (
    <div
      className={clsx(
        "glass rounded-2xl",
        hover && "transition duration-300 hover:-translate-y-0.5 hover:border-nova-400/30 hover:bg-white/[0.05]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Badge({ children, tone = "nova" }: { children: ReactNode; tone?: "nova" | "aqua" | "green" | "amber" | "rose" | "zinc" }) {
  const tones = {
    nova: "bg-nova-500/15 text-nova-300 ring-nova-400/25",
    aqua: "bg-aqua-400/10 text-aqua-300 ring-aqua-400/25",
    green: "bg-emerald-500/10 text-emerald-300 ring-emerald-400/25",
    amber: "bg-amber-500/10 text-amber-300 ring-amber-400/25",
    rose: "bg-rose-500/10 text-rose-300 ring-rose-400/25",
    zinc: "bg-white/5 text-zinc-300 ring-white/10",
  };
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1", tones[tone])}>
      {children}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal
            aria-label={title}
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
            className={clsx(
              "max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-white/10 bg-ink-850 p-5 shadow-2xl sm:rounded-3xl sm:p-6",
              wide ? "sm:max-w-2xl" : "sm:max-w-md",
            )}
          >
            <div className="mb-5 flex items-center justify-between gap-4">
              <h2 className="text-lg font-bold">{title}</h2>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть">
                <X className="h-4 w-4" />
              </Button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-zinc-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center rounded-3xl border border-dashed border-white/10 px-6 py-14 text-center"
    >
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-nova-500/20 to-aqua-400/10 text-nova-300 ring-1 ring-white/10">
        {icon}
      </div>
      <h3 className="font-bold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-zinc-400">{text}</p>
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("h-5 w-5 animate-spin text-nova-400", className)} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

/** Staggered fade-up for lists and grids. */
export const listMotion = {
  container: { hidden: {}, show: { transition: { staggerChildren: 0.05 } } },
  item: { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } } },
} as const;
