"use client";
import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import type { ActionState } from "@/app/actions/util";
import { addDays, daysBetween, isIsoDate } from "@/domain/dates";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const show = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Pick the right date for the first week; every week moves by the same amount. The preview says exactly where the first and last weeks land. */
export function ShiftWeeksForm({ action, firstWeek, firstDate, lastWeek, lastDate }: { action: Action; firstWeek: number; firstDate: string; lastWeek: number; lastDate: string }) {
  const [value, setValue] = useState(firstDate);
  const days = isIsoDate(value) ? daysBetween(firstDate, value) : null;
  return (
    <ActionForm action={action} submit="Move all weeks" className="grid gap-3">
      <div className="field">
        <label htmlFor="firstNight">Correct date for week {firstWeek}</label>
        <input id="firstNight" name="firstNight" type="date" required value={value} onChange={(e) => setValue(e.target.value)} className="input !w-44" aria-describedby="shift-preview" />
      </div>
      <p id="shift-preview" className="help" aria-live="polite">
        {days === null ? "Pick a date to see where the weeks would land." : days === 0 ? `Week ${firstWeek} is on ${show(firstDate)} now. Pick a different date to move the schedule.` : (
          <>Week {firstWeek} would move from {show(firstDate)} to <b>{show(value)}</b>, and week {lastWeek} from {show(lastDate)} to <b>{show(addDays(lastDate, days))}</b>: every week moves {Math.abs(days)} day{Math.abs(days) === 1 ? "" : "s"} {days < 0 ? "earlier" : "later"}.</>
        )}
      </p>
    </ActionForm>
  );
}
