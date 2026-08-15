import "server-only";
import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { apps, auditLog, batches, claimLinks, keys, users, type KeyStatus } from "@/db/schema";

export type StatusCounts = Record<KeyStatus, number>;
const emptyCounts = (): StatusCounts => ({ available: 0, reserved: 0, claimed: 0, used: 0, invalid: 0 });

export async function listAppsWithCounts() {
  const rows = await db
    .select({
      id: apps.id,
      name: apps.name,
      steamAppId: apps.steamAppId,
      headerImage: apps.headerImage,
      createdAt: apps.createdAt,
      status: keys.status,
      count: sql<number>`count(${keys.id})::int`,
    })
    .from(apps)
    .leftJoin(keys, eq(keys.appId, apps.id))
    .groupBy(apps.id, keys.status)
    .orderBy(apps.name);

  const map = new Map<
    number,
    { id: number; name: string; steamAppId: number | null; headerImage: string | null; createdAt: Date; counts: StatusCounts; total: number }
  >();
  for (const r of rows) {
    let a = map.get(r.id);
    if (!a) {
      a = { id: r.id, name: r.name, steamAppId: r.steamAppId, headerImage: r.headerImage, createdAt: r.createdAt, counts: emptyCounts(), total: 0 };
      map.set(r.id, a);
    }
    if (r.status) {
      a.counts[r.status] = r.count;
      a.total += r.count;
    }
  }
  return [...map.values()];
}

export async function getApp(id: number) {
  return db.query.apps.findFirst({ where: eq(apps.id, id) });
}

export async function appStatusCounts(appId: number): Promise<StatusCounts> {
  const rows = await db
    .select({ status: keys.status, count: sql<number>`count(*)::int` })
    .from(keys)
    .where(eq(keys.appId, appId))
    .groupBy(keys.status);
  const out = emptyCounts();
  for (const r of rows) out[r.status] = r.count;
  return out;
}

export async function listBatches(appId: number) {
  return db
    .select({
      id: batches.id,
      name: batches.name,
      source: batches.source,
      createdAt: batches.createdAt,
      count: sql<number>`count(${keys.id})::int`,
    })
    .from(batches)
    .leftJoin(keys, eq(keys.batchId, batches.id))
    .where(eq(batches.appId, appId))
    .groupBy(batches.id)
    .orderBy(desc(batches.createdAt));
}

export type KeyRow = {
  id: number;
  keyHint: string;
  status: KeyStatus;
  assignee: string | null;
  note: string | null;
  batchId: number | null;
  batchName: string | null;
  createdAt: Date;
  updatedAt: Date;
  activeLinkId: number | null;
  activeLinkExpiresAt: Date | null;
};

export type KeyFilter = {
  status?: KeyStatus | "all";
  batchId?: number;
  q?: string; // matches assignee, note, key hint
  page?: number;
  pageSize?: number;
};

export async function listKeys(appId: number, f: KeyFilter = {}) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 100, 10), 500);
  const page = Math.max(f.page ?? 1, 1);

  const conds: SQL[] = [eq(keys.appId, appId)];
  if (f.status && f.status !== "all") conds.push(eq(keys.status, f.status));
  if (f.batchId) conds.push(eq(keys.batchId, f.batchId));
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    conds.push(or(ilike(keys.assignee, q), ilike(keys.note, q), ilike(keys.keyHint, q))!);
  }
  const where = and(...conds);

  const activeLink = db
    .select({
      keyId: claimLinks.keyId,
      id: sql<number>`max(${claimLinks.id})`.as("active_link_id"),
      expiresAt: sql<Date>`max(${claimLinks.expiresAt})`.as("active_link_expires"),
    })
    .from(claimLinks)
    .where(and(isNull(claimLinks.revealedAt), isNull(claimLinks.revokedAt), sql`${claimLinks.expiresAt} > now()`))
    .groupBy(claimLinks.keyId)
    .as("al");

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: keys.id,
        keyHint: keys.keyHint,
        status: keys.status,
        assignee: keys.assignee,
        note: keys.note,
        batchId: keys.batchId,
        batchName: batches.name,
        createdAt: keys.createdAt,
        updatedAt: keys.updatedAt,
        activeLinkId: activeLink.id,
        activeLinkExpiresAt: activeLink.expiresAt,
      })
      .from(keys)
      .leftJoin(batches, eq(batches.id, keys.batchId))
      .leftJoin(activeLink, eq(activeLink.keyId, keys.id))
      .where(where)
      .orderBy(keys.id)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(keys).where(where),
  ]);

  return { rows: rows as KeyRow[], total, page, pageSize };
}

export type LinkView = "active" | "expired" | "all";

export async function listLinks(opts: { view?: LinkView; limit?: number; createdByUserId?: number } = {}) {
  const conds: SQL[] = [];
  if (opts.view === "active") {
    conds.push(isNull(claimLinks.revealedAt), isNull(claimLinks.revokedAt), sql`${claimLinks.expiresAt} > now()`);
  } else if (opts.view === "expired") {
    // Expired without ever being opened (and not revoked): the "wasted" links.
    conds.push(isNull(claimLinks.revealedAt), isNull(claimLinks.revokedAt), sql`${claimLinks.expiresAt} <= now()`);
  }
  if (opts.createdByUserId) conds.push(eq(claimLinks.createdByUserId, opts.createdByUserId));
  return db
    .select({
      id: claimLinks.id,
      keyId: claimLinks.keyId,
      keyHint: keys.keyHint,
      keyStatus: keys.status,
      appId: apps.id,
      appName: apps.name,
      label: claimLinks.label,
      expiresAt: claimLinks.expiresAt,
      revealedAt: claimLinks.revealedAt,
      revokedAt: claimLinks.revokedAt,
      revealIp: claimLinks.revealIp,
      createdAt: claimLinks.createdAt,
      createdByName: users.name,
      createdByUserId: claimLinks.createdByUserId,
    })
    .from(claimLinks)
    .innerJoin(keys, eq(keys.id, claimLinks.keyId))
    .innerJoin(apps, eq(apps.id, keys.appId))
    .leftJoin(users, eq(users.id, claimLinks.createdByUserId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(claimLinks.createdAt))
    .limit(opts.limit ?? 500);
}

export async function recentActivity(limit = 100, appId?: number) {
  return db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      details: auditLog.details,
      ip: auditLog.ip,
      createdAt: auditLog.createdAt,
      keyId: auditLog.keyId,
      keyHint: keys.keyHint,
      appId: auditLog.appId,
      appName: apps.name,
      userName: users.name,
    })
    .from(auditLog)
    .leftJoin(keys, eq(keys.id, auditLog.keyId))
    .leftJoin(apps, eq(apps.id, auditLog.appId))
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(appId ? eq(auditLog.appId, appId) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}

export async function globalCounts() {
  const rows = await db.select({ status: keys.status, count: sql<number>`count(*)::int` }).from(keys).groupBy(keys.status);
  const out = emptyCounts();
  for (const r of rows) out[r.status] = r.count;
  const [{ activeLinks }] = await db
    .select({ activeLinks: sql<number>`count(*)::int` })
    .from(claimLinks)
    .where(and(isNull(claimLinks.revealedAt), isNull(claimLinks.revokedAt), sql`${claimLinks.expiresAt} > now()`));
  return { ...out, activeLinks };
}


export async function listUsers() {
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      hasPassword: sql<boolean>`${users.passwordHash} is not null`,
      inviteExpiresAt: users.inviteExpiresAt,
      dailyLinkLimit: users.dailyLinkLimit,
      batchLinkLimit: users.batchLinkLimit,
      disabledAt: users.disabledAt,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      linksTotal: sql<number>`(select count(*)::int from ${claimLinks} cl where cl.created_by_user_id = ${users.id})`,
      linksToday: sql<number>`(select count(*)::int from ${claimLinks} cl where cl.created_by_user_id = ${users.id} and cl.created_at >= date_trunc('day', now() at time zone 'utc'))`,
    })
    .from(users)
    .orderBy(users.role, users.name);
}

/** Per-user quota usage for the dev "Send" page. */
export async function userQuota(userId: number) {
  const [{ today }] = await db
    .select({ today: sql<number>`count(*)::int` })
    .from(claimLinks)
    .where(and(eq(claimLinks.createdByUserId, userId), sql`${claimLinks.createdAt} >= date_trunc('day', now() at time zone 'utc')`));
  return { today };
}
