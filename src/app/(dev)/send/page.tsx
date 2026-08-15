import { requireUser } from "@/lib/auth";
import { listAppsWithCounts, userQuota } from "@/lib/queries";
import { SendKeys } from "@/components/send-keys";
import { EmptyState } from "@/components/ui";

export const metadata = { title: "Send keys" };
export const dynamic = "force-dynamic";

export default async function SendPage() {
  const user = await requireUser();
  const [apps, quota] = await Promise.all([listAppsWithCounts(), userQuota(user.id)]);
  const isDev = user.role !== "admin";
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Send keys</h1>
        <p className="text-sm text-muted">
          Pick a game, say how many, and you get one single-use link per key to paste to each person. Keys stay hidden until
          the recipient opens the link.
          {isDev && (
            <>
              {" "}
              You can send <b className="text-foreground">{Math.max(0, user.dailyLinkLimit - quota.today)}</b> more keys today
              (limit {user.dailyLinkLimit}/day, {user.batchLinkLimit} at a time).
            </>
          )}
        </p>
      </div>
      {apps.length === 0 ? (
        <EmptyState title="No games yet">An admin needs to import keys first.</EmptyState>
      ) : (
        <SendKeys
          apps={apps.map((a) => ({ id: a.id, name: a.name, headerImage: a.headerImage, available: a.counts.available }))}
          limits={isDev ? { batch: user.batchLinkLimit, remainingToday: Math.max(0, user.dailyLinkLimit - quota.today) } : null}
        />
      )}
    </div>
  );
}
