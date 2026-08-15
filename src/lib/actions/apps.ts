"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { fetchSteamApp } from "@/lib/steam";
import { audit } from "@/lib/audit";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export async function lookupSteamApp(appId: number) {
  await requireAdmin();
  return fetchSteamApp(appId);
}

export async function createApp(input: {
  name: string;
  steamAppId?: number | null;
  headerImage?: string | null;
  notes?: string | null;
}): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  const steamAppId = input.steamAppId || null;
  try {
    const [row] = await db
      .insert(apps)
      .values({ name, steamAppId, headerImage: input.headerImage ?? null, notes: input.notes ?? null })
      .returning({ id: apps.id });
    await audit("app.create", { userId: admin.id, appId: row.id, details: { name, steamAppId } });
    revalidatePath("/");
    return { ok: true, data: { id: row.id } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("apps_steam_app_id_unique")) return { ok: false, error: "An app with that Steam App ID already exists." };
    return { ok: false, error: msg };
  }
}

export async function updateApp(
  id: number,
  input: { name: string; steamAppId?: number | null; headerImage?: string | null; notes?: string | null },
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  try {
    await db
      .update(apps)
      .set({ name, steamAppId: input.steamAppId || null, headerImage: input.headerImage ?? null, notes: input.notes ?? null })
      .where(eq(apps.id, id));
    await audit("app.update", { userId: admin.id, appId: id, details: { name } });
    revalidatePath("/");
    revalidatePath(`/apps/${id}`);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("apps_steam_app_id_unique")) return { ok: false, error: "An app with that Steam App ID already exists." };
    return { ok: false, error: msg };
  }
}

export async function refreshAppFromSteam(id: number): Promise<ActionResult> {
  await requireAdmin();
  const app = await db.query.apps.findFirst({ where: eq(apps.id, id) });
  if (!app?.steamAppId) return { ok: false, error: "App has no Steam App ID." };
  const info = await fetchSteamApp(app.steamAppId);
  if (!info) return { ok: false, error: "Steam returned no data for that App ID." };
  await db.update(apps).set({ name: info.name, headerImage: info.headerImage }).where(eq(apps.id, id));
  revalidatePath(`/apps/${id}`);
  revalidatePath("/");
  return { ok: true };
}

export async function deleteApp(id: number): Promise<void> {
  const admin = await requireAdmin();
  await db.delete(apps).where(eq(apps.id, id));
  await audit("app.delete", { userId: admin.id, details: { appId: id } });
  revalidatePath("/");
  redirect("/");
}
