import { sql, type SQL } from "drizzle-orm";
import { keys } from "@/db/schema";

/** SQL predicate: this key row currently has an outstanding (live) claim link. */
export const keyHasLiveLink: SQL = sql`exists (
  select 1 from claim_link_keys clk
  join claim_links cl on cl.id = clk.link_id
  where clk.key_id = ${keys.id}
    and cl.revealed_at is null and cl.revoked_at is null and cl.expires_at > now()
)`;

export const keyHasNoLiveLink: SQL = sql`not ${keyHasLiveLink}`;
