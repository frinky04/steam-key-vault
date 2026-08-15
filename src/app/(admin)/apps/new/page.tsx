import { AppForm } from "@/components/app-form";

export const metadata = { title: "New app" };

export default function NewAppPage() {
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">New app</h1>
      <div className="card">
        <AppForm mode="create" />
      </div>
    </div>
  );
}
