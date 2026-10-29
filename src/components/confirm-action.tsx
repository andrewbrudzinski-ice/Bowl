"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/app/actions/util";

/** Button for a destructive or one-click server action: asks first, shows the outcome inline. */
export function ConfirmAction({ action, children, confirm, className = "btn btn-sm", prompt }: { action: (arg?: string) => Promise<ActionState | void>; children: ReactNode; confirm?: string; className?: string; prompt?: string }) {
  const [msg, setMsg] = useState<ActionState>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" className={className} disabled={pending} onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        const arg = prompt ? window.prompt(prompt) : undefined;
        if (prompt && !arg) return;
        start(async () => { const r = (await action(arg ?? undefined)) ?? { ok: true }; setMsg(r); router.refresh(); });
      }}>{pending ? "Working…" : children}</button>
      {msg?.error ? <span role="alert" className="text-[13px] text-loss">{msg.error}</span> : msg?.message ? <span role="status" className="text-[13px] text-win">{msg.message}</span> : null}
    </span>
  );
}
