import { ActionForm } from "@/components/ActionForm";
import { unlockGate } from "@/lib/game-actions";
import type { GateRole } from "@/lib/game-auth";

export function PasswordGate({ role, next, title, blurb }: { role: GateRole; next: string; title: string; blurb: string }) {
  return (
    <div className="card mx-auto mt-10 max-w-sm p-8 text-center sm:mt-20">
      <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-amber-300 to-rose-500 text-lg font-bold text-zinc-950 shadow-lg shadow-rose-500/30">
        ?
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">{title}</h1>
      <p className="mt-2 text-sm text-zinc-400">{blurb}</p>
      <ActionForm action={unlockGate} className="mt-6 space-y-3 text-left">
        <input type="hidden" name="role" value={role} />
        <input type="hidden" name="next" value={next} />
        <input
          className="input"
          type="password"
          name="password"
          placeholder={role === "host" ? "Host password" : "Group password"}
          autoFocus
          required
        />
        <button className="btn w-full">Unlock</button>
      </ActionForm>
    </div>
  );
}
