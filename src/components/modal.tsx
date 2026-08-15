"use client";

import { useEffect } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:items-start sm:p-4 sm:pt-[8vh]" onMouseDown={onClose}>
      <div
        className={`card max-h-[calc(100dvh-1rem)] w-full overflow-y-auto ${wide ? "max-w-3xl" : "max-w-lg"} shadow-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-labelledby="modal-title"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="modal-title" className="font-semibold">{title}</h2>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
