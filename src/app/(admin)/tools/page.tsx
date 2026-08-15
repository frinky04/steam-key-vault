import { MarkUsedTool } from "@/components/mark-used-tool";

export const metadata = { title: "Tools" };

export default function ToolsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Tools</h1>
        <p className="text-sm text-muted">Bulk operations that work across all apps.</p>
      </div>
      <MarkUsedTool />
    </div>
  );
}
