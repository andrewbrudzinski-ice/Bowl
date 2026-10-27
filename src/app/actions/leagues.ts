"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createDemoLeague, removeDemoLeague } from "@/server/demo";
import { getStore } from "@/server/db";
import { requireActor } from "@/server/session";
import { createLeague, type CreateLeagueInput } from "@/server/services/leagues";
import { run, type ActionState } from "./util";

export async function createDemoAction() {
  const actor = await requireActor("/");
  let slug = "";
  const r = await run(async () => {
    slug = createDemoLeague(getStore(), actor).slug;
  });
  if (r?.error) redirect(`/?error=${encodeURIComponent(r.error)}`);
  redirect(`/l/${slug}`);
}

export async function removeDemoAction(leagueId: string): Promise<void> {
  const actor = await requireActor();
  const r = await run(async () => removeDemoLeague(getStore(), actor, leagueId));
  if (r?.error) redirect(`/?error=${encodeURIComponent(r.error)}`);
  revalidatePath("/");
  redirect("/");
}

/** Called by the wizard with the fully assembled input (validated again on the server). */
export async function createLeagueAction(input: CreateLeagueInput): Promise<ActionState> {
  const actor = await requireActor("/leagues/new");
  let slug = "";
  const r = await run(async () => {
    slug = createLeague(getStore(), actor, input).slug;
  });
  if (r?.error) return r;
  redirect(`/l/${slug}/admin?welcome=1`);
}
