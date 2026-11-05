# Rotating partners

An optional format for a league. Instead of fixed teams, everyone bowling that week is paired with a new random partner, each pair
bowls against another pair, and **every bowler is ranked on their own points**. It is a rule setting like any other (Commissioner →
Settings → Rules → Format, or the "Rotating partners league" starter template when creating a league). Leagues that don't turn it on are
unaffected.

## A night, step by step

1. **Draw** (Commissioner → Schedule → *Draw partners*). Pick the week and tick who is bowling. The site pairs the bowlers at random and
   matches pairs against each other. Drawing again replaces the draw, until scores are entered for that week.
2. **Bowl and enter scores** as usual (Commissioner → Score entry). Each match is two pairs; a pair's score is its two bowlers added together.
3. **Finalize.** The pair with the higher total wins the match. Standings update.

## How the draw works

- Matches are two pairs, so the bowlers who bowl are a multiple of four. With 10 bowlers that is 8 bowling and 2 sitting out; with 12,
  all 12 bowl. Whoever is left over **sits out**, chosen from the bowlers who have sat out least so far, so sitting out is shared evenly
  among the bowlers drawn (in simulation, with the same ten bowlers every week, nobody is ever more than one sit-out ahead of anyone else).
- **Partners** are random but a partnership isn't repeated while there are new partners to try. With 10 bowlers each bowler has 9
  possible partners; in simulation a partnership repeats within a 9-week season in fewer than 1 season in 20.
- **Opponents** are random but avoid bowlers a pair has already faced.
- The draw is reproducible: its seed is recorded in the audit log (`partners.drawn`).
- A pair is not a stored team. Each side of a drawn match gets a one-week id, and the name shown is built from the lineup's first names
  ("Alex & Sam", or "Sam C. & Sam P." when two bowlers share a first name). Renaming a bowler, or swapping a substitute into the lineup,
  changes the name everywhere with nothing to keep in sync. Because there are no team rows, this feature needs **no database migration**.
- A bowler who sits out has a one-person "bye" matchup, which is how the draw remembers who has rested.

## Points (all configurable)

| Setting | Default | Meaning |
| --- | --- | --- |
| Points each partner earns for a win | 2 | Both bowlers in the winning pair earn this. |
| Points each partner earns for a tie | 1 | Tied match (equal combined totals). |
| Bonus: highest pin count of the night | 1 | See below. Set 0 for none. |
| The bonus goes to | The bowler with the highest series | Or: both partners of the pair with the highest combined total. |
| Pins counted for the bonus | Raw pins (scratch) | Or: whatever decides matches (handicap-adjusted when handicap is on). |
| Points for a bowler who sits out | 0 | Paid to each bowler who sits out. |

- **What decides a match** is the pair's combined total over all games, on the league's scoring basis (handicap-adjusted when handicap is
  on, otherwise scratch). It is the series total, not games won, so per-game and per-series points don't apply in this format.
- **The bonus is decided per night and only once every match of that night is final**, so it never jumps from one bowler to another
  while scores are still coming in. Ties share the point.
- **A bowler who doesn't bowl a night** (marked absent for every game) earns no points that night and isn't counted as playing, though
  their blind score still counts for their partner's pair.
- Standings rank bowlers by the usual tie-breaker list (default: points, wins, total pins, average). They show wins-losses of each
  bowler's pair, points, and a *Bonus* column once anyone has earned a bonus.

## What changes in a rotating-partners league

- **Navigation:** no *Teams* tab (the Teams page redirects to Standings). *Teams & roster* is called *Roster* and has no team controls.
- **Standings, timeline, history:** per-bowler. Records, awards and streaks that depend on a lasting team are left out.
- **Rules:** *Format* gets the rotating-partners switch; *Games & scoring* shows partner points instead of game/series points; playoffs
  are not available (turning the option on switches them off).
- **Structural:** like the format itself, the setting can't be changed once scores exist. Apply it to a new season instead.
- The round-robin generator and "Add a matchup" are replaced by the weekly draw; moving or removing a drawn matchup still works.

## Not included (yet)

- A night where **all pairs bowl and are ranked against each other** (no head-to-head matches, nobody sits out). Matches are always
  pair vs pair.
- Playoffs.
- Per-bowler streak records.

## Where it lives

- `src/domain/partners.ts` — the draw, the history it reads, and how a pair is named (pure, seedable, unit-tested).
- `src/domain/config.ts` — the `partners` rules block (`partnersSchema`), validation, the starter template.
- `src/domain/scoring.ts` — a pair match is decided on the combined total; `src/domain/standings.ts` credits each bowler and applies the
  nightly bonus; `src/domain/engine.ts` builds the pair names into the season model.
- `src/server/services/season.ts` — `drawWeekPartners`.
- `src/components/partner-draw-form.tsx`, `src/app/l/[slug]/admin/schedule/page.tsx` — the draw screen.
- Tests: `tests/partners.test.ts` (draw, scoring, standings, rules), `tests/partners-service.test.ts` (the whole flow on every store),
  `e2e/partners.mjs` (a browser walk-through, including an accessibility audit).
