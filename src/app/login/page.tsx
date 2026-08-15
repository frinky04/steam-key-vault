import { redirect } from "next/navigation";
import { getCurrentUser, homeFor, needsSetup } from "@/lib/auth";
import { LoginForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/auth-shell";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));
  if (await needsSetup()) redirect("/setup");
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  return (
    <AuthShell subtitle="Sign in to continue.">
      <LoginForm next={next} />
    </AuthShell>
  );
}
