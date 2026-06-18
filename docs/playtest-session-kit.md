# Playtest Session Kit

> Hand-tools for a moderated *3pm* playtest: a recruiting message, a session
> script, a debrief, a one-page survey, and the analytics setup that activates the
> telemetry already wired into `src/run/runScene.js` via `src/run/telemetry.js`.
> Companion to `docs/playtesting-and-launch-roadmap.md` (the why); this is the how.
>
> Process doc, not a design spec.

---

## 1. Recruiting message (copy-paste, edit the bracket)

> **[3pm] — a 5-minute browser roguelite, looking for fresh eyes**
> It's 3pm and the suburb has gone wrong. You're a 16-year-old walking home
> south before dark, and the dark is catching up. One run ≈ 5 minutes, plays in
> the browser, no install: **[link]**
> I'm watching how the first minute lands. If you'll play once on a call while
> talking out loud, or just play and fill a 2-minute form after, I'd owe you one.
> Reply or DM and I'll send a time.

Post to **one** community at a time (r/playmygame sorted *New*, r/gamedev Feedback
Friday, a roguelite Discord), then refine the wording from the replies before the
next. Collect emails into a standing **panel** so you can re-invite fresh testers
without re-recruiting. Invite promptly — willingness decays after sign-up.

---

## 2. Moderated session script (~30–45 min, remote Discord screenshare)

**Goal of THIS session:** one question only. Default: *"In the first 60 seconds, do
they understand they must go south, and do they get a win?"* Write your question
here before you start: `__________________________`

**Setup (2 min).** Tester shares **their** screen (so you see their real input,
framerate, and reading speed). Confirm audio. Then say, verbatim-ish:

> "This is a rough build — you can't hurt my feelings, and anything confusing is
> my bug, not your mistake. Please **think out loud**: say what you're looking at,
> what you expect, what you're trying to do. I'm going to be mostly silent and I
> **won't help** — that's on purpose, because I won't be there when other people
> play. Just play like you found it on your own."

**During play — the moderator's job is to SHUT UP AND WATCH.**
- **Don't help. Don't explain. Don't defend.** Every time you jump in, you've
  destroyed the data — you've turned a real first-time player into a guided one.
  Only step in if they're truly stuck/softlocked for ~30s+.
- If they go quiet, prompt for narration, not direction: *"What are you thinking
  right now?"* — never *"Did you see the X?"*
- Ask questions only in natural **down-times** (between runs), never mid-fight.
- **Take timestamped notes of behavior, not opinions:** where their eyes go first,
  the moment they understand "go south," the first death and what caused it,
  where they hesitate, where they light up or sigh. Note *what they did*; you'll
  ask *why* in the debrief.
- Watch the **engagement tells**: leaning in, "ok one more," losing track of time
  = good. Reaching for the phone, leaning back, flat narration = trouble.
- Let them play 2–3 runs if they want the "one more" — that itself is signal.

**Hard rule reminder:** their *reaction* is gold; their *diagnosis and proposed
fix* usually aren't. Note the reaction now; design the fix later (see §4 Q on root
cause).

---

## 3. Debrief (5 min, immediately after — reactions fade fast)

Ask open, neutral, non-leading questions. Let silences breathe.

1. "Walk me through what the game is about — what were you doing?" *(loop legibility:
   can they describe it in loop terms?)*
2. "What was going through your head in the **first 30 seconds**?"
3. "**What was the single most frustrating moment?**" *(the easy channel for honest
   criticism)*
4. "Was there a moment it clicked, or felt good? When?"
5. "**How long did it feel like you were playing?**" *(felt-shorter-than-real ⇒ they
   were enjoying it)*
6. If they propose a fix ("you should add X"): "What problem would that solve for
   you?" — capture the *problem*, not the prescription.
7. "Anything you expected to be able to do that you couldn't?"

**Do NOT ask:** "Did you have fun?" (invites politeness) · "Would you pay for this?"
(stated intent ≠ behavior, and it's free anyway) · "Did you like the art/controls?"
(leading; watch instead). Weight a stranger's lukewarm reaction over a friend's
enthusiasm.

---

## 4. One-page post-play survey (send within ~30 min)

Keep it to one screen. A Google Form works; mirror these fields.

**A. Quick scales (1 = strongly disagree … 5 = strongly agree)** — a GEQ-lite slice:
- I always knew what I was supposed to do.
- I always knew *why* I died.
- The controls did what I expected.
- I could tell enemies apart from the background. *(readability — the hellscape risk)*
- The early game felt fair.
- I wanted to start another run.
- I lost track of time while playing.

**B. Open-ended (the signal lives here):**
- The single most frustrating moment was… 
- The moment it felt best was… 
- One thing I expected to work but didn't… 
- If I described this game to a friend, I'd say… 

**C. Context (one line each):** runs played · furthest you got (the watch shows a
"home in %") · device + browser · did anything break/lag?

**Reading the results:** act on **patterns**, not single voices — *one complaint =
outlier, three = a pattern, five = a certainty.* Prioritize by frequency × severity.
Separate subjective taste ("disliked the art") from objective failures ("couldn't
tell enemies from the floor"). Change **one thing**, then re-test that exact thing.

---

## 5. Turning on telemetry (activates the code already in the game)

`src/run/runScene.js` already emits these via `src/run/telemetry.js`. They do
**nothing** until the page provides `window.posthog`, so local dev and the public
build can differ just by the snippet. Cookieless ⇒ no consent banner.

**Events emitted (flat props, PostHog-friendly):**

| Event | When | Key props |
|---|---|---|
| `run_start` | a descent begins | `run_id, hero_id, weapon, party_size, seed` |
| `band_reached` | first entry into each 1/10th of the way home | `run_id, hero_id, band` (1–10), `t_s` |
| `run_end` | death **or** reaching home | `run_id, won, cause, distance_frac` (0–1), `band`, `kills`, `duration_s` |

`run_id` correlates one run's events into a **funnel**; `band_reached` is your
**descent drop-off curve**; `run_end {won, distance_frac, cause}` is the **death
heatmap + win-conversion**.

**Setup (PostHog free tier — 1M events/mo):**
1. Create a project; copy your project API key + host.
2. Paste PostHog's JS loader snippet into `index.html` (in `<head>`), then add
   `posthog.init('<KEY>', { api_host: '<HOST>', persistence: 'memory' })`
   — `persistence: 'memory'` keeps it cookieless (no banner needed).
3. Deploy. Because the snippet lives in *your* `index.html`, it runs inside the
   itch.io iframe and on GitHub Pages alike. **Gotcha:** itch.io's own analytics
   don't even count HTML5 "Run game" launches and only inject GA at page level —
   in-run events must come from your own page, which this is.
4. Verify locally first: open the console — `[telemetry] disabled` means no
   snippet (expected on dev); once the snippet is in, watch events land in
   PostHog's Activity/Live view.

**Reading it without fooling yourself:** the descent funnel is a textbook
**survivorship-bias trap** — `band_reached(8)` only fires for runs that survived
bands 1–7. Always normalize "reached band N" against **run_start** count, and read
`run_end {won:false}` (with `cause` + `distance_frac`) to see *where and why* runs
die, not just where survivors got to. Indie traffic is usually below A/B
significance, so trust the *shape* of the drop-off, not 2-decimal conversion deltas.

**Lighter alternative:** swap the PostHog snippet for Umami's (100k events/mo free,
also cookieless) — `telemetry.js` only needs `window.posthog.capture`, so point a
2-line shim `window.posthog = { capture: (e, p) => umami.track(e, p) }` at it, or
edit `sink()` to call `window.umami` directly.

---

## 6. Session checklist

- [ ] One question written down before the session
- [ ] Tester shares their screen; think-aloud explained; "I won't help" said
- [ ] You stayed silent and took behavior notes (not opinions)
- [ ] Debrief done immediately; root-cause asked for any proposed fix
- [ ] Survey sent within 30 min
- [ ] Findings logged against prior testers; acted only on patterns of ≥3
- [ ] Changed one thing → scheduled a re-test of that exact thing
