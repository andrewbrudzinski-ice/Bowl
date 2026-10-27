import type { RuleConfig } from "./config";

export type Id = string;

export type ResultState =
  | "scheduled"
  | "in_progress"
  | "draft"
  | "ready_for_review"
  | "finalized"
  | "corrected";

export const RESULT_STATE_LABELS: Record<ResultState, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  draft: "Draft",
  ready_for_review: "Ready for review",
  finalized: "Final",
  corrected: "Final (corrected)",
};

/** Only these states count toward official standings. */
export function isOfficial(state: ResultState): boolean {
  return state === "finalized" || state === "corrected";
}

export type WeekStatus = "scheduled" | "in_progress" | "completed" | "postponed";
export type WeekPhase = "regular" | "playoff";
export type Side = "A" | "B";
export type ScoreKind = "bowled" | "blind" | "forfeit" | "absent";

export interface RuleVersion {
  version: number;
  /** First week number this version applies to. */
  effectiveFromWeek: number;
  config: RuleConfig;
  createdAt: string;
  createdBy: string;
  reason: string;
}

export interface Season {
  id: Id;
  leagueId: Id;
  slug: string;
  name: string;
  year: number;
  startDate: string; // ISO date
  regularWeeks: number;
  status: "setup" | "active" | "completed";
  ruleVersions: RuleVersion[];
  championId: Id | null; // team or bowler id depending on format
  isDemo: boolean;
  createdAt: string;
  /** Season-level feature switches; keeps playoffs rules in config, but weeks live here. */
}

export interface Team {
  id: Id;
  leagueId: Id;
  name: string;
  shortName: string;
  color: string;
  logo: string; // short text/emoji mark
  active: boolean;
  isDemo: boolean;
}

export interface Bowler {
  id: Id;
  leagueId: Id;
  name: string;
  nickname: string;
  avatarColor: string;
  avatarUrl: string | null;
  active: boolean;
  userId: Id | null;
  notes: string;
  isDemo: boolean;
  createdAt: string;
}

/** A bowler's participation in one season, including team-assignment history. */
export interface RosterEntry {
  id: Id;
  seasonId: Id;
  bowlerId: Id;
  teamId: Id | null;
  enteringAverage: number | null;
  isSub: boolean;
  /** Inclusive week range for this team assignment. toWeek null = still active. */
  fromWeek: number;
  toWeek: number | null;
}

export interface Week {
  id: Id;
  seasonId: Id;
  number: number;
  date: string;
  status: WeekStatus;
  phase: WeekPhase;
  label: string;
}

export interface HandicapSnapshotEntry {
  average: number | null;
  handicap: number;
  note: string;
}

export interface Matchup {
  id: Id;
  seasonId: Id;
  weekNumber: number;
  kind: "team" | "individual";
  /** Team id (kind=team) or bowler id (kind=individual). sideB null = bye for A. */
  sideA: Id;
  sideB: Id | null;
  lineupA: Id[];
  lineupB: Id[];
  state: ResultState;
  forfeitBy: Side | null;
  ruleVersion: number | null;
  handicapSnapshot: Record<Id, HandicapSnapshotEntry> | null;
  playoffRound: number | null;
  notes: string;
  revision: number;
  finalizedAt: string | null;
  finalizedBy: string | null;
  updatedAt: string;
  updatedBy: string;
  isDemo: boolean;
}

export interface Score {
  id: Id;
  matchupId: Id;
  bowlerId: Id;
  side: Side;
  game: number; // 1-based
  scratch: number | null;
  kind: ScoreKind;
  updatedAt: string;
  updatedBy: string;
}

export interface AuditEntry {
  id: Id;
  leagueId: Id;
  seasonId: Id | null;
  at: string;
  userId: Id;
  userName: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  note: string;
}

export type Role = "owner" | "commissioner" | "assistant" | "scorekeeper" | "bowler" | "viewer";
export type Visibility = "private" | "unlisted" | "public";

export interface ModuleSetting {
  id: string;
  enabled: boolean;
}

export interface AwardSetting {
  enabled: boolean;
  params: Record<string, number>;
}
export type AwardsConfig = Record<string, AwardSetting>;

export interface League {
  id: Id;
  slug: string;
  name: string;
  description: string;
  accent: string;
  logoText: string;
  visibility: Visibility;
  shareToken: string;
  createdAt: string;
  createdBy: Id;
  defaultConfig: RuleConfig;
  homepage: ModuleSetting[];
  awards: AwardsConfig;
  isDemo: boolean;
  /** Notification dedupe etc. */
  archivedAt: string | null;
}

export interface ConfigTemplateRecord {
  id: Id;
  leagueId: Id;
  name: string;
  description: string;
  config: RuleConfig;
  createdAt: string;
}
