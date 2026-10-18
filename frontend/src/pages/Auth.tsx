import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight, Gift } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Aurora, Logo } from "@/components/Brand";
import { Button, Field } from "@/components/ui";
import { post } from "@/lib/api";
import { clearAttribution, readAttribution } from "@/lib/attribution";
import type { User } from "@/lib/types";

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="relative grid min-h-[100dvh] place-items-center px-4 py-10">
      <Aurora intense />
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md"
      >
        <div className="mb-8 flex justify-center"><Logo /></div>
        <div className="glass rounded-3xl p-6 sm:p-8">
          <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-zinc-400">{subtitle}</p>
          <div className="mt-7">{children}</div>
        </div>
        <p className="mt-6 text-center text-sm text-zinc-400">{footer}</p>
      </motion.div>
    </div>
  );
}

function useAuthSubmit(path: string) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const submit = async (body: unknown) => {
    setLoading(true);
    try {
      const user = await post<User & { notices?: string[] }>(path, body);
      user.notices?.forEach((n) => (n.startsWith("+") || n.includes(": +") ? toast.success(n) : toast(n)));
      if (user.notices) clearAttribution();
      qc.setQueryData(["me"], user);
      navigate((location.state as { from?: string } | null)?.from ?? "/app", { replace: true });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return { submit, loading };
}

export function Login() {
  const { submit, loading } = useAuthSubmit("/auth/login");
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    submit({ email: form.get("email"), password: form.get("password") });
  };
  return (
    <AuthLayout
      title="С возвращением"
      subtitle="Войдите, чтобы продолжить работу"
      footer={<>Нет аккаунта? <Link to="/register" className="font-semibold text-nova-300 hover:text-nova-300/80">Зарегистрироваться</Link></>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email"><input name="email" type="email" required autoComplete="email" className="field" placeholder="you@company.ru" /></Field>
        <Field label="Пароль"><input name="password" type="password" required autoComplete="current-password" className="field" /></Field>
        <Button type="submit" loading={loading} className="w-full" size="lg">Войти <ArrowRight className="h-4 w-4" /></Button>
        <Link to="/forgot-password" className="block text-center text-sm text-zinc-400 hover:text-white">Забыли пароль?</Link>
      </form>
    </AuthLayout>
  );
}

export function Register() {
  const { submit, loading } = useAuthSubmit("/auth/register");
  const attribution = readAttribution();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    submit({
      name: form.get("name"), email: form.get("email"), password: form.get("password"), terms: form.get("terms") === "on",
      promo: String(form.get("promo") ?? "").trim() || null, ref: attribution.ref ?? null,
      utm_source: attribution.utm_source ?? null, utm_campaign: attribution.utm_campaign ?? null,
    });
  };
  return (
    <AuthLayout
      title="Создайте аккаунт"
      subtitle="Займёт 30 секунд, карта не нужна"
      footer={<>Уже есть аккаунт? <Link to="/login" className="font-semibold text-nova-300 hover:text-nova-300/80">Войти</Link></>}
    >
      <div className="mb-5 flex items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.07] px-4 py-3 text-sm text-emerald-200">
        <Gift className="h-5 w-5 shrink-0" />
        {attribution.ref ? "Вас пригласил друг: 50 ✦ на старт + 50 ✦ бонусом" : "50 ✦ на старт — в подарок"}
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Имя"><input name="name" required minLength={2} maxLength={80} autoComplete="name" className="field" placeholder="Анна" /></Field>
        <Field label="Email"><input name="email" type="email" required autoComplete="email" className="field" placeholder="you@company.ru" /></Field>
        <Field label="Пароль" hint="Минимум 10 символов">
          <input name="password" type="password" required minLength={10} autoComplete="new-password" className="field" />
        </Field>
        <Field label="Промокод · если есть">
          <input name="promo" defaultValue={attribution.promo ?? ""} className="field uppercase" placeholder="WELCOME" />
        </Field>
        <label className="flex items-start gap-3 text-sm text-zinc-400">
          <input name="terms" type="checkbox" required className="mt-0.5 h-4 w-4 rounded accent-nova-500" />
          <span>Принимаю <Link to="/legal/terms" target="_blank" className="text-nova-300 underline">соглашение</Link>, <Link to="/legal/offer" target="_blank" className="text-nova-300 underline">оферту</Link> и <Link to="/legal/privacy" target="_blank" className="text-nova-300 underline">политику конфиденциальности</Link></span>
        </label>
        <Button type="submit" loading={loading} className="w-full" size="lg">Создать аккаунт <ArrowRight className="h-4 w-4" /></Button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    try {
      await post("/auth/forgot", { email: new FormData(e.currentTarget).get("email") });
      setSent(true);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthLayout title="Восстановление пароля" subtitle="Пришлём ссылку для смены пароля на почту"
      footer={<Link to="/login" className="font-semibold text-nova-300">Вернуться ко входу</Link>}>
      {sent ? (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.07] p-4 text-sm text-emerald-200">
          Если аккаунт с этим email есть, письмо уже в пути. Проверьте «Входящие» и «Спам». Ссылка действует 1 час.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email"><input name="email" type="email" required autoComplete="email" className="field" /></Field>
          <Button type="submit" loading={loading} className="w-full" size="lg">Отправить ссылку</Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPassword() {
  const navigate = useNavigate();
  const token = new URLSearchParams(useLocation().search).get("token") ?? "";
  const [loading, setLoading] = useState(false);
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("repeat")) return toast.error("Пароли не совпадают");
    setLoading(true);
    try {
      await post("/auth/reset", { token, password: f.get("password") });
      toast.success("Пароль изменён — войдите с новым паролем");
      navigate("/login", { replace: true });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthLayout title="Новый пароль" subtitle="Придумайте пароль от 10 символов"
      footer={<Link to="/forgot-password" className="font-semibold text-nova-300">Запросить ссылку заново</Link>}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Новый пароль"><input name="password" type="password" required minLength={10} autoComplete="new-password" className="field" /></Field>
        <Field label="Повторите пароль"><input name="repeat" type="password" required minLength={10} autoComplete="new-password" className="field" /></Field>
        <Button type="submit" loading={loading} disabled={!token} className="w-full" size="lg">Сохранить пароль</Button>
      </form>
    </AuthLayout>
  );
}
