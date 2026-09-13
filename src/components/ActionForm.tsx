"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/actions";

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  successMessage?: string;
};

export function ActionForm({ action, children, className, successMessage }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={className}>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {state.error && <p className="mt-2 text-sm text-red-500">{state.error}</p>}
      {state.ok && successMessage && <p className="mt-2 text-sm text-emerald-500">{successMessage}</p>}
    </form>
  );
}
