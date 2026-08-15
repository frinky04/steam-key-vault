"use client";

import { useActionState, useState } from "react";
import { acceptInviteAction, loginAction, recoveryLoginAction, setupAction, type FormState } from "@/lib/actions/auth";

function Submit({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" className="btn btn-primary w-full justify-center" disabled={pending}>
      {pending ? "…" : children}
    </button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"password" | "recovery">("password");
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  const [rstate, raction, rpending] = useActionState<FormState, FormData>(recoveryLoginAction, {});

  if (mode === "recovery") {
    return (
      <form action={raction} className="space-y-3">
        <p className="text-sm text-muted">
          Sign in with the server&apos;s <span className="font-mono">ADMIN_PASSWORD</span>. This signs you in as the first
          admin — use it only if you are locked out.
        </p>
        <div>
          <label className="label" htmlFor="rpassword">Recovery password</label>
          <input id="rpassword" name="password" type="password" autoFocus required className="input" />
        </div>
        {rstate.error && <p className="text-sm text-danger">{rstate.error}</p>}
        <Submit pending={rpending}>Sign in</Submit>
        <button type="button" className="w-full text-center text-xs text-muted hover:text-foreground" onClick={() => setMode("password")}>
          ← Back to normal sign in
        </button>
      </form>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoFocus autoComplete="username" required className="input" defaultValue={state.values?.email ?? ""} />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      <Submit pending={pending}>Sign in</Submit>
      <button type="button" className="w-full text-center text-xs text-muted hover:text-foreground" onClick={() => setMode("recovery")}>
        Locked out? Use the recovery password
      </button>
    </form>
  );
}

export function SetupForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(setupAction, {});
  return (
    <form action={action} className="space-y-3">
      <div>
        <label className="label" htmlFor="setupCode">Setup code</label>
        <input id="setupCode" name="setupCode" type="password" required className="input" />
        <p className="mt-1 text-xs text-muted">
          The <span className="font-mono">ADMIN_PASSWORD</span> environment variable. It stays as a recovery password afterwards.
        </p>
      </div>
      <div className="mobile-form-grid grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="name">Your name</label>
          <input id="name" name="name" required className="input" defaultValue={state.values?.name ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required className="input" autoComplete="username" defaultValue={state.values?.email ?? ""} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="password">Choose a password</label>
        <input id="password" name="password" type="password" required minLength={10} className="input" autoComplete="new-password" />
      </div>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      <Submit pending={pending}>Create admin account</Submit>
    </form>
  );
}

export function AcceptInviteForm({ token, isReset }: { token: string; isReset: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(acceptInviteAction, {});
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const mismatch = pw2.length > 0 && pw !== pw2;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="label" htmlFor="password">{isReset ? "New password" : "Choose a password"}</label>
        <input id="password" name="password" type="password" required minLength={10} className="input" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="password2">Repeat password</label>
        <input id="password2" type="password" required className="input" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        {mismatch && <p className="mt-1 text-xs text-danger">Passwords do not match.</p>}
      </div>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      <Submit pending={pending || mismatch}>{isReset ? "Set password & sign in" : "Create account & sign in"}</Submit>
    </form>
  );
}
