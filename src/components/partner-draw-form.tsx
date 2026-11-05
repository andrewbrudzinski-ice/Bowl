"use client";
import { useId, useState } from "react";
import type { ActionState } from "@/app/actions/util";
import type { DrawnShown } from "@/domain/reveal";
import { ActionForm } from "./action-form";
import { DrawReveal } from "./draw-reveal";

export interface DrawWeek {
  number: number;
  /** "Wed, Jan 7" */
  label: string;
  /** Partners were already drawn for this week. */
  drawn: boolean;
  /** Scores or final results exist, so the week can't be drawn again. */
  locked: boolean;
}
export interface DrawBowler {
  id: string;
  name: string;
}

/** Picks a week and the bowlers who are bowling, then asks the server to draw the pairs and matches. */
export function PartnerDrawForm({ action, weeks, bowlers, defaultWeek }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; weeks: DrawWeek[]; bowlers: DrawBowler[]; defaultWeek: number }) {
  const uid = useId();
  const [week, setWeek] = useState(defaultWeek);
  const [bowling, setBowling] = useState<Set<string>>(() => new Set(bowlers.map((b) => b.id)));
  const [reveal, setReveal] = useState<{ week: number; matches: DrawnShown[] } | null>(null);
  // The server answers with the draw as names; show it straight away as the reveal.
  const drawAndReveal = async (prev: ActionState, fd: FormData) => {
    const r = await action(prev, fd);
    const data = r?.ok ? (r.data as { week: number; matches: DrawnShown[] } | undefined) : undefined;
    if (data) setReveal(data);
    return r;
  };
  const picked = weeks.find((w) => w.number === week);
  const n = bowling.size;
  // Two bowlers make a pair, two pairs make a match; an odd pair is the extra pair, and an odd bowler sits out.
  const pairs = Math.floor(n / 2);
  const matches = Math.floor(pairs / 2);
  const extra = pairs % 2 === 1;
  const sitting = n % 2;
  const toggle = (id: string, on: boolean) =>
    setBowling((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <>
    <DrawReveal matches={reveal?.matches ?? []} week={reveal?.week ?? week} open={!!reveal} onClose={() => setReveal(null)} />
    <ActionForm action={drawAndReveal} submit={picked?.drawn ? `Draw week ${week} again` : `Draw week ${week} partners`} className="grid gap-4">
      <div className="field">
        <label htmlFor={`${uid}-week`}>Week</label>
        <select id={`${uid}-week`} name="week" className="select !w-auto min-w-48" value={week} onChange={(e) => setWeek(Number(e.target.value))}>
          {weeks.map((w) => (
            <option key={w.number} value={w.number} disabled={w.locked}>
              Week {w.number} · {w.label}{w.locked ? " (has scores)" : w.drawn ? " (drawn)" : ""}
            </option>
          ))}
        </select>
        {picked?.drawn && !picked.locked ? <span className="help">Partners are already drawn for this week. Drawing again replaces them, which is only possible before scores are entered.</span> : null}
      </div>

      <fieldset className="grid gap-2">
        <legend className="label">Who is bowling this week</legend>
        <div className="flex flex-wrap gap-2 pb-1">
          <button type="button" className="btn btn-sm" onClick={() => setBowling(new Set(bowlers.map((b) => b.id)))}>Everyone</button>
          <button type="button" className="btn btn-sm" onClick={() => setBowling(new Set())}>Nobody</button>
        </div>
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {bowlers.map((b) => (
            <label key={b.id} className="check">
              <input type="checkbox" name="bowler" value={b.id} checked={bowling.has(b.id)} onChange={(e) => toggle(b.id, e.target.checked)} />
              {b.name}
            </label>
          ))}
        </div>
      </fieldset>

      <p className={`text-[13px] ${n < 4 ? "text-loss" : "muted"}`} aria-live="polite">
        {n < 4
          ? `${n} selected. Pick at least four: partners are drawn in pairs, and two pairs make a match.`
          : `${n} bowling: ${pairs} pairs, making ${matches} match${matches === 1 ? "" : "es"}${extra ? " plus one extra pair that is compared with another pair’s scores" : ""}${sitting ? `; 1 bowler sits out (whoever has sat out least so far)` : "; everyone bowls"}.`}
      </p>
    </ActionForm>
    </>
  );
}
