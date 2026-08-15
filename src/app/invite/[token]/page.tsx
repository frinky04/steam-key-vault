import { inviteInfo } from "@/lib/actions/auth";
import { AcceptInviteForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/auth-shell";

export const metadata = { title: "Invite", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const info = await inviteInfo(token);
  if (!info.ok) {
    return (
      <AuthShell subtitle="Invite">
        <p className="text-sm text-danger">{info.error}</p>
      </AuthShell>
    );
  }
  return (
    <AuthShell subtitle={info.isReset ? `Reset the password for ${info.email}.` : `Hi ${info.name}! Set a password for ${info.email}.`}>
      <AcceptInviteForm token={token} isReset={info.isReset} />
    </AuthShell>
  );
}
