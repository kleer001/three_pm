# Playtesting & Launch-Readiness Roadmap

> **Status:** production/process guidance, **not** a frozen design spec. Unlike
> `00-index.md … 19-*.md` and `ENGAGEMENT.md` (the design contract), this doc
> freezes no interfaces and owns no game data. It's a research-backed playbook
> for taking *3pm* from a playable slice toward a public itch.io / GitHub Pages
> release.
>
> **Source caveat:** compiled from a fan-out web-research pass (June 2026). The
> fetch layer was 403-blocked environment-wide, so claims rest on search-result
> extracts rather than full-page reads, and the blog-reported percentages
> (D1 retention, "30% lost in the first minute," "~70% cited scope," etc.) are
> **directional**, not peer-reviewed. The blocked source URLs are listed at the
> end for local re-verification.

## 0. The one-paragraph version

*3pm* is at the highest-leverage moment: a playable core loop, before public
exposure. Spend it on three things. (1) **Watch ~5 fresh players per build**
silently descend while thinking aloud. (2) **Instrument a handful of telemetry
events** — above all *where each run ends* — through a cookieless analytics tool
embedded in the game's own `index.html`. (3) Treat the **first 30–60 seconds** as
the make-or-break design surface. The traps that kill projects like this aren't
bugs; they're **scope creep back toward the full 9-hero spec**, **marketing
started too late**, and mistaking *"my friends liked it"* for signal. The
free-browser/itch.io nature is a gift here: you can soft-launch and iterate in
public via **game jams**, the indie-web equivalent of Steam Next Fest.

---

## 1. Finding players you can watch play

### Where to recruit (ranked for a *free browser* game)

| Channel | Why it fits 3pm | Confidence |
|---|---|---|
| **itch.io game jams** (Demo Jam, "Playtest & Feedback Exchange Jam") | Deadline + audience + ranking; browser builds explicitly welcomed; trade feedback with co-jammers. Single best free distribution *and* recruitment event. | High |
| **r/playmygame** (+ r/IndieDev, r/IndieGaming sorted by **New**) | Purpose-built for "post your game, get feedback." The algorithm buries small devs on "Hot" — post to/sort by New. | High |
| **r/gamedev "Feedback Friday"** weekly thread | Canonical reciprocal-feedback ritual; a browser link is zero-friction. | High |
| **itch.io Playtesting board + devlogs** | Native surfaces; devlogs build an invested audience over months. | High |
| **TIGSource forums → Playtesting board** | Largest forum dedicated to indie creation; direct design/bug feedback. | Medium |
| **Discord** (your server's "Go Live" screenshare + a `#bugs` channel) | The practical *watch-them-play* venue once you have testers — but leaky for *recruiting* (people miss posts). | High |
| **Paid services** (PlaytestCloud, UserTesting ~$10/20min, GameTester ~$10–20/test) | Mostly mobile-oriented + unmoderated; GameTester lacks video. For a solo dev who wants to *watch*, free community recruiting + your own moderated sessions is the better fit. Verify WebGL/browser support per service. | Medium |

**Meta-tactic — fish where your players already swim.** Google
"[a roguelite similar to 3pm] + forum / community / Discord" and recruit there,
not only generic gamedev channels. Post to **one** community at a time and
iterate your recruiting message from the responses. **Collect emails into a
"panel"** (a standing list of people who've agreed to be called on later) rather
than funneling to Discord/Twitter — email reliably reaches testers, and a panel
lets you keep injecting fresh eyes without re-recruiting. Testers "get used up":
willingness drops the longer you wait after sign-up, so invite promptly.

### How to run a moderated session — the protocol

1. **Plan first.** Write *research objectives* and a *discussion guide* before
   anyone touches the build. Each session answers **one** main question
   (e.g., "Do they understand they must go south?").
2. **Think-aloud (concurrent verbalization).** Ask them to narrate actions,
   feelings, and motivation *as they play* — capture the "why" in the moment.
3. **Cardinal rule: shut up and watch. Don't help.** Your presence is unnatural;
   at launch you won't be there. Don't explain or defend. Intervene only if
   they're "really going off the rails." Every intervention injects an artificial
   element and destroys the data.
4. **Ask questions only in natural down-times,** never mid-intensity.
5. **Keep it to ~45–60 minutes** — key tasks + follow-ups without fatigue.
6. **Debrief immediately** while reactions are fresh, with *neutral, non-leading*
   questions (see §3).

**Remote vs in-person for a web game.** Remote (tester shares *their* screen over
Discord/Zoom) gives more *authentic* behavior — no lab effect, and you see real
input/latency/rendering on a play-from-home game. In-person wins for adapting on
the fly and digging into a shared struggle immediately. **Default to remote
Discord screenshare**; do a few in-person sessions for depth when you can.

### How many testers — and the "5 users" rule's real limits

- Nielsen's "**5 users find ~85% of usability problems**" (1993 formula) assumes
  **iterative rounds** with **comparable** users.
- **It understates what a *game* needs.** Games aren't single-task usability
  tests — fun, balance, difficulty, and emotional response vary far more than
  "can they find the checkout button." Empirically, groups of 5 have found as few
  as **55%** of problems, while no group of 20 found fewer than 95%.
- **Practical synthesis:** treat **~5 fresh testers per build** as "enough to
  catch glaring UX/control/onboarding breakage," **not** "enough to validate game
  feel or difficulty." For balance/feel, go larger (8–10 in-person; ~10+ online
  for a micro-trend; 20+ for any quantitative claim). Pair small qualitative
  sessions with larger telemetry "mass" tests.
- **Always include never-before-seen testers each round** — first-time confusion
  is the most illuminating signal because it mirrors real first players. Rotate
  the panel to avoid tester fatigue.

---

## 2. Getting good, honest metrics

### Qualitative: the bias problem is the whole problem

- **Friends/family give "sympathetic" feedback** that's systematically too nice,
  and sympathy scales with proximity: in-person > email > anonymous comment.
  Anonymous feedback is "unfiltered and better represents the general public"
  (Derek Yu). → *Weight a stranger's lukewarm reaction over a friend's
  enthusiasm.*
- **"Don't listen to users — watch what they do"** (NN/g's first rule).
  Self-reports suffer social-desirability bias, faulty memory, and post-hoc
  rationalization.
- **The medic/patient maxim:** players are *excellent at identifying that
  something feels wrong* but *unreliable at diagnosing the cause or proposing the
  fix*. A reaction is data; the explanation and suggested remedy usually aren't.
  Extract the underlying problem, then design your own solution. (Classic case:
  "weapons break too fast → increase durability" — real fix was lowering enemy
  HP.)
- **Vocal-minority + survivorship skew:** the loudest feedback comes from the
  most dissatisfied; happy players stay invisible; and you mostly hear from people
  who got far enough to have an opinion. *Actively seek out the people who quit
  early* — they're the ones telling you about your first 60 seconds.
- **Frequency threshold for acting:** one complaint = outlier, **three = a
  pattern, five = a certainty.** Log feedback across testers and prioritize by
  frequency × severity, not by who complains loudest. Separate subjective taste
  ("I didn't like the art") from objective failures ("I couldn't tell enemies
  from the background") — *the latter is directly relevant to 3pm's
  cartoon-hellscape readability.*

### Survey design (administer within ~30 min of play, to beat recall bias)

- **SUS** (10-item Likert) is fast and validated but measures *usability, not
  fun*, and won't tell you *why* — players can hit severe problems and still score
  it high.
- **GEQ** (Game Experience Questionnaire) scores Immersion/Flow/Competence/
  Affect/Tension/Challenge — closer to what matters; designed for immediate
  post-session use.
- **Prefer open-ended, own-words questions** over agree/disagree Likert items,
  which inflate support via acquiescence bias.
- **Avoid leading/compliment-fishing phrasing.** Not "What did you love?" but
  "What worked, and what would you change?" A targeted prompt —
  **"What was the single most frustrating moment?"** — gives an easy channel for
  honest criticism.
- **Two traps:** **"Would you pay for this?"** — stated purchase intent correlates
  poorly with real buying (overstated ~40%); for a free game, doubly meaningless.
  And **NPS / "would you recommend"** can *invert* in games (people report
  disliking a game yet keep playing) — behavior beats sentiment.

### Measuring "fun" — behavioral proxies, not "was it fun?"

Fun is hard to measure directly; triangulate. **Engagement tells:** leaning in,
eyes locked, "one more run," losing track of time. **Boredom tells:** reaching
for the phone, leaning back, looking away. Best indirect debrief question:
**"How long did it feel like you were playing?"** — if it felt shorter than it
was, they were enjoying it.

### Quantitative telemetry for a static itch.io / GitHub Pages site

**Instrument tiny (ship these before public playtests):** run-start, a
**per-distance-band progression funnel** (how far south before death/quit — this
*is* the death heatmap, keyed on Y-position), tutorial/first-run completion,
**win-conversion** (reached home), and session length. The funnel tells you the
exact band where players abandon; adjust difficulty there and re-measure
completion.

**Tools** (all embed in the game's *own* `index.html`, so they survive both
itch's iframe and GitHub Pages):

| Tool | Custom events? | Free tier | Notes |
|---|---|---|---|
| **PostHog** | Yes (funnels + session replay) | 1M events/mo + 5k replays | Richest; 5-line JS; cookieless mode removes the consent banner. **Top pick.** |
| **Umami** (cloud/self-host) | Yes (basic funnels/retention) | 100k events/mo | Lighter footprint; cookieless. |
| **Plausible** | Yes | ~$9/mo (self-host free) | Clean, but bills custom events as pageviews. |
| **GoatCounter** | Limited | Free non-commercial | Mostly counts; weak on rich events. |
| **Cloudflare Web Analytics** | **No** | Free | Pageviews only — won't see gameplay events. |
| **itch.io built-in / GA hook** | **No** | — | **Gotcha:** itch's analytics *don't even count HTML5 "Run game" launches*, and inject GA only at page level. For in-run events you **must** embed analytics inside the game HTML yourself. |

**DIY option:** `POST` to a **Cloudflare Worker → Supabase** sink — free, no
cold-start, full event control.

**Privacy:** going **cookieless** with no persistent identifiers means **no
GDPR/ePrivacy consent banner** required — the cleanest path for a hobby game
(cookie-based analytics like GA4 *do* trigger a banner; enforcement is real —
a €15k fine for a bad banner in 2024).

**Interpret with care:** the descent funnel is a **textbook survivorship-bias
trap** — later-band events only fire for players who survived earlier bands, so
always normalize "reached band N" against *runs started*, and **explicitly log
the death/quit event itself**, not just successes. Indie traffic is almost always
below A/B-significance thresholds (~10k visitors / 300 conversions per variant) —
favor descriptive funnels over significance testing.

---

## 3. Roadmaps, gotchas & failure modes

### The development milestone ladder (and where 3pm sits)

- **Prototype** → proves you *should* make it; rough, placeholder, tests the core
  *feeling*. "This is what it'll feel like, not look like."
- **Vertical slice** → a small section at *near-final quality*; proves you *can*
  make it under real production constraints. **3pm's `src/` is already structured
  as a vertical slice — the recommended posture.** ⚠️ The "vertical-slice trap":
  it can eat 6+ months and is often mistaken for a pitch tool; keep it tiny and
  representative.
- **Alpha = feature-complete** ("horizontal slice"): all features in, playable
  start-to-finish; **no large content added after this.**
- **Beta = content-complete / content-locked:** all assets in; only polish,
  bug-fix, optimize — no new features.
- **Release candidate / gold:** no critical/visible bugs; playable by any novice.

### When and how often to playtest

- **Start the moment it's playable** — "your core loop is not fun until players
  confirm it is." If you can state the experience you want feedback on, you're
  ready *now*.
- **Goal shifts by stage:** early = *is the loop legible and fun?* (the test:
  after the intro, do they self-direct or ask "what do I do now?"); late =
  balance, difficulty, bugs, polish.
- **Cadence:** ~**monthly** structured sessions + an ad-hoc test after every
  **major change** and before each milestone build. **Change one variable at a
  time, then re-test the exact thing you changed.**

### The first 60 seconds — highest-leverage design work

- Games can lose **~30% of players in the first minute**; baseline retention is
  brutal (most players never return after Day 1).
- Deliver **"time to first fun" within 30–60 seconds** — a small tangible
  victory. For 3pm that's a **first kill, first powerup, or surviving the first
  camera-crush.** Completing one meaningful first action is the strongest
  predictor of long-term retention.
- **Tutorials are a top drop-off point** — keep any tutorial under ~5 min and
  skippable; for a roguelite, prefer teaching through the first run itself.

### Roguelite-specific tuning

- **Make the early game forgiving, ramp later** (Hades/Dead Cells). Classic
  failure: changing difficulty for late-game balance and over-punishing
  newcomers — or the Darkest Dungeon trap (hard start → then boring). Pick a
  deliberate baseline for how hard the *start* should feel.
- **Consider player-selected difficulty** (Slay the Spire's Ascension ladder) so
  newcomers start easy and unlock harder tiers.
- **RNG fairness = players feel they won/lost by *choices*, not luck.** Keep
  randomness but preserve agency and multiple viable builds; "predictable
  randomness" reads as fair.
- **Watch for content-thinness:** the same enemy back-to-back instantly reads as
  "this game lacks content" — relevant to a small roster. Distribute spawns to
  avoid repetition.
- **Keep runs short enough that a bad run isn't catastrophic** (the Returnal
  cautionary tale: 2-hour runs + punishing RNG = wasted-evening feel). The
  one-day descent structure already helps here.

### Why projects fail (the things devs wish they'd known)

- **Scope creep is the #1 killer** — cited by ~70% of failed indie devs; it
  starves the core of polish. *"A finished imperfect game beats a perfect
  unfinished one."* **3pm's specific risk: scope-creeping back toward the full
  9-hero / full-combat spec.** Defend the core loop ruthlessly; park new ideas in
  a list instead of building them.
- **Marketing too late** — by "almost finished" it's too late. Start *the moment
  you have something shareable*; devlogs build an invested audience over months.
  Most attention lands in the first two weeks, so the audience must exist
  *beforehand*.
- **Building in a vacuum** — "if I like it, others will" without validation is the
  core market-fit error.
- **Vanity metrics** — follower/wishlist counts ≠ engagement ≠ success. A real
  community is interaction, not numbers.
- **Burnout** — scope creep → burnout → failure is "a simple, brutal equation."
  Sustainable short sessions beat crunch; the vertical-slice posture protects you.
  Beware the sunk-cost drift into measuring self-worth by projected numbers
  instead of *finishing*.

### Discoverability for a *free browser* game (wishlist-equivalents)

The paid-Steam wishlist machinery doesn't apply. The levers are: **game jams**
(the biggest — pick a jam theme you can bend the descent concept into),
**ratings + "top-rated free" lists**, **curated collections**, **devlogs**,
**forums**, and **streamers/YouTubers** (put a *playable build* in their hands —
"a streamer can't play screenshots"). itch.io's **"Limited Playtests &
Releases"** access controls give native closed→open beta staging, and a **soft
launch on itch** (read metrics, iterate via devlogs) is the recommended quiet
first step.

---

## 4. Concrete next-30-days plan

> **⚠️ TODO / not yet done — the analytics snippet.** The telemetry *code* is
> already wired (`src/run/telemetry.js` + `runScene.js` emit `run_start` /
> `band_reached` / `run_end`), but it stays a **no-op until the PostHog snippet is
> pasted into `index.html`** — deliberately left out for now. Until then the game
> logs `[telemetry] disabled` and sends nothing. **To switch it on later:** follow
> `playtest-session-kit.md` §5 (create a PostHog project, paste the loader +
> `posthog.init(..., { persistence: 'memory' })` into `index.html`, deploy). Gate
> it to the deployed Pages/itch host if you don't want events from localhost.

1. **Turn on the 5 events** — the code is done; the only remaining step is the
   **PostHog snippet in `index.html`** (see the TODO above + kit §5). Then normalize
   everything against runs-started.
2. **Recruit a panel of ~8–10** via r/playmygame (New), a r/gamedev Feedback
   Friday post, and target-game communities; collect emails.
3. **Run 5 moderated remote sessions** (Discord screenshare, think-aloud, *stay
   silent*), one question each, focused on the **first 60 seconds** and "do they
   know to go south?"
4. **Survey within 30 min:** GEQ-lite + "single most frustrating moment" + "how
   long did it feel?" Never ask "would you pay."
5. **Act only on patterns of ≥3.** Re-test the exact thing you changed.
6. **Tune the opening:** guarantee a visible win in ~30s; make the early descent
   forgiving.
7. **Pick a jam** (Demo Jam / Playtest Exchange Jam) as the soft-launch moment.

---

## Appendix: source URLs to re-verify locally

The research fetch layer returned **403 across the board** (an environment proxy
block, *not* site paywalls), so these were read via search summaries only. Open
locally to confirm exact wording — especially the primary sources and the
blog-reported percentages (treat D1-retention, "30% in first minute," "70% cited
scope," "50k wishlists/5% convert" as *directional blog figures*).

**Playtesting / sessions / 5-user rule**
- nngroup.com/articles/why-you-only-need-to-test-with-5-users/
- nngroup.com/articles/first-rule-of-usability-dont-listen-to-users/
- start.playtestcloud.com/blog/moderate-your-first-playtest
- antidote.gg/a-players-guide-to-think-aloud-comments/
- antidote.gg/remote-vs-in-person-playtesting-which-one-should-you-choose/
- stevebromley.com/blog/2015/01/06/some-things-ive-learned-about-moderating-playtesting-sessions/
- gamesuserresearch.com/find-usability-issues-in-games-with-playtests/
- gamesuserresearch.com/choose-the-right-playtest-method/
- gamesuserresearch.com/find-the-fun-measuring-enjoyment-in-games-user-research/
- gamesuserresearch.com/when-should-i-run-playtests/
- gamesuserresearch.com/a-simple-process-to-find-playtesters/
- gamesuserresearch.com/how-many-players-do-i-need-for-a-playtest/
- gamesuserresearch.com/expert-playtest-moderation-ask-unbiased-questions/
- cs.cornell.edu/courses/cs3152/2020sp/lectures/23-Playtesting.pdf
- gamedeveloper.com/programming/6-steps-to-a-successful-playtesting-process-for-an-indie-developer
- gamedeveloper.com/business/10-insightful-playtest-questions
- schellgames.com/blog/the-definitive-guide-to-playtest-questions

**Telemetry / analytics**
- gamineai.com/blog/the-first-10-telemetry-events-every-indie-game-should-ship-and-why
- gameanalytics.com/blog/top-visualizations-for-game-telemetry-data
- gameanalytics.com/blog/exploring-gaming-funnels
- docs.gameanalytics.com/products-and-features/analytics-iq/funnels/
- itch.io/updates/you-can-now-use-google-analytics-with-itchio
- itch.io/docs/creators/analytics
- github.com/itchio/itch.io/issues/822 (HTML5 launch not tracked)
- github.com/itchio/itch.io/issues/626
- plausible.io/cookieless-web-analytics
- plausible.io/blog/cookie-consent-banners
- plausible.io/docs/custom-event-goals
- posthog.com/blog/best-gdpr-compliant-analytics-tools
- posthog.com/pricing
- umami.is/docs/track-events
- goatcounter.com
- developers.cloudflare.com/web-analytics/faq/
- supabase.com/docs/guides/functions
- en.wikipedia.org/wiki/Survivorship_bias

**Feedback / surveys**
- derekyu.com/makegames/feedback.html ("sympathetic feedback")
- nngroup.com/articles/first-rule-of-usability-dont-listen-to-users/
- alexiamandeville.medium.com/how-to-ignore-playtesting-feedback-to-improve-your-game-f7238af55c3f (medic/patient)
- gamedeveloper.com/business/how-to-design-a-survey-for-user-feedback
- gamedeveloper.com/game-platforms/4-tips-from-game-maker-s-toolkit-to-help-you-evaluate-community-feedback
- stonemaiergames.com/distilling-feedback-in-game-design-and-business/
- pure.tue.nl/ws/files/21666907/Game_Experience_Questionnaire_English.pdf (GEQ)
- measuringu.com/sus/
- nature.com/articles/s41598-025-28640-z (NPS inversion)
- conjointly.com/guides/positive-negative-open-ended-feedback-question/
- cambri.io/resources/is-purchase-intent-a-reliable-predictor-of-sales

**Failure modes / milestones / roguelite**
- gameworldobserver.com/2023/11/22/game-production-stages-prototype-alpha-beta-ship-tim-cain (Tim Cain's stages)
- tonogameconsultants.com/vertical-slice/
- ltpf.ramiismail.com/prototypes-and-vertical-slice/
- indieop.com/blog/how-to-run-your-first-indie-game-playtest-and-actually-get-useful-feedback
- gamedeveloper.com/business/the-cure-for-indie-game-failure
- gamedeveloper.com/business/postmortem-of-my-first-indie-game
- gamedeveloper.com/business/the-last-humble-bee-postmortem-staying-sane-in-solo-development
- gamedeveloper.com/marketing/game-developer-podcast-36-indie-marketing-advice-from-chris-zukowski
- wayline.io/blog/scope-creep-solo-indie-game-development
- wayline.io/blog/solo-dev-roadmap-building-games-without-burning-out
- wayline.io/blog/how-can-indie-developers-effectively-playtest-their-games
- iabdi.com/designblog/2026/1/13/ (first-60-seconds)
- maf.ad/en/blog/game-retention/
- gridsagegames.com/blog/2017/02/adjustable-difficulty/ (Cogmind on difficulty)
- gamedeveloper.com/design/balancing-inverse-difficulty-curves-in-game-design
- gamedevreports.substack.com/p/how-to-market-a-game-steam-in-2024 (Steam 2024 stats)
- itch.io/docs/creators/limited-releases
- itch.io/jam/the-demo
- itch.io/jam/playtest-and-feedback-exchange-jam-by-indie-playtest-fest
