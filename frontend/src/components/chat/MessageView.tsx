import clsx from "clsx";
import { motion } from "framer-motion";
import { Check, Copy, FileText } from "lucide-react";
import { useState } from "react";
import { LogoMark } from "@/components/Brand";
import { Markdown } from "@/components/chat/Markdown";
import { sparks } from "@/lib/format";
import type { Message, SourceRef } from "@/lib/types";

function Sources({ sources }: { sources: SourceRef[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!sources.length) return null;
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s) => (
          <button
            key={s.n}
            onClick={() => setOpen(open === s.n ? null : s.n)}
            className={clsx(
              "flex max-w-[16rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
              open === s.n ? "border-aqua-400/50 bg-aqua-400/15 text-aqua-200" : "border-white/10 bg-white/[0.04] text-zinc-400 hover:text-zinc-200",
            )}
          >
            <FileText className="h-3 w-3 shrink-0" />
            <span className="truncate">[{s.n}] {s.filename}</span>
          </button>
        ))}
      </div>
      {open !== null && (
        <motion.p
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs leading-5 text-zinc-400"
        >
          {sources.find((s) => s.n === open)?.excerpt}…
        </motion.p>
      )}
    </div>
  );
}

export function MessageView({ message, streaming }: { message: Pick<Message, "role" | "content" | "sources" | "cost" | "model_slug">; streaming?: boolean }) {
  const [copied, setCopied] = useState(false);

  if (message.role === "user") {
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
        <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-3xl rounded-br-lg bg-gradient-to-br from-nova-500/90 to-fuchsia-500/80 px-4 py-2.5 text-[15px] leading-6 text-white shadow-glow sm:max-w-[75%]">
          {message.content}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="group flex gap-3">
      <LogoMark className={clsx("mt-0.5 h-8 w-8 shrink-0", streaming && "animate-pulse")} />
      <div className="min-w-0 flex-1">
        {message.content ? (
          <>
            <Markdown>{message.content}</Markdown>
            {streaming && <span className="caret" />}
          </>
        ) : (
          <div className="flex h-7 items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="h-2 w-2 rounded-full bg-gradient-to-br from-nova-400 to-aqua-400"
                animate={{ y: [0, -5, 0], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
              />
            ))}
          </div>
        )}
        <Sources sources={message.sources ?? []} />
        {!streaming && message.content && (
          <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-500 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
            <button
              onClick={() => {
                navigator.clipboard.writeText(message.content);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="flex items-center gap-1 hover:text-zinc-200"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Скопировано" : "Копировать"}
            </button>
            {message.model_slug && <span>{message.model_slug}</span>}
            {message.cost > 0 && <span>−{sparks(message.cost)}</span>}
          </div>
        )}
      </div>
    </motion.div>
  );
}
