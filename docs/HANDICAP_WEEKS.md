# Handicap-setting weeks

The first few weeks of a season can be set aside for setting handicaps. Everyone bowls **scratch**, the scores go into the site like any
other week, and they **count toward each bowler's average and handicap, but not toward points, wins or the standings**.

Turn it on in Settings → Rules → Handicap ("Handicap-setting weeks at the start"), or in the Handicap step when creating a league. Enter
the number of weeks (0 for none, up to 12). It works for every format, not only rotating partners.

## What happens in those weeks

- **The draw, pairs and matchups work as usual** (for a rotating-partners league), and score entry, saving and finalizing are the same.
- **Scratch, no handicap.** Matchups are decided on raw pins. Handicap isn't shown or applied, and handicaps stored when a setting-week
  matchup is finalized are zero.
- **Averages and handicaps.** Every game bowled counts. From the first counted week, handicaps are calculated from the averages the site
  has recorded (by default the entering average is used until three games have been bowled, so after one setting week it is the bowler's
  own average).
- **Not counted:** points, wins and losses, standings, rank movement, win streaks, records and awards that depend on a matchup result.
- **Still counted:** personal stats and personal bests (average, high game, high series), since those are real scores.
- **Labels.** Each such week is marked "HANDICAP WEEK" on the schedule, week page, timeline, score entry and on its matchup cards, which
  show "no points". The standings page says which weeks weren't counted and, until the first counted week is final, that the standings
  haven't started.

## Rules of the setting

- The setting weeks are the first N **regular** weeks (week 1 up to week N). Playoff weeks are never setting weeks.
- It follows the rules in force that week: if the number is changed from week k, weeks from k on use the new number. Finalized matchups
  keep the rules they were played under.
- Changing it shows up in the rule-change preview as a change to standings and handicaps, with the usual confirmation for history.
- Leagues whose rules never mentioned it behave exactly as before (no setting weeks).

## Where it lives

- `src/domain/config.ts` — the `handicapSetting` rules block, `settingWeekConfig` (the scratch version of the rules).
- `src/domain/engine.ts` — `isSettingWeek`, and scoring those weeks scratch; `src/domain/standings.ts`, `stats.ts`, `awards.ts` — leaving
  them out of standings, streaks and matchup awards.
- Tests: `tests/handicap-weeks.test.ts`, `tests/handicap-weeks-service.test.ts` (every store), `e2e/handicap-weeks.mjs`.
