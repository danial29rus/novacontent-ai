import { Card, PageHeader } from "@/components/ui";
import { StudioForm } from "@/components/StudioForm";

export default function Studio() {
  return (
    <div>
      <PageHeader title="Студия" subtitle="Быстрые генераторы контента. Результаты сохраняются в библиотеку." />
      <Card className="p-4 sm:p-6">
        <StudioForm />
      </Card>
    </div>
  );
}
