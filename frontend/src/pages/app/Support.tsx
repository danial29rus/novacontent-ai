import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LifeBuoy, Plus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { TicketRow, TicketThread, type Ticket, type TicketMessage } from "@/components/Ticket";
import { Button, Card, EmptyState, Field, Modal, PageHeader, Spinner } from "@/components/ui";
import { get, post } from "@/lib/api";

export const useUnreadTickets = () =>
  useQuery({ queryKey: ["tickets", "unread"], queryFn: () => get<{ count: number }>("/tickets/unread"), refetchInterval: 30_000 });

function NewTicket({ onDone }: { onDone: (id: number) => void }) {
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const t = await post<Ticket>("/tickets", { subject: f.get("subject"), message: f.get("message") });
      toast.success("Обращение создано — ответим здесь же");
      onDone(t.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Тема"><input name="subject" required minLength={3} maxLength={120} className="field" placeholder="Не проходит оплата" /></Field>
      <Field label="Сообщение" hint="Опишите, что произошло и что вы ожидали. Ответ придёт сюда, в раздел «Поддержка».">
        <textarea name="message" required minLength={2} maxLength={5000} rows={6} className="field resize-y" />
      </Field>
      <Button type="submit" loading={busy} className="w-full">Отправить</Button>
    </form>
  );
}

export default function Support() {
  const { ticketId } = useParams();
  const id = ticketId ? Number(ticketId) : null;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const { data: tickets, isLoading } = useQuery({ queryKey: ["tickets"], queryFn: () => get<Ticket[]>("/tickets"), refetchInterval: 30_000 });
  const { data: detail } = useQuery({
    queryKey: ["ticket", id],
    queryFn: () => get<{ ticket: Ticket; messages: TicketMessage[] }>(`/tickets/${id}`),
    enabled: id !== null,
    refetchInterval: 15_000,
  });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["ticket", id] });
    qc.invalidateQueries({ queryKey: ["tickets"] });
  };
  // Opening a ticket marks it read on the server; keep the list and the menu badge in sync.
  const openedUnread = !!detail && !!tickets?.find((t) => t.id === id)?.unread;
  useEffect(() => {
    if (openedUnread) qc.invalidateQueries({ queryKey: ["tickets"] });
  }, [openedUnread, qc]);

  const list = (
    <div className="space-y-2">
      {tickets?.map((t) => <TicketRow key={t.id} t={t} active={t.id === id} onClick={() => navigate(`/app/support/${t.id}`)} />)}
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Поддержка"
        subtitle="Задайте вопрос — ответим прямо здесь. Обращение можно закрыть, когда вопрос решён."
        action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Новое обращение</Button>}
      />

      {isLoading && <div className="grid h-40 place-items-center"><Spinner /></div>}
      {tickets && !tickets.length && (
        <EmptyState icon={<LifeBuoy className="h-6 w-6" />} title="Обращений пока нет" text="Если что-то не работает или есть вопрос — напишите нам."
          action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Написать в поддержку</Button>} />
      )}

      {!!tickets?.length && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
          <div className={id !== null ? "hidden lg:block" : ""}>{list}</div>
          {id !== null ? (
            <Card className="flex h-[calc(100dvh-14rem)] min-h-[420px] flex-col p-4 sm:p-6">
              <button onClick={() => navigate("/app/support")} className="mb-3 flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white lg:hidden">
                <ArrowLeft className="h-4 w-4" /> Все обращения
              </button>
              {detail ? (
                <TicketThread
                  ticket={detail.ticket}
                  messages={detail.messages}
                  onSend={async (body) => { await post(`/tickets/${id}/messages`, { body }); await refresh(); }}
                  onClose={async () => { await post(`/tickets/${id}/close`); await refresh(); toast.success("Обращение закрыто"); }}
                  onReopen={async () => { await post(`/tickets/${id}/reopen`); await refresh(); }}
                />
              ) : <div className="grid flex-1 place-items-center"><Spinner /></div>}
            </Card>
          ) : (
            <Card className="hidden place-items-center p-10 text-center text-sm text-zinc-500 lg:grid">Выберите обращение слева</Card>
          )}
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Новое обращение" wide>
        <NewTicket onDone={(tid) => { setCreating(false); qc.invalidateQueries({ queryKey: ["tickets"] }); navigate(`/app/support/${tid}`); }} />
      </Modal>
    </div>
  );
}
