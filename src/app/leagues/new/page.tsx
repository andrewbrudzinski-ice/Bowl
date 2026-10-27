import Link from "next/link";
import { LeagueWizard } from "@/components/league-wizard";
import { DEFAULT_CONFIG, normalizeConfig } from "@/domain/config";
import { getStore } from "@/server/db";
import { roleCan } from "@/server/permissions";
import { requireActor } from "@/server/session";

export const metadata = { title: "Create a league" };

export default async function NewLeague() {
  const actor = await requireActor("/leagues/new");
  const store = getStore();
  const copyOptions = await store.read((db) =>
    db.memberships.filter((m) => m.userId === actor.id && m.status === "active" && roleCan(m.role, "settings.rules")).flatMap((m) => {
      const l = db.leagues.find((x) => x.id === m.leagueId && !x.archivedAt);
      if (!l) return [];
      const s = db.seasons.filter((x) => x.leagueId === l.id).sort((a, b) => b.year - a.year)[0];
      return [{ id: l.id, name: `${l.name}${s ? ` (${s.name})` : ""}`, config: normalizeConfig(s ? s.ruleVersions[s.ruleVersions.length - 1].config : l.defaultConfig) }];
    })
  );
  return (
    <div className="wrap max-w-4xl py-8">
      <Link href="/" className="muted text-[13px] hover:text-fg">← Home</Link>
      <h1 className="h-page mb-1 mt-2">Create a league</h1>
      <p className="muted mb-5 text-[13px]">Six short steps. Every rule is configurable — templates are just starting points.</p>
      <main id="main"><LeagueWizard copyOptions={copyOptions} defaultConfig={normalizeConfig(DEFAULT_CONFIG)} /></main>
    </div>
  );
}
