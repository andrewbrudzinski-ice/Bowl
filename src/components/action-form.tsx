"use client";
import { useActionState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import type { ActionState } from "@/app/actions/util";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function SubmitButton({ children, className = "btn btn-primary", pending, disabled }: { children: ReactNode; className?: string; pending: boolean; disabled?: boolean }) {
  return (
    <button type="submit" className={className} disabled={pending || disabled} aria-busy={pending}>
      {pending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

/** A <form> bound to a server action with inline error/success feedback and a pending state. */
export function ActionForm({
  action, children, submit = "Save", submitClass, className = "grid gap-3", reset = false, secondary,
}: {
  action: Action;
  children: ReactNode;
  submit?: ReactNode;
  submitClass?: string;
  className?: string;
  reset?: boolean;
  secondary?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(async (prev: ActionState, fd: FormData) => action(prev, fd), null);
  return (
    <form action={formAction} className={className} key={reset && state?.ok ? "ok" : "form"}>
      {children}
      {state?.error ? (
        <div className="alert alert-error" role="alert">
          <div>
            <div className="font-semibold">{state.error}</div>
            {state.issues?.length ? (
              <ul className="mt-1 list-disc pl-4 text-[13px]">
                {state.issues.map((i, k) => (
                  <li key={k}>{i}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
      {state?.ok && state.message ? (
        <div className="alert alert-ok" role="status">
          {state.message}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pending={pending} className={submitClass ?? "btn btn-primary"}>
          {submit}
        </SubmitButton>
        {secondary}
      </div>
    </form>
  );
}
