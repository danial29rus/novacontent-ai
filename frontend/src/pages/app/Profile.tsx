import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button, Card, Field, PageHeader } from "@/components/ui";
import { useMe } from "@/hooks/data";
import { patch, post } from "@/lib/api";
import { date } from "@/lib/format";
import type { User } from "@/lib/types";

function useAction() {
  const [loading, setLoading] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setLoading(true);
    try {
      await fn();
      toast.success(ok);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setLoading(false);
    }
  };
  return { loading, run };
}

export default function Profile() {
  const { data: user } = useMe();
  const qc = useQueryClient();
  const profile = useAction();
  const password = useAction();

  const saveProfile = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = new FormData(e.currentTarget).get("name");
    profile.run(async () => qc.setQueryData(["me"], await patch<User>("/me", { name })), "Профиль сохранён");
  };
  const changePassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    if (await password.run(() => post("/me/password", { current: f.get("current"), new: f.get("new") }), "Пароль изменён, другие устройства разлогинены")) form.reset();
  };

  return (
    <div>
      <PageHeader title="Профиль" subtitle={user ? `${user.email} · с нами с ${date(user.created_at)}` : undefined} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <h2 className="mb-4 font-bold">Личные данные</h2>
          <form onSubmit={saveProfile} className="space-y-4">
            <Field label="Имя"><input name="name" defaultValue={user?.name} required minLength={2} className="field" /></Field>
            <Field label="Email"><input value={user?.email ?? ""} disabled className="field opacity-60" /></Field>
            <Button type="submit" loading={profile.loading}>Сохранить</Button>
          </form>
        </Card>
        <Card className="p-5 sm:p-6">
          <h2 className="mb-4 font-bold">Смена пароля</h2>
          <form onSubmit={changePassword} className="space-y-4">
            <Field label="Текущий пароль"><input name="current" type="password" required autoComplete="current-password" className="field" /></Field>
            <Field label="Новый пароль" hint="Минимум 10 символов"><input name="new" type="password" required minLength={10} autoComplete="new-password" className="field" /></Field>
            <Button type="submit" loading={password.loading}>Изменить пароль</Button>
          </form>
        </Card>
        <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6 lg:col-span-2">
          <div className="flex-1">
            <h2 className="font-bold">Поддержка</h2>
            <p className="mt-1 text-sm text-zinc-400">Вопросы и проблемы — в разделе «Поддержка»: там переписка с нами и статус каждого обращения.</p>
          </div>
          <Link to="/app/support"><Button>Открыть поддержку</Button></Link>
        </Card>
      </div>
    </div>
  );
}
