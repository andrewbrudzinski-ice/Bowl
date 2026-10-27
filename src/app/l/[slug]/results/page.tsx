import Link from "next/link";
import { redirect } from "next/navigation";
import { getLeagueCtx } from "@/server/context";

/** "Weekly Results" jumps to the latest finalized week's recap (or week 1 if nothing is final). */
export default async function Results({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ season?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getLeagueCtx(slug, sp.season);
  if (!ctx.model || !ctx.season) redirect(`/l/${slug}`);
  const wk = ctx.model.lastOfficialWeek || 1;
  redirect(`/l/${slug}/season/${ctx.season.slug}/week/${wk}`);
  return <Link href={`/l/${slug}`}>Home</Link>;
}
