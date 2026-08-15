"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@/db/schema";
import { deleteUser, inviteUser, resetUserPassword, setUserDisabled, updateUser } from "@/lib/actions/users";
import { Modal } from "./modal";
import { CopyButton } from "./copy-button";
import { LocalTime } from "./local-time";

export type UserRow = {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  hasPassword: boolean;
  inviteExpiresAt: string | null;
  dailyLinkLimit: number;
  batchLinkLimit: number;
  disabledAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  linksTotal: number;
  linksToday: number;
};

export function UsersManager({ users, meId, now }: { users: UserRow[]; meId: number; now: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<{ url: string; title: string } | null>(null);
  const [edit, setEdit] = useState<UserRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  // invite form
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("dev");
  const [daily, setDaily] = useState("20");
  const [batch, setBatch] = useState("10");

  function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await inviteUser({ email, name, role, limits: { dailyLinkLimit: Number(daily), batchLinkLimit: Number(batch) } });
      if (!r.ok) return setError(r.error);
      setInviteOpen(false);
      setInviteUrl({ url: r.data!.url, title: `Invite link for ${name}` });
      setEmail(""); setName(""); setRole("dev");
      router.refresh();
    });
  }

  function reset(u: UserRow) {
    if (!confirm(`Generate a new ${u.hasPassword ? "password-reset" : "invite"} link for ${u.name}? Their current sessions end.`)) return;
    start(async () => {
      const r = await resetUserPassword(u.id);
      if (!r.ok) return alert(r.error);
      setInviteUrl({ url: r.data!.url, title: `${u.hasPassword ? "Reset" : "Invite"} link for ${u.name}` });
      router.refresh();
    });
  }

  function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setError(null);
    start(async () => {
      const r = await updateUser(edit.id, {
        name: edit.name,
        role: edit.role,
        limits: { dailyLinkLimit: edit.dailyLinkLimit, batchLinkLimit: edit.batchLinkLimit },
      });
      if (!r.ok) return setError(r.error);
      setEdit(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className="btn btn-primary w-full sm:w-auto" onClick={() => { setError(null); setInviteOpen(true); }}>
          + Invite user
        </button>
      </div>

      <div className="hidden overflow-x-auto rounded-md border border-border sm:block">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-2 py-2">User</th>
              <th className="px-2 py-2">Role</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Limits</th>
              <th className="px-2 py-2">Links</th>
              <th className="px-2 py-2">Last sign in</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const disabled = !!u.disabledAt;
              const inviteLive = !u.hasPassword && u.inviteExpiresAt && new Date(u.inviteExpiresAt).getTime() > now;
              return (
                <tr key={u.id} className={`border-t border-border ${disabled ? "opacity-60" : ""}`}>
                  <td className="px-2 py-1.5">
                    <div className="font-medium">{u.name}{u.id === meId && <span className="ml-1 text-xs text-muted">(you)</span>}</div>
                    <div className="text-xs text-muted">{u.email}</div>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`badge ${u.role === "admin" ? "bg-accent/15 text-accent" : "bg-muted/20 text-muted"}`}>{u.role}</span>
                  </td>
                  <td className="px-2 py-1.5 text-xs">
                    {disabled ? <span className="text-danger">Disabled</span> : u.hasPassword ? <span className="text-ok">Active</span> : inviteLive ? <span className="text-warn">Invited</span> : <span className="text-danger">Invite expired</span>}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-muted">
                    {u.role === "admin" ? "unlimited" : `${u.dailyLinkLimit} keys/day · ${u.batchLinkLimit}/batch`}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-muted">
                    {u.linksTotal} links · {u.linksToday} keys today
                  </td>
                  <td className="px-2 py-1.5 text-xs text-muted"><LocalTime value={u.lastLoginAt} /></td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    <button className="btn btn-sm" disabled={pending} onClick={() => { setError(null); setEdit(u); }}>Edit</button>{" "}
                    <button className="btn btn-sm" disabled={pending} onClick={() => reset(u)}>{u.hasPassword ? "Reset password" : "New invite"}</button>{" "}
                    {u.id !== meId && (
                      <>
                        <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => { const r = await setUserDisabled(u.id, !disabled); if (!r.ok) alert(r.error); router.refresh(); })}>
                          {disabled ? "Enable" : "Disable"}
                        </button>{" "}
                        <button className="btn btn-sm btn-danger" disabled={pending} onClick={() => { if (confirm(`Delete ${u.name}? Their links stay but lose the creator name.`)) start(async () => { const r = await deleteUser(u.id); if (!r.ok) alert(r.error); router.refresh(); }); }}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 sm:hidden">
        {users.map((u) => {
          const disabled = !!u.disabledAt;
          const inviteLive = !u.hasPassword && u.inviteExpiresAt && new Date(u.inviteExpiresAt).getTime() > now;
          return (
            <article key={u.id} className={`card space-y-3 ${disabled ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-medium">{u.name}{u.id === meId && <span className="ml-1 text-xs text-muted">(you)</span>}</h2>
                  <p className="truncate text-xs text-muted">{u.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`badge ${u.role === "admin" ? "bg-accent/15 text-accent" : "bg-muted/20 text-muted"}`}>{u.role}</span>
                  {disabled ? <span className="text-xs text-danger">Disabled</span> : u.hasPassword ? <span className="text-xs text-ok">Active</span> : inviteLive ? <span className="text-xs text-warn">Invited</span> : <span className="text-xs text-danger">Expired</span>}
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs">
                <div><dt className="text-muted">Allowance</dt><dd className="mt-0.5">{u.role === "admin" ? "Unlimited" : `${u.dailyLinkLimit}/day · ${u.batchLinkLimit}/batch`}</dd></div>
                <div><dt className="text-muted">Usage</dt><dd className="mt-0.5">{u.linksTotal} links · {u.linksToday} today</dd></div>
                <div className="col-span-2"><dt className="text-muted">Last sign in</dt><dd className="mt-0.5"><LocalTime value={u.lastLoginAt} /></dd></div>
              </dl>
              <div className="mobile-record-actions flex flex-wrap gap-2">
                <button className="btn btn-sm" disabled={pending} onClick={() => { setError(null); setEdit(u); }}>Edit</button>
                <button className="btn btn-sm" disabled={pending} onClick={() => reset(u)}>{u.hasPassword ? "Reset password" : "New invite"}</button>
                {u.id !== meId && <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => { const r = await setUserDisabled(u.id, !disabled); if (!r.ok) alert(r.error); router.refresh(); })}>{disabled ? "Enable" : "Disable"}</button>}
                {u.id !== meId && <button className="btn btn-sm btn-danger" disabled={pending} onClick={() => { if (confirm(`Delete ${u.name}? Their links stay but lose the creator name.`)) start(async () => { const r = await deleteUser(u.id); if (!r.ok) alert(r.error); router.refresh(); }); }}>Delete</button>}
              </div>
            </article>
          );
        })}
      </div>

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite user">
        <form onSubmit={invite} className="space-y-3">
          <div className="mobile-form-grid grid grid-cols-2 gap-3">
            <div>
              <label className="label">Name</label>
              <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              <option value="dev">Dev — send keys only</option>
              <option value="admin">Admin — full access</option>
            </select>
          </div>
          {role === "dev" && (
            <div className="mobile-form-grid grid grid-cols-2 gap-3">
              <div>
                <label className="label">Keys / day</label>
                <input className="input" type="number" min={0} value={daily} onChange={(e) => setDaily(e.target.value)} />
              </div>
              <div>
                <label className="label">Per batch</label>
                <input className="input" type="number" min={1} value={batch} onChange={(e) => setBatch(e.target.value)} />
              </div>
            </div>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <p className="text-xs text-muted">You will get a one-time invite link (valid 7 days) to send them however you like.</p>
          <div className="modal-actions flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setInviteOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={pending}>{pending ? "Creating…" : "Create invite"}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!inviteUrl} onClose={() => setInviteUrl(null)} title={inviteUrl?.title ?? ""}>
        {inviteUrl && (
          <div className="space-y-3">
            <p className="text-sm text-warn">Shown once. Send it to them privately — anyone with this link can set the account password.</p>
            <div className="rounded-md border border-border bg-background p-2 font-mono text-xs break-all">{inviteUrl.url}</div>
            <div className="modal-actions flex justify-end gap-2">
              <CopyButton text={inviteUrl.url} label="Copy link" className="btn" />
              <button className="btn btn-primary" onClick={() => setInviteUrl(null)}>Done</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `Edit ${edit.email}` : ""}>
        {edit && (
          <form onSubmit={saveEdit} className="space-y-3">
            <div>
              <label className="label">Name</label>
              <input className="input" required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Role</label>
              <select className="input" value={edit.role} disabled={edit.id === meId} onChange={(e) => setEdit({ ...edit, role: e.target.value as UserRole })}>
                <option value="dev">Dev</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            {edit.role === "dev" && (
              <div className="mobile-form-grid grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Keys / day</label>
                  <input className="input" type="number" min={0} value={edit.dailyLinkLimit} onChange={(e) => setEdit({ ...edit, dailyLinkLimit: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="label">Per batch</label>
                  <input className="input" type="number" min={1} value={edit.batchLinkLimit} onChange={(e) => setEdit({ ...edit, batchLinkLimit: Number(e.target.value) })} />
                </div>
              </div>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="modal-actions flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={pending}>Save</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
