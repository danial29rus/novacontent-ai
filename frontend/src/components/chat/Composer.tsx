import clsx from "clsx";
import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function Composer({
  onSend,
  onStop,
  busy,
  placeholder = "Спросите что угодно…",
  toolbar,
  autoFocus,
}: {
  onSend: (text: string) => void;
  onStop?: () => void;
  busy?: boolean;
  placeholder?: string;
  toolbar?: ReactNode;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [text]);

  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    onSend(value);
    setText("");
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-ink-900/85 p-2 shadow-2xl backdrop-blur-xl transition focus-within:border-nova-400/40 focus-within:shadow-glow">
      <textarea
        ref={ref}
        rows={1}
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        className="block max-h-60 w-full resize-none bg-transparent px-3 pb-2 pt-2.5 text-[15px] leading-6 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
      />
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">{toolbar}</div>
        {busy ? (
          <button
            onClick={onStop}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 text-white transition hover:bg-white/20"
            aria-label="Остановить"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!text.trim()}
            className={clsx(
              "grid h-9 w-9 shrink-0 place-items-center rounded-xl transition active:scale-95",
              text.trim() ? "bg-gradient-to-br from-nova-500 to-fuchsia-500 text-white shadow-glow" : "bg-white/[0.06] text-zinc-500",
            )}
            aria-label="Отправить"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
