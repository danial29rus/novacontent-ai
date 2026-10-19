import clsx from "clsx";
import { motion } from "framer-motion";
import { ArrowUp, Headset, Lock, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge, Button } from "@/components/ui";
import { date, relative } from "@/lib/format";

export type TicketStatus = "open" | "answered" | "closed";

export type Ticket = {
  id: number;
  subject: string;
  status: TicketStatus;
  unread: boolean;
  closed_by: "user" | "staff" | null;
  created_at: string;
  updated_at: string;
  last_message: string;
  user_email?: string | null;
  user_name?: string | null;
  user_id?: number | null;
};

export type TicketMessage = { id: number; is_staff: boolean; is_event: boolean; body: string; author: string; created_at: string };

const STATUS: Record<TicketStatus, { label: string; staffLabel: string; tone: "amber" | "green" | "zinc" }> = {
  open: { label: "Ждёт ответа", staffLabel: "Ждёт ответа", tone: "amber" },
  answered: { label: "Есть ответ", staffLabel: "Отвечено", tone: "green" },
  closed: { label: "Закрыт", staffLabel: "Закрыт", tone: "zinc" },
};

export function StatusBadge({ status, staff }: { status: TicketStatus; staff?: boolean }) {
  const s = STATUS[status];
  return <Badge tone={s.tone}>{staff ? s.staffLabel : s.label}</Badge>;
}

export function TicketRow({ t, active, staff, onClick }: { t: Ticket; active?: boolean; staff?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "w-full rounded-2xl border px-4 py-3 text-left transition",
        active ? "border-nova-400/40 bg-nova-500/10" : "border-white/[0.06] bg-white/[0.02] hover:border-white/15",
      )}
    >
      <div className="flex items-center gap-2">
        {t.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-fuchsia-400 shadow-[0_0_8px_#e879f9]" aria-label="Новое" />}
        <span className={clsx("min-w-0 flex-1 truncate text-sm", t.unread ? "font-bold text-white" : "font-semibold")}>{t.subject}</span>
        <StatusBadge status={t.status} staff={staff} />
      </div>
      {staff && t.user_email && <p className="mt-0.5 truncate text-xs text-nova-300">{t.user_email}</p>}
      <p className="mt-1 truncate text-xs text-zinc-500">{t.last_message}</p>
      <p className="mt-1 text-[11px] text-zinc-600">#{t.id} · {relative(t.updated_at)}</p>
    </button>
  );
}

/** A support conversation. `staff` flips sides: the viewer's own messages are on the right. */
export function TicketThread({
  ticket,
  messages,
  staff,
  onSend,
  onClose,
  onReopen,
}: {
  ticket: Ticket;
  messages: TicketMessage[];
  staff?: boolean;
  onSend: (body: string) => Promise<void>;
  onClose: () => Promise<void>;
  onReopen: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [messages.length]);

  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onSend(text.trim());
      setText("");
    } finally {
      setBusy(false);
    }
  };

  const closed = ticket.status === "closed";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-start gap-3 border-b border-white/[0.06] pb-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">{ticket.subject}</h2>
          <p className="text-xs text-zinc-500">
            #{ticket.id} · создано {date(ticket.created_at)}
            {staff && ticket.user_email && <> · <span className="text-nova-300">{ticket.user_name} &lt;{ticket.user_email}&gt;</span></>}
          </p>
        </div>
        <StatusBadge status={ticket.status} staff={staff} />
        {closed ? (
          <Button size="sm" variant="secondary" onClick={onReopen}><RotateCcw className="h-3.5 w-3.5" /> Открыть снова</Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={onClose}><Lock className="h-3.5 w-3.5" /> Закрыть</Button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-5">
        {messages.map((m) => {
          if (m.is_event) {
            return (
              <p key={m.id} className="text-center text-xs text-zinc-500">
                {m.body} · {date(m.created_at)}
              </p>
            );
          }
          const mine = staff ? m.is_staff : !m.is_staff;
          return (
            <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={clsx("flex gap-2.5", mine && "flex-row-reverse")}>
              {m.is_staff && !mine && (
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-nova-500 to-aqua-400 text-ink-950">
                  <Headset className="h-4 w-4" />
                </span>
              )}
              <div className={clsx("max-w-[85%] sm:max-w-[75%]", mine && "text-right")}>
                <p className="mb-1 text-[11px] text-zinc-500">{m.author} · {date(m.created_at)}</p>
                <div
                  className={clsx(
                    "whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-left text-sm leading-6",
                    mine ? "rounded-tr-md bg-gradient-to-br from-nova-500/90 to-fuchsia-500/80 text-white"
                      : m.is_staff ? "rounded-tl-md border border-nova-400/20 bg-nova-500/[0.08] text-zinc-100"
                      : "rounded-tl-md border border-white/[0.08] bg-white/[0.04] text-zinc-200",
                  )}
                >
                  {m.body}
                </div>
              </div>
            </motion.div>
          );
        })}
        <div ref={bottom} />
      </div>

      <div className="border-t border-white/[0.06] pt-4">
        {closed && (
          <p className="mb-2 text-xs text-zinc-500">
            Обращение закрыто{ticket.closed_by === "staff" ? " поддержкой" : ""}. Новое сообщение откроет его снова.
          </p>
        )}
        <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-ink-900/80 p-2 focus-within:border-nova-400/40">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            maxLength={5000}
            placeholder={staff ? "Ответ пользователю…" : "Напишите сообщение…"}
            className="max-h-48 min-h-[2.5rem] flex-1 resize-y bg-transparent px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <Button onClick={send} loading={busy} disabled={!text.trim()} size="icon" aria-label="Отправить">
            {!busy && <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-600">Ctrl/⌘ + Enter — отправить</p>
      </div>
    </div>
  );
}
