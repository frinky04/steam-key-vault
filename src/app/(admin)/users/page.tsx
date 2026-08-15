import { requireAdmin } from "@/lib/auth";
import { listUsers } from "@/lib/queries";
import { UsersManager } from "@/components/users-manager";

export const metadata = { title: "Users" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await requireAdmin();
  const users = await listUsers();
  const now = new Date().getTime();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Users</h1>
        <p className="text-sm text-muted">
          Admins can do everything. Devs get a simple <b>Send keys</b> page: they can create claim links (within their
          limits), see and revoke their own links, and report bad keys — they never see raw keys.
        </p>
      </div>
      <UsersManager
        meId={me.id}
        now={now}
        users={users.map((u) => ({
          ...u,
          inviteExpiresAt: u.inviteExpiresAt?.toISOString() ?? null,
          disabledAt: u.disabledAt?.toISOString() ?? null,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
