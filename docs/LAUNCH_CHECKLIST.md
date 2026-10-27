# Launch checklist

Tick each item on the production site, not on your laptop.

## 1. Environment
- [ ] Host has a **persistent volume** and runs **one** instance.
- [ ] `SESSION_SECRET` set (32+ random chars), `APP_URL` is the final `https://` URL, `BOWL_DATA_FILE` points at the volume.
- [ ] HTTPS works on the custom domain; HTTP redirects to HTTPS.
- [ ] (Optional) Email provider variables set and a reset email actually arrives.
- [ ] `npm ci && npm run lint && npm test && npm run build` pass on the release commit.

## 2. First owner
- [ ] Register your account at `/register`. There is no separate admin signup: whoever creates a league is its owner.
- [ ] Sign out and back in; confirm password reset works (`/forgot`).

## 3. Create and configure the league
- [ ] `/leagues/new` → walk the wizard; use the live handicap example to sanity-check your base and percentage.
- [ ] On the review step, read every sentence against your league's actual rules. Edit anything wrong.
- [ ] Commissioner → Settings → Visibility: choose private / unlisted / public.

## 4. Roster and schedule
- [ ] Add teams and bowlers with entering averages (or import CSVs; download the templates first).
- [ ] Generate the schedule; read the warnings (byes, unbalanced weeks). Check dates.

## 5. Test the calculations with a dummy night
- [ ] Score entry for week 1: type a few scores, confirm handicaps match your hand calculation (click a handicap number for the breakdown).
- [ ] Confirm the result preview, points and winner match your rules. Try an out-of-range score and a missing score; confirm the warnings.
- [ ] **Preview & finalize** one matchup; open its matchup page and confirm the explanation matches.
- [ ] Standings updated as expected. Correct a score (reason + confirmation) and confirm standings recalculate and the audit log shows before/after.

## 6. Permissions & isolation
- [ ] Invite a second account as *Scorekeeper* and another as *Viewer*; confirm the scorekeeper can enter but not finalize or change settings; the viewer can only read.
- [ ] Revoke one; confirm access disappears immediately.
- [ ] Create a second dummy league; confirm none of the first league's data appears, and that its links 404 for non-members.
- [ ] If public/unlisted: open the link in a private window; confirm only standings/results/profiles show — no admin, members or audit.

## 7. History and rules versions
- [ ] Change the handicap % **from a future week** (preview it first). Confirm week 1 results didn't change and the rules page shows version history.
- [ ] Start a throwaway second season; confirm the first season's standings and rules are untouched.

## 8. Mobile
- [ ] On a real phone: home, standings, a matchup page, a bowler profile, and score entry (touch keyboard, auto-advance, Save drafts). Install to the home screen.

## 9. Backups
- [ ] Schedule `npm run db:backup` and off-machine copy (see BACKUPS.md). Confirm a backup file appears.
- [ ] Restore a backup into a scratch location and a league export into a throwaway account; compare standings.

## 10. Before inviting real people
- [ ] Delete the dummy league(s) and any **demo data** (Commissioner → Seasons → *Remove demo league*, or archive a test league).
- [ ] Re-read the rules page as a bowler would. Post a welcome announcement.
- [ ] Send invitations; confirm each person lands in the right role.
