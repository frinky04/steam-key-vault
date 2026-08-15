CREATE TABLE "claim_link_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"link_id" integer NOT NULL,
	"key_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claim_links" DROP CONSTRAINT "claim_links_key_id_keys_id_fk";
--> statement-breakpoint
DROP INDEX "claim_links_key_idx";--> statement-breakpoint
ALTER TABLE "claim_link_keys" ADD CONSTRAINT "claim_link_keys_link_id_claim_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."claim_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_link_keys" ADD CONSTRAINT "claim_link_keys_key_id_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_link_keys_uq" ON "claim_link_keys" USING btree ("link_id","key_id");--> statement-breakpoint
CREATE INDEX "claim_link_keys_key_idx" ON "claim_link_keys" USING btree ("key_id");--> statement-breakpoint
-- backfill: every existing link had exactly one key
INSERT INTO "claim_link_keys" ("link_id", "key_id", "position") SELECT "id", "key_id", 0 FROM "claim_links" WHERE "key_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_links" DROP COLUMN "key_id";