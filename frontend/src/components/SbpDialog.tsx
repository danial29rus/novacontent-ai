import { CheckCircle2, ExternalLink, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { Button, Modal, Spinner } from "@/components/ui";
import { get } from "@/lib/api";
import { rub, sparks } from "@/lib/format";

export type SbpPayment = { id: number; amountKopeks: number; tokens: number; checkoutUrl: string | null };

type Poll = {
  status: "pending" | "succeeded" | "failed" | "canceled";
  balance: number;
  sbp: { status: "pending" | "available" | "expired" | "unavailable" | "retry"; url: string | null; expires_at: string | null } | null;
};

const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Shows the bank QR for an SBP payment and polls until it's paid. */
export function SbpDialog({ payment, onClose, onPaid }: {
  payment: SbpPayment | null;
  onClose: () => void;
  onPaid: (balance: number) => void;
}) {
  const [poll, setPoll] = useState<Poll | null>(null);
  const [slow, setSlow] = useState(false);  // no QR after 10 s: offer the checkout page meanwhile

  useEffect(() => {
    if (!payment) return;
    setPoll(null);
    setSlow(false);
    const slowTimer = window.setTimeout(() => setSlow(true), 10_000);
    let stopped = false;
    let timer = 0;
    let haveLink = false;  // once we have the link (or know there's none) only the status is polled
    let keepSbp: Poll["sbp"] = null;
    const tick = async () => {
      try {
        const res = await get<Poll>(`/billing/payments/${payment.id}/sbp?link=${!haveLink}`);
        if (stopped) return;
        // Stop asking for the link only once it's final: a usable URL, or PayHot said there is none.
        const final = res.sbp && ((res.sbp.status === "available" && res.sbp.url) || res.sbp.status === "unavailable" || res.sbp.status === "expired");
        if (final) {
          haveLink = true;
          keepSbp = res.sbp;
        }
        setPoll({ ...res, sbp: res.sbp ?? keepSbp });
        if (res.status === "succeeded") {
          onPaid(res.balance);
          return;
        }
        if (res.status !== "pending") return;
      } catch { /* retry */ }
      if (!stopped) timer = window.setTimeout(tick, 5000);
    };
    tick();
    return () => { stopped = true; window.clearTimeout(timer); window.clearTimeout(slowTimer); };
  }, [payment, onPaid]);

  const sbp = poll?.sbp;
  const link = sbp?.status === "available" ? sbp.url : null;

  let body;
  if (poll?.status === "succeeded") {
    body = (
      <div className="py-6 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-300" />
        <p className="mt-3 text-lg font-bold">Оплата прошла</p>
        <p className="mt-1 text-zinc-400">Зачислено {sparks(payment?.tokens ?? 0)}</p>
        <Button className="mt-5 w-full" onClick={onClose}>Готово</Button>
      </div>
    );
  } else if (poll && poll.status !== "pending") {
    body = (
      <div className="py-6 text-center">
        <p className="text-lg font-bold">Платёж не прошёл</p>
        <p className="mt-1 text-sm text-zinc-400">Деньги не списаны. Попробуйте ещё раз.</p>
        <Button className="mt-5 w-full" variant="ghost" onClick={onClose}>Закрыть</Button>
      </div>
    );
  } else if (sbp?.status === "expired") {
    body = (
      <div className="py-6 text-center">
        <p className="text-lg font-bold">Время на оплату истекло</p>
        <p className="mt-1 text-sm text-zinc-400">Если вы уже оплатили, искры зачислятся автоматически.</p>
        <Button className="mt-5 w-full" variant="ghost" onClick={onClose}>Закрыть</Button>
      </div>
    );
  } else {
    // Pending: QR on top (keeps trying to get it), the PayHot checkout button always below.
    const noQr = sbp?.status === "unavailable" || (sbp?.status === "available" && !sbp.url);
    let qr;
    if (link && isMobile()) {
      qr = (
        <a href={link}>
          <Button className="w-full" size="lg"><Smartphone className="h-4 w-4" /> Оплатить в приложении банка</Button>
        </a>
      );
    } else if (link) {
      qr = (
        <>
          <div className="mx-auto w-fit rounded-2xl bg-white p-4"><QRCodeSVG value={link} size={220} /></div>
          <p className="mt-4 text-sm text-zinc-400">Отсканируйте камерой телефона или в приложении банка</p>
        </>
      );
    } else if (noQr && payment?.checkoutUrl && !isMobile()) {
      // No direct bank link: QR of the payment page, opens SBP payment on the phone.
      qr = (
        <>
          <div className="mx-auto w-fit rounded-2xl bg-white p-4"><QRCodeSVG value={payment.checkoutUrl} size={220} /></div>
          <p className="mt-4 text-sm text-zinc-400">Отсканируйте камерой телефона — откроется оплата по СБП</p>
        </>
      );
    } else if (noQr) {
      qr = <p className="py-4 text-sm text-zinc-400">Нажмите кнопку ниже — откроется оплата по СБП.</p>;
    } else {
      qr = (
        <div className="grid place-items-center py-8">
          <Spinner className="h-8 w-8" />
          <p className="mt-3 text-sm text-zinc-400">{slow ? "Получаем QR-код, ещё пробуем…" : "Готовим QR-код…"}</p>
        </div>
      );
    }
    body = (
      <div className="text-center">
        {qr}
        {payment?.checkoutUrl && (
          <a href={payment.checkoutUrl} target="_blank" rel="noreferrer" className="mt-5 block">
            <Button className="w-full" size="lg" variant={link ? "secondary" : "primary"}>
              <ExternalLink className="h-4 w-4" /> Перейти к оплате
            </Button>
          </a>
        )}
        <WaitingLine />
      </div>
    );
  }

  return (
    <Modal open={!!payment} onClose={onClose} title={`Оплата по СБП · ${rub(payment?.amountKopeks ?? 0)}`}>
      {body}
    </Modal>
  );
}

function WaitingLine() {
  return (
    <p className="mt-5 flex items-center justify-center gap-2 text-xs text-zinc-500">
      <Spinner className="h-3.5 w-3.5" /> Ждём подтверждения от банка…
    </p>
  );
}
