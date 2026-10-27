import type { Role } from "@/domain/types";

/**
 * Explicit permission matrix. Every sensitive service function calls `requirePerm`, so enforcement
 * lives on the server, not in the UI. supabase/migrations mirrors this matrix in RLS policies.
 */
export type Permission =
  | "league.view_admin"
  | "settings.general"
  | "settings.rules"
  | "settings.visibility"
  | "season.manage"
  | "roster.manage"
  | "schedule.manage"
  | "scores.enter"
  | "results.finalize"
  | "results.correct"
  | "announcements.post"
  | "awards.manage"
  | "audit.view"
  | "members.manage"
  | "members.invite_basic"
  | "data.export"
  | "data.import"
  | "ownership.transfer"
  | "league.delete"
  | "demo.reset"
  | "profile.edit_own";

const O: Role = "owner";
const C: Role = "commissioner";
const A: Role = "assistant";
const S: Role = "scorekeeper";
const B: Role = "bowler";

export const PERMISSION_MATRIX: Record<Permission, Role[]> = {
  "league.view_admin": [O, C, A, S],
  "settings.general": [O, C],
  "settings.rules": [O, C],
  "settings.visibility": [O],
  "season.manage": [O, C],
  "roster.manage": [O, C, A],
  "schedule.manage": [O, C, A],
  "scores.enter": [O, C, A, S],
  "results.finalize": [O, C, A],
  "results.correct": [O, C],
  "announcements.post": [O, C, A],
  "awards.manage": [O, C],
  "audit.view": [O, C, A],
  "members.manage": [O, C],
  "members.invite_basic": [O, C, A],
  "data.export": [O, C, A],
  "data.import": [O, C],
  "ownership.transfer": [O],
  "league.delete": [O],
  "demo.reset": [O, C],
  "profile.edit_own": [O, C, A, S, B],
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: "League owner",
  commissioner: "Commissioner",
  assistant: "Assistant commissioner",
  scorekeeper: "Scorekeeper",
  bowler: "Bowler / team member",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Everything, including visibility, ownership transfer and deleting the league.",
  commissioner: "Manages rules, seasons, rosters, schedules, results, corrections and members.",
  assistant: "Manages rosters, schedules and announcements, enters and finalizes scores. Cannot change rules or correct finalized results.",
  scorekeeper: "Enters scores and drafts. Cannot finalize results or change settings.",
  bowler: "Views everything members can see and edits their own profile details.",
  viewer: "Read-only access to the league.",
};

export const ROLES: Role[] = ["owner", "commissioner", "assistant", "scorekeeper", "bowler", "viewer"];

export function roleCan(role: Role | null | undefined, perm: Permission): boolean {
  return !!role && PERMISSION_MATRIX[perm].includes(role);
}

/** Roles a member of `actor` role may hand out. Nobody but the owner can create owners/commissioners. */
export function assignableRoles(actor: Role): Role[] {
  if (actor === "owner") return ["commissioner", "assistant", "scorekeeper", "bowler", "viewer"];
  if (actor === "commissioner") return ["assistant", "scorekeeper", "bowler", "viewer"];
  if (actor === "assistant") return ["bowler", "viewer"];
  return [];
}
