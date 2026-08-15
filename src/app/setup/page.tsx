import { redirect } from "next/navigation";
import { needsSetup } from "@/lib/auth";
import { SetupForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/auth-shell";

export const metadata = { title: "Setup" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!(await needsSetup())) redirect("/login");
  return (
    <AuthShell subtitle="First run — create the admin account.">
      <SetupForm />
    </AuthShell>
  );
}
