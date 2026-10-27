import { z } from "zod";
import type { Id } from "@/domain/types";
import { bowlerIn, notifyMembers, requirePerm, seasonIn, writeAudit, type Actor } from "../access";
import type { Announcement, NotificationPrefs, Store } from "../db";
import { invalid, notFound } from "../errors";
import { newId, now } from "../ids";

export const ANNOUNCEMENT_CATEGORIES: { id: Announcement["category"]; label: string }[] = [
  { id: "dates", label: "Bowling dates" },
  { id: "schedule", label: "Schedule change" },
  { id: "rules", label: "Rule update" },
  { id: "event", label: "Special event" },
  { id: "recap", label: "Weekly recap" },
  { id: "playoffs", label: "Playoffs" },
  { id: "general", label: "General" },
];

const annSchema = z.object({
  title: z.string().trim().min(2, "Give the announcement a title.").max(120),
  body: z.string().trim().min(1, "Write the announcement text.").max(5000),
  category: z.enum(["dates", "schedule", "rules", "event", "recap", "playoffs", "general"]),
  pinned: z.boolean().default(false),
});

export function postAnnouncement(store: Store, actor: Actor, leagueId: Id, raw: z.input<typeof annSchema>): Id {
  const p = annSchema.safeParse(raw);
  if (!p.success) throw invalid(p.error.issues[0].message);
  return store.transaction((db) => {
    const { league } = requirePerm(db, actor, leagueId, "announcements.post");
    const a: Announcement = { id: newId("an"), leagueId, ...p.data, createdBy: actor.id, createdByName: actor.name, createdAt: now(), updatedAt: now(), updatedByName: actor.name };
    db.announcements.push(a);
    const type = a.category === "rules" ? "rules" : a.category === "schedule" || a.category === "dates" ? "schedule" : a.category === "playoffs" ? "playoffs" : "announcements";
    notifyMembers(db, { leagueId, type, title: a.title, body: a.body.slice(0, 140), href: `/l/${league.slug}/news#${a.id}`, dedupeKey: `ann:${a.id}`, exceptUserId: actor.id });
    writeAudit(db, actor, { leagueId, action: "announcement.posted", entityType: "announcement", entityId: a.id, after: { title: a.title, category: a.category } });
    return a.id;
  });
}

export function updateAnnouncement(store: Store, actor: Actor, leagueId: Id, id: Id, raw: z.input<typeof annSchema>) {
  const p = annSchema.safeParse(raw);
  if (!p.success) throw invalid(p.error.issues[0].message);
  store.transaction((db) => {
    requirePerm(db, actor, leagueId, "announcements.post");
    const a = db.announcements.find((x) => x.id === id && x.leagueId === leagueId);
    if (!a) throw notFound("Announcement");
    const before = { title: a.title, body: a.body, category: a.category, pinned: a.pinned };
    Object.assign(a, p.data, { updatedAt: now(), updatedByName: actor.name });
    writeAudit(db, actor, { leagueId, action: "announcement.updated", entityType: "announcement", entityId: id, before, after: p.data });
    // Edits never re-notify: the dedupe key is per announcement.
  });
}

export function addCommissionerAward(store: Store, actor: Actor, leagueId: Id, input: { seasonId: Id; title: string; recipientKind: "bowler" | "team"; recipientId: Id; note: string; week: number | null }) {
  if (!input.title.trim()) throw invalid("Name the award.");
  store.transaction((db) => {
    requirePerm(db, actor, leagueId, "awards.manage");
    seasonIn(db, leagueId, input.seasonId);
    if (input.recipientKind === "bowler") bowlerIn(db, leagueId, input.recipientId);
    else if (!db.teams.some((t) => t.id === input.recipientId && t.leagueId === leagueId)) throw notFound("Team");
    const rec = { id: newId("ca"), leagueId, seasonId: input.seasonId, title: input.title.trim().slice(0, 80), recipientKind: input.recipientKind, recipientId: input.recipientId, note: input.note.trim().slice(0, 300), week: input.week, createdBy: actor.id, createdAt: now() };
    db.commissionerAwards.push(rec);
    writeAudit(db, actor, { leagueId, seasonId: input.seasonId, action: "award.commissioner_added", entityType: "award", entityId: rec.id, after: rec });
  });
}

export function removeCommissionerAward(store: Store, actor: Actor, leagueId: Id, id: Id) {
  store.transaction((db) => {
    requirePerm(db, actor, leagueId, "awards.manage");
    const a = db.commissionerAwards.find((x) => x.id === id && x.leagueId === leagueId);
    if (!a) throw notFound("Award");
    db.commissionerAwards = db.commissionerAwards.filter((x) => x.id !== id);
    writeAudit(db, actor, { leagueId, seasonId: a.seasonId, action: "award.commissioner_removed", entityType: "award", entityId: id, before: a });
  });
}

export function listNotifications(store: Store, userId: Id, limit = 50) {
  return store.read((db) =>
    db.notifications
      .filter((n) => n.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((n) => ({ ...n, leagueName: db.leagues.find((l) => l.id === n.leagueId)?.name ?? "" }))
  );
}

export function unreadCount(store: Store, userId: Id): number {
  return store.read((db) => db.notifications.filter((n) => n.userId === userId && !n.readAt).length);
}

export function markNotificationsRead(store: Store, userId: Id, ids?: Id[]) {
  store.transaction((db) => {
    for (const n of db.notifications) if (n.userId === userId && !n.readAt && (!ids || ids.includes(n.id))) n.readAt = now();
  });
}

export function updatePrefs(store: Store, userId: Id, prefs: Partial<NotificationPrefs>) {
  store.transaction((db) => {
    const u = db.users.find((x) => x.id === userId);
    if (!u) throw notFound("User");
    for (const k of Object.keys(u.prefs) as (keyof NotificationPrefs)[]) if (typeof prefs[k] === "boolean") u.prefs[k] = prefs[k]!;
  });
}

export function updateProfile(store: Store, userId: Id, name: string) {
  const n = name.trim();
  if (!n || n.length > 80) throw invalid("Enter your name (up to 80 characters).");
  store.transaction((db) => {
    const u = db.users.find((x) => x.id === userId);
    if (!u) throw notFound("User");
    u.name = n;
  });
}

