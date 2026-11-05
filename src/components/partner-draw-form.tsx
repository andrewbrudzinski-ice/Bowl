"use client";
import { useId, useState } from "react";
import type { ActionState } from "@/app/actions/util";
import { ActionForm } from "./action-form";

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
  const picked = weeks.find((w) => w.number === week);
  const n = bowling.size;
  const matches = Math.floor(n / 4);
  const sitting = n % 4;
  const toggle = (id: string, on: boolean) =>
    setBowling((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <ActionForm action={action} submit={picked?.drawn ? `Draw week ${week} again` : `Draw week ${week} partners`} className="grid gap-4">
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
          : `${n} bowling: ${matches} match${matches === 1 ? "" : "es"}${sitting ? `, and ${sitting} sit${sitting === 1 ? "s" : ""} out (whoever has sat out least so far)` : ", and everyone bowls"}.`}
      </p>
    </ActionForm>
  );
}
