import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Aurora, Logo } from "@/components/Brand";
import { get } from "@/lib/api";

export type PublicConfig = { support_email: string; public_url: string; payments_enabled: boolean; mail_enabled: boolean };
export const usePublicConfig = () =>
  useQuery({ queryKey: ["public-config"], queryFn: () => get<PublicConfig>("/public/config"), staleTime: Infinity });

// Fill these in before accepting payments: payment providers check them.
const OPERATOR = "[Наименование: ИП Фамилия И.О. / ООО «…»]";
const REQUISITES = "[ИНН …, ОГРН/ОГРНИП …, адрес …]";

type Doc = { title: string; sections: [string, string][] };

const docs = (email: string, site: string): Record<string, Doc> => ({
  terms: {
    title: "Пользовательское соглашение",
    sections: [
      ["1. Общие положения", `Сервис Nova AI (${site}) предоставляет доступ к инструментам на базе искусственного интеллекта: чатам с языковыми моделями, AI-агентам, базе знаний и генерации контента. Оператор сервиса — ${OPERATOR}, ${REQUISITES}. Регистрируясь, вы принимаете условия соглашения.`],
      ["2. Аккаунт", "Вы отвечаете за сохранность пароля и за действия в своём аккаунте. Один человек — один аккаунт; создание аккаунтов для получения бонусов запрещено."],
      ["3. Допустимое использование", "Запрещено использовать сервис для создания незаконного контента, спама, мошенничества, нарушения чужих прав, а также пытаться обойти ограничения сервиса или получить доступ к чужим данным. При нарушении аккаунт может быть заблокирован."],
      ["4. Результаты работы AI", "Ответы генерируются автоматически и могут содержать ошибки. Проверяйте важную информацию перед использованием. Права на созданный вами контент принадлежат вам в пределах, допускаемых законом."],
      ["5. Ответственность", "Сервис предоставляется «как есть». Оператор не отвечает за решения, принятые на основе ответов AI, и за временную недоступность сторонних моделей."],
      ["6. Связь", `По всем вопросам: ${email}.`],
    ],
  },
  offer: {
    title: "Публичная оферта",
    sections: [
      ["1. Предмет", `${OPERATOR} (${REQUISITES}) предлагает доступ к функциям сервиса Nova AI за внутреннюю валюту «Искры» (✦). Оплата пополнения означает акцепт оферты.`],
      ["2. Искры", "1 ✦ ≈ 1 ₽ при пополнении без бонуса. Искры списываются за сообщения в чате (по фактическому объёму запроса и ответа с учётом модели) и за услуги (по фиксированной цене, указанной до запуска). Искры не сгорают, не являются денежными средствами и не передаются другим пользователям."],
      ["3. Пополнение", "Пакеты и произвольная сумма от 500 ₽. Бонусные искры за пакет, промокод или приглашение друга начисляются дополнительно и возврату не подлежат."],
      ["4. Возврат", `Неиспользованный оплаченный остаток можно вернуть в течение 14 дней с момента оплаты, написав на ${email}. Возвращается сумма за вычетом стоимости уже израсходованных искр. Если ответ модели не был получен из-за технической ошибки, искры не списываются.`],
      ["5. Реферальная программа", "Пригласивший получает искры в размере процента от оплат приглашённых пользователей. Оператор вправе отменить начисления, полученные с нарушением правил."],
      ["6. Реквизиты и контакты", `${OPERATOR}, ${REQUISITES}. Email: ${email}.`],
    ],
  },
  privacy: {
    title: "Политика конфиденциальности",
    sections: [
      ["1. Какие данные мы собираем", "Имя, email, хэш пароля, история операций с балансом, ваши чаты, загруженные документы и материалы, технические данные о входах (браузер), источник перехода (UTM-метки, промокод, реферальная ссылка)."],
      ["2. Зачем", "Чтобы предоставлять сервис, вести баланс, отвечать на обращения, предотвращать злоупотребления и улучшать продукт."],
      ["3. Обработка запросов AI", "Тексты ваших запросов и фрагменты документов передаются провайдеру модели (OpenAI) только для формирования ответа. API-ключи хранятся на сервере и не передаются в браузер."],
      ["4. Доступ администрации", "Администраторы сервиса могут просматривать историю действий и содержимое чатов для поддержки пользователей, расследования нарушений и обеспечения работы сервиса."],
      ["5. Хранение и удаление", `Данные хранятся на серверах в РФ, пока действует аккаунт. Для удаления аккаунта и данных напишите на ${email}.`],
      ["6. Оператор", `${OPERATOR}, ${REQUISITES}. Email: ${email}.`],
    ],
  },
});

export const LEGAL_LINKS = [
  ["terms", "Соглашение"],
  ["offer", "Оферта"],
  ["privacy", "Конфиденциальность"],
] as const;

export default function Legal() {
  const { slug = "" } = useParams();
  const { data: config } = usePublicConfig();
  const email = config?.support_email ?? "support@24nova-ai.ru";
  const doc = docs(email, config?.public_url ?? "")[slug];
  if (!doc) return <Navigate to="/" replace />;

  return (
    <div className="relative min-h-screen">
      <Aurora />
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="mb-10 flex items-center justify-between"><Logo /><Link to="/" className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white"><ArrowLeft className="h-4 w-4" /> На главную</Link></div>
        <h1 className="text-3xl font-extrabold tracking-tight">{doc.title}</h1>
        <div className="mt-8 space-y-7">
          {doc.sections.map(([h, t]) => (
            <section key={h}>
              <h2 className="font-bold text-white">{h}</h2>
              <p className="mt-2 leading-7 text-zinc-300">{t}</p>
            </section>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap gap-4 border-t border-white/10 pt-6 text-sm text-zinc-500">
          {LEGAL_LINKS.map(([s, t]) => <Link key={s} to={`/legal/${s}`} className="hover:text-white">{t}</Link>)}
          <a href={`mailto:${email}`} className="ml-auto text-nova-300">{email}</a>
        </div>
      </div>
    </div>
  );
}
