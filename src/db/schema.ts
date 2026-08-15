import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  pgEnum,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const keyStatusEnum = pgEnum("key_status", [
  "available", // in the pool
  "reserved", // held for someone / has an outstanding claim link
  "claimed", // revealed through a claim link
  "used", // manually marked as used
  "invalid", // known-bad key
]);

export type KeyStatus = (typeof keyStatusEnum.enumValues)[number];
export const KEY_STATUSES = keyStatusEnum.enumValues;

export const userRoleEnum = pgEnum("user_role", ["admin", "dev"]);
export type UserRole = (typeof userRoleEnum.enumValues)[number];

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(), // stored lower-cased
    name: text("name").notNull(),
    role: userRoleEnum("role").notNull().default("dev"),
    // null until the invite is accepted
    passwordHash: text("password_hash"),
    // one-time invite / password-reset token (sha256), cleared on use
    inviteTokenHash: text("invite_token_hash"),
    inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
    // dev limits (ignored for admins)
    dailyLinkLimit: integer("daily_link_limit").notNull().default(20),
    batchLinkLimit: integer("batch_link_limit").notNull().default(10),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email), uniqueIndex("users_invite_uq").on(t.inviteTokenHash)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const apps = pgTable("apps", {
  id: serial("id").primaryKey(),
  steamAppId: integer("steam_app_id").unique(),
  name: text("name").notNull(),
  headerImage: text("header_image"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const batches = pgTable("batches", {
  id: serial("id").primaryKey(),
  appId: integer("app_id")
    .notNull()
    .references(() => apps.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  source: text("source"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const keys = pgTable(
  "keys",
  {
    id: serial("id").primaryKey(),
    appId: integer("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    batchId: integer("batch_id").references(() => batches.id, { onDelete: "set null" }),
    // SHA-256 of the normalised key. Used for dedup and lookup without decrypting.
    keyHash: text("key_hash").notNull(),
    // AES-256-GCM ciphertext (iv:tag:ct, base64)
    keyCiphertext: text("key_ciphertext").notNull(),
    // last group of the key, e.g. "3F9K2". Safe to show in lists.
    keyHint: text("key_hint").notNull(),
    status: keyStatusEnum("status").notNull().default("available"),
    // free-text: who this key is reserved for / was given to
    assignee: text("assignee"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("keys_key_hash_uq").on(t.keyHash),
    index("keys_app_status_idx").on(t.appId, t.status),
    index("keys_batch_idx").on(t.batchId),
  ],
);

export const claimLinks = pgTable(
  "claim_links",
  {
    id: serial("id").primaryKey(),
    keyId: integer("key_id")
      .notNull()
      .references(() => keys.id, { onDelete: "cascade" }),
    // SHA-256 of the URL token; the raw token is only shown once at creation
    tokenHash: text("token_hash").notNull(),
    label: text("label"), // who the link is for
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revealedAt: timestamp("revealed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revealIp: text("reveal_ip"),
    revealUserAgent: text("reveal_user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("claim_links_token_hash_uq").on(t.tokenHash),
    index("claim_links_key_idx").on(t.keyId),
    index("claim_links_creator_idx").on(t.createdByUserId, t.createdAt),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    appId: integer("app_id").references(() => apps.id, { onDelete: "set null" }),
    keyId: integer("key_id").references(() => keys.id, { onDelete: "set null" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt), index("audit_key_idx").on(t.keyId)],
);

export const appsRelations = relations(apps, ({ many }) => ({
  keys: many(keys),
  batches: many(batches),
}));
export const batchesRelations = relations(batches, ({ one, many }) => ({
  app: one(apps, { fields: [batches.appId], references: [apps.id] }),
  keys: many(keys),
}));
export const keysRelations = relations(keys, ({ one, many }) => ({
  app: one(apps, { fields: [keys.appId], references: [apps.id] }),
  batch: one(batches, { fields: [keys.batchId], references: [batches.id] }),
  claimLinks: many(claimLinks),
}));
export const claimLinksRelations = relations(claimLinks, ({ one }) => ({
  key: one(keys, { fields: [claimLinks.keyId], references: [keys.id] }),
}));

export type App = typeof apps.$inferSelect;
export type Batch = typeof batches.$inferSelect;
export type Key = typeof keys.$inferSelect;
export type ClaimLink = typeof claimLinks.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
