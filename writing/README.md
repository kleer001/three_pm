# writing/ — teen copy for 3pm

The dialogue the Merriton kids type in the BUDDY messenger (login greetings,
status messages, in-chat barks). A right-sized adaptation of the book_loom
editorial framework for one-liner copy instead of chapters.

## Files

- `voices.md` — the **Voice Bible**: house style (grounded in real teen-IM
  corpora) + a register card per hero. The source of truth for how each kid types.
- `lint.md` — period (200X / 2000–2009) anachronism bans + cringe/texture rules.
- `editors/` — four editor personas, each run as an isolated agent:
  - `voice.md` — does each line sound like its specific character? (name-stripped test)
  - `period.md` — is it authentic to 200X? (anachronism + texture)
  - `cringe.md` — adversarial: would a real teen clown this line?
  - `line-closer.md` — reconcile, compress to a ~5s read, lock.

## Pipeline

Mirrors book_loom's pre-filter → parallel readers → adversary → closer, minus the
novel-scale roles. Run editors as separate isolated agents (each sees only its
persona + the named inputs — no cross-editor contamination):

```
draft lines (against voices.md)
  → lint check (period bans, <3% texture rule)
  → Voice + Period editors   (parallel, isolated)
  → Cringe Advocate          (independent skeptic)
  → Line/Closer              (reconcile · compress · LOCK)
  → drop locked copy into art-test/msn-mock/final-comp.html
```

## Principles

- **Netspeak is rare.** Real teen IM was ~2.4% "IM forms" — mostly plain English.
  Over-abbreviated copy is the #1 tell of a fake. See `voices.md` Part 1.
- **Distinct voices.** Every line must pass the name-stripped test in
  `editors/voice.md`.
- **Nine good sentences** beat ninety mediocre ones. Keep the surface area small.
