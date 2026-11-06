# The weekly sheet

The page a league hands out before each night: what happened last week, where everyone stands, who is bowling whom this week with the
handicaps they will use, and every bowler's average and handicap with how they changed. It is built from the season's finalized scores,
so it is always current. Nothing is stored and there is nothing to set up.

Open it from **Weekly sheet** in the league menu (under *More*), from the **Week N sheet** button on the league home page, or from any
week page. Use the week picker or the previous/next buttons to open the sheet for any week. Like the rest of the league, the sheet is
visible to whoever can view the league (members, and guests of public or unlisted leagues).

## Getting it onto paper or into a chat

- **Share or save PDF** (phones and tablets): hands the sheet, as a PDF file, to the system share sheet, which can save it to Files, print
  it, or send it to a group chat. The PDF is fetched when the page opens, because browsers only allow sharing straight from a tap.
- **Open PDF**: the same PDF in a new tab. It is the fallback when the browser can't share files.
- **Print** (desktop browsers): the browser's print window, which also offers *Save as PDF*. It is hidden in a web app saved to a
  phone's Home Screen, because iOS ignores `window.print()` there: the button would do nothing.

The PDF is made on the server (`/l/<league>/sheet/pdf?week=N`, with `&season=` for an older season) from the same data as the page, so it
matches the printed page: last week, standings, matchups, averages and handicaps, in black and white on letter paper. It follows the same
visibility rules as the page, and is never kept in a shared cache.

## What is on it

1. **Last week.** Each finalized matchup of the most recent week that has results: every bowler's average and handicap going in, their
   games and series, then each side's total (with handicap when the league uses it) and the points earned, with a **W** for the winner.
   Below: the night's high game and high series, and a few highlights. A blind score for an absent bowler is marked **b**. Matchups that
   are not final yet are left off, with a note saying how many.
2. **Standings entering this week.** The usual standings, through last week, with the playoff line when the league has playoffs.
3. **This week's matchups.** Each side with its bowlers, average and handicap, and (for teams) rank and record. If nobody has been put in
   a lineup yet, the team's usual lineup is shown.
4. **Averages & handicaps.** Every bowler on the roster: games, average, the change in average since the week before, handicap for the
   week, the change in handicap, and season high game and high series. Substitutes appear once they have bowled; inactive bowlers do not.
5. **Coming up.** The next two weeks with their matchups.

The sheet is two pages on letter paper for a six-team league and flows onto more pages for bigger ones. On a phone it is a normal page
you scroll; nothing needs to be printed.

## Other league formats

- **Rotating partners.** This week's matchups are the drawn pairs (named from their lineup, "Alex & Sam"), then the extra comparison,
  then anyone sitting out. Before the draw it says partners are drawn at the start of the night. Pairs have no record of their own, and
  the standings list bowlers.
- **Handicap-setting weeks.** The sheet for a handicap week says everyone bowls scratch with no handicap, and lists no handicaps. The
  results of a handicap week show scores only, with no points and no winners, and the standings say they start after the handicap weeks.
  The sheet for the first week that counts shows the handicaps those scratch weeks set.
- **Individual leagues** list bowlers where teams would be.

## Where it lives

- `src/domain/sheet.ts` — `buildWeeklySheet(model, week)` gathers everything above as plain data.
- `src/components/weekly-sheet.tsx` and `src/app/l/[slug]/sheet/page.tsx` — the page; `src/components/sheet-actions.tsx` — the share, PDF and print buttons.
- `src/server/sheet-pdf.ts` and `src/app/l/[slug]/sheet/pdf/route.ts` — the PDF (built with `jspdf` and `jspdf-autotable`, which use the PDF standard
  fonts, so characters outside Latin-1 are replaced with a close letter or `?`).
- `.sheet-*` styles and the print rules (letter paper, no site chrome) are at the end of `src/app/globals.css`.
- Tests: `tests/sheet.test.ts` and `tests/sheet-service.test.ts` (team and partners leagues, handicap weeks), `tests/sheet-pdf.test.ts` (the
  PDF), and the sheet, PDF and share checks and accessibility audit in `e2e/handicap-weeks.mjs`.
