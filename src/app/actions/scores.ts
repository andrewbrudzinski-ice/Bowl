"use server";
import { getStore } from "@/server/db";
import { leagueBySlug } from "@/server/access";
import { requireActor } from "@/server/session";
import { correctResult, finalizeMatchup, markReady, previewFinalize, reopenResult, saveWeekEntries, type BulkItemResult, type EntryInput, type FinalizePreview } from "@/server/services/results";
import { run } from "./util";

function leagueId(slug: string): string {
  const l = getStore().read((db) => leagueBySlug(db, slug));
  if (!l) throw Object.assign(new Error("not found"), { digest: "NEXT_NOT_FOUND" });
  return l.id;
}

export type SaveReply = { ok: boolean; error?: string; results?: BulkItemResult[] };

/** Saves one or more matchups. Each reports success/failure independently. */
export async function saveEntriesAction(slug: string, entries: EntryInput[]): Promise<SaveReply> {
  const actor = await requireActor();
  let results: BulkItemResult[] = [];
  const r = await run(async () => {
    results = saveWeekEntries(getStore(), actor, leagueId(slug), entries);
  });
  return r?.error ? { ok: false, error: r.error } : { ok: true, results };
}

export async function previewFinalizeAction(slug: string, matchupId: string): Promise<{ ok: boolean; error?: string; preview?: FinalizePreview }> {
  const actor = await requireActor();
  let preview: FinalizePreview | undefined;
  const r = await run(async () => {
    preview = previewFinalize(getStore(), actor, leagueId(slug), matchupId);
  });
  return r?.error ? { ok: false, error: r.error } : { ok: true, preview };
}

export async function finalizeAction(slug: string, matchupId: string, revision: number): Promise<{ ok: boolean; error?: string; issues?: string[]; revision?: number }> {
  const actor = await requireActor();
  let rev: number | undefined;
  const r = await run(async () => {
    rev = finalizeMatchup(getStore(), actor, leagueId(slug), matchupId, revision).revision;
  });
  return r?.ok === false ? { ok: false, error: r.error, issues: r.issues } : { ok: true, revision: rev };
}

export async function markReadyAction(slug: string, matchupId: string, revision: number) {
  const actor = await requireActor();
  const r = await run(async () => {
    markReady(getStore(), actor, leagueId(slug), matchupId, revision);
  });
  return r?.ok === false ? { ok: false, error: r.error, issues: r.issues } : { ok: true };
}

export async function correctAction(slug: string, input: Parameters<typeof correctResult>[3]) {
  const actor = await requireActor();
  const r = await run(async () => {
    correctResult(getStore(), actor, leagueId(slug), input);
  });
  return r?.ok === false ? { ok: false, error: r.error, issues: r.issues } : { ok: true };
}

export async function reopenAction(slug: string, matchupId: string, reason: string, confirm: boolean) {
  const actor = await requireActor();
  const r = await run(async () => {
    reopenResult(getStore(), actor, leagueId(slug), matchupId, reason, confirm);
  });
  return r?.ok === false ? { ok: false, error: r.error } : { ok: true };
}
