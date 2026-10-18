import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Check, Copy, Gift, Send, Share2, UserPlus, Wallet } from "lucide-react";
import { useState } from "react";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { get } from "@/lib/api";
import { number, relative, sparks } from "@/lib/format";

type Referral = {
  code: string;
  link: string;
  signup_bonus: number;
  percent: number;
  invited: number;
  paying: number;
  earned: number;
  friends: { name: string; joined_at: string; paid: boolean; earned: number }[];
};

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="label">{label}</p>
      <div className="flex gap-2">
        <input readOnly value={value} onFocus={(e) => e.target.select()} className="field font-mono text-sm" />
        <button
          onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl bg-white/[0.06] transition hover:bg-white/10"
          aria-label={`Скопировать: ${label}`}
        >
          {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

export default function Referral() {
  const { data } = useQuery({ queryKey: ["referral"], queryFn: () => get<Referral>("/referral") });
  if (!data) return <div className="grid h-64 place-items-center"><Spinner /></div>;

  const text = `Попробуй Nova AI — GPT-6, свои AI-агенты и контент за минуты. По моей ссылке +${data.signup_bonus} ✦ в подарок:`;
  const share = () => navigator.share?.({ title: "Nova AI", text, url: data.link });

  return (
    <div>
      <PageHeader title="Пригласить друга" subtitle="Делитесь ссылкой — друзья получают бонус, а вы зарабатываете искры с каждой их оплаты." />

      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-pink-600/30 via-nova-600/25 to-cyan-500/15 p-6 sm:p-8">
        <motion.div className="absolute -right-10 -top-10 text-[9rem] leading-none opacity-20" animate={{ rotate: [0, 10, -6, 0], y: [0, -8, 0] }} transition={{ duration: 7, repeat: Infinity }}>🎁</motion.div>
        <div className="relative grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end">
          <div>
            <h2 className="text-2xl font-extrabold sm:text-3xl">{data.percent}% с каждой оплаты друга</h2>
            <p className="mt-2 max-w-md text-zinc-200">Навсегда, искрами на ваш баланс. А друг сразу получает +{data.signup_bonus} ✦ к приветственным.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <a href={`https://t.me/share/url?url=${encodeURIComponent(data.link)}&text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-[#229ED9] px-4 py-2.5 text-sm font-semibold transition hover:brightness-110">
                <Send className="h-4 w-4" /> Telegram
              </a>
              <a href={`https://vk.com/share.php?url=${encodeURIComponent(data.link)}`} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-[#0077FF] px-4 py-2.5 text-sm font-semibold transition hover:brightness-110">
                VK
              </a>
              {"share" in navigator && (
                <button onClick={share} className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold transition hover:bg-white/15">
                  <Share2 className="h-4 w-4" /> Поделиться
                </button>
              )}
            </div>
          </div>
          <div className="space-y-3 rounded-2xl bg-ink-950/50 p-4 backdrop-blur">
            <CopyField label="Ваша ссылка" value={data.link} />
            <CopyField label="Код приглашения" value={data.code} />
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        {[
          { icon: UserPlus, label: "Приглашено", value: number(data.invited) },
          { icon: Wallet, label: "Оплатили", value: number(data.paying) },
          { icon: Gift, label: "Заработано", value: sparks(data.earned) },
        ].map(({ icon: Icon, label, value }) => (
          <Card key={label} className="p-4 sm:p-5">
            <Icon className="h-5 w-5 text-nova-300" />
            <p className="mt-3 text-xl font-extrabold sm:text-2xl">{value}</p>
            <p className="text-xs text-zinc-400 sm:text-sm">{label}</p>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card className="p-5 sm:p-6">
          <h3 className="font-bold">Как это работает</h3>
          <ol className="mt-4 space-y-4">
            {[
              ["Отправьте ссылку", "Другу, в чат, в свой канал или в соцсети."],
              ["Друг регистрируется", `И сразу получает +${data.signup_bonus} ✦ к приветственному балансу.`],
              ["Вы получаете искры", `${data.percent}% от каждой оплаты друга — без ограничений по сроку.`],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-nova-500 to-fuchsia-500 text-sm font-bold">{i + 1}</span>
                <span><span className="block font-semibold">{t}</span><span className="text-sm text-zinc-400">{d}</span></span>
              </li>
            ))}
          </ol>
        </Card>
        <Card className="p-5 sm:p-6">
          <h3 className="font-bold">Ваши друзья</h3>
          <div className="mt-3 divide-y divide-white/[0.05]">
            {data.friends.map((f, i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] font-bold">{f.name.slice(0, 1)}</span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold">{f.name}</span>
                  <span className="text-xs text-zinc-500">{relative(f.joined_at)}</span>
                </span>
                {f.paid ? <Badge tone="green">оплатил</Badge> : <Badge tone="zinc">зарегистрирован</Badge>}
                <span className="w-20 text-right text-sm font-semibold text-emerald-300">{f.earned ? `+${sparks(f.earned)}` : ""}</span>
              </div>
            ))}
            {!data.friends.length && <p className="py-8 text-center text-sm text-zinc-500">Пока никого — поделитесь ссылкой ✦</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
