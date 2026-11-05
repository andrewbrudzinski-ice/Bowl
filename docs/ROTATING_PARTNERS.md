# Rotating partners

An optional format for a league. Instead of fixed teams, everyone bowling that week is paired with a new random partner, each pair
bowls against another pair, and **every bowler is ranked on their own points**. It is a rule setting like any other (Commissioner →
Settings → Rules → Format, or the "Rotating partners league" starter template when creating a league). Leagues that don't turn it on are
unaffected.

## A night, step by step

1. **Draw** (Commissioner → Schedule → *Draw partners*). Pick the week and tick who is bowling. The site pairs the bowlers at random and
   matches pairs against each other, then plays the draw as a short show (see below). Drawing again replaces the draw, until scores are
   entered for that week.
2. **Bowl and enter scores** as usual (Commissioner → Score entry).
3. **Finalize.** Standings update.

## Points

Points are the league's ordinary scoring settings, credited to **each partner** of a pair. The starter template uses:

| Setting | Template | Meaning |
| --- | --- | --- |
| Points for each game won | 2 | Both partners earn it. A tied game is split (`tieFraction`, half by default). |
| Points for winning the series | 1 | The pair with the higher total over all games. |

With three games a night that is **7 points at most** (3 × 2 + 1). Change either number in Settings → Rules → Games & scoring; the form
shows the new maximum. The other scoring options (bonus for the best single game or individual series, handicap, blind scores for
absentees, forfeits, bye points) work as they do in a team league, with a pair standing in for a team.

- A bowler who doesn't bowl a night (marked absent for every game) earns no points and isn't counted as playing, though their blind score
  still counts for their partner's pair.
- Standings rank bowlers by the usual tie-breaker list (default: points, wins, total pins, average). "Wins" is how often a bowler's pair
  won its matchup.

## How the draw works

- **Pairs.** Bowlers are paired at random, but nobody repeats a partner until they have run out of new partners. With 10 bowlers each has 9
  possible partners; in simulation a partnership is repeated within a 9-week season in about 1 season in 100. (An odd number of bowlers
  is a little less tidy, about 1 in 4.)
- **Matches.** Pairs are matched against each other at random, avoiding bowlers a pair has already faced.
- **An odd number of pairs, the extra pair.** Ten bowlers make five pairs, which can't all play head to head. The leftover pair — the pair
  that has been the extra pair least often — **bowls an extra comparison**: its scores are compared with another pair's scores from the same
  night, game by game and in total, using the normal scoring. **Only the extra pair earns points from it**; the pair it is compared with
  keeps exactly what its own match earned. Twelve bowlers make six pairs and three matches, with no extra pair.
- **An odd number of bowlers.** One bowler is left without a partner and sits out: whoever has sat out least so far (that bowler earns the
  league's bye points, none by default).
- The draw is reproducible: its seed is recorded in the audit log (`partners.drawn`).

### How an extra comparison is stored

A pair has no row of its own, and neither does the comparison. Each side of a drawn match gets a fresh id (the matchup's `sideA` /
`sideB`), and the name shown is built from the bowlers in its lineup: first names ("Alex & Sam"), or first name and last initial when
two bowlers share a first name. An extra comparison is a matchup whose B side *is the id of a pair that plays in another matchup that
week* (always that match's A side, which the database's uniqueness rules require). It has no scores of its own for that side: they are read
from the other matchup, so nothing is entered twice, and a substitute added there is picked up here automatically. Because there are no
team rows, **this feature needs no database migration**.

On the score-entry screen the extra comparison comes last, its other pair's scores are shown read-only, and it can only be finalized once
the other pair's matchup is final. Its other pair's games are never counted twice in anyone's averages, records or stats.

## Watch the draw

After drawing, the draw plays as a short show: a bowling ball rolls down a lane, the pins fly, and each pair is revealed one roll at a
time ("Match 1 — Riley & Quinn", then "against Sam & Avery"), then the extra pair, then anyone sitting out. A running list builds below
the lane. **Skip to the end** shows the finished list; **Replay** starts over. Anyone can watch it again from the *Up next* card on the
league home page, the week page, or (commissioners) the Schedule page.

- Everything on screen is a pure function of the drawn names and a clock (`src/domain/reveal.ts`), so it is unit-tested frame by frame and
  the same draw always plays the same way.
- People who prefer reduced motion get the finished list immediately.
- It works with the keyboard, announces each reveal to screen readers, and Escape closes it.

## What changes in a rotating-partners league

- **Navigation:** no *Teams* tab (the Teams page redirects to Standings). *Teams & roster* is called *Roster* and has no team controls.
- **Standings, timeline, history:** per-bowler. Records, awards and streaks that depend on a lasting team are left out.
- **Rules:** *Format* gets the rotating-partners switch; playoffs are not available (turning the option on switches them off).
- **Structural:** like the format itself, the setting can't be changed once scores exist. Apply it to a new season instead.
- The round-robin generator and "Add a matchup" are replaced by the weekly draw. A drawn matchup can't be moved (draw the week again); one
  that an extra comparison depends on can't be removed until the comparison is.

## Not included (yet)

- Playoffs.
- Per-bowler streak records.

## Where it lives

- `src/domain/partners.ts` — the draw, the history it reads, how an extra comparison is recognised (`guestLinks`) and how a pair is named.
- `src/domain/config.ts` — the `partners` rules block, validation, the starter template.
- `src/domain/engine.ts` — builds pair names and gives an extra comparison the other pair's scores; `src/domain/scoring.ts` — only side A
  earns points from it; `src/domain/standings.ts` — credits each bowler with their pair's points.
- `src/server/services/season.ts` — `drawWeekPartners`; `src/server/services/results.ts` — saving and finalizing an extra comparison.
- `src/domain/reveal.ts` and `src/components/draw-reveal.tsx` — the draw reveal.
- Tests: `tests/partners.test.ts` (draw, scoring, extra pair, standings, rules), `tests/partners-service.test.ts` (the whole flow on every
  store), `tests/draw-reveal.test.ts` (the animation), `e2e/partners.mjs` (a browser walk-through, including an accessibility audit).
