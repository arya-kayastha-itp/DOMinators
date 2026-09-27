# 3-Minute Submission Video Script

Hard cap: **3:00**, judges stop watching after that. Target cut: **0:60 intro
max, 2:00+ solution on screen**, per the hackathon brief. This is the video
script — `DEMO_SCRIPT.md` is the longer live/in-room version; this file
compresses it and adds the required "how we used IBM Bob" beat.

**Narration pace:** ~150 wpm. Word counts below are budgets, not scripture —
cut for time before you cut for style.

---

## 0:00–1:00 — Intro (≤60s)

### 0:00–0:15 — Hook (~35 words)
**Screen:** Title card, then the live legacy Fleet view (AWS console or
dashboard Fleet tab), zoomed on a couple of real apps.

**Say:**
> "Thousands of apps sitting on an old AWS estate — open SSH ports,
> unencrypted disks, deprecated images. Moving them by hand: three to four
> years. We built an AI accelerator that does it in minutes, safely."

### 0:15–0:35 — The four agents (~55 words)
**Screen:** Architecture diagram or the `/journey` landing page pipeline
animation — Discovery → Planning → Blueprint → Cutover.

**Say:**
> "Four agents, one pipeline. Discovery scans the legacy account and scores
> every app's risk. Planning sequences a thousand apps into waves by
> dependency. Blueprint rewrites each one onto a hardened Terraform pattern.
> Cutover shifts real traffic — 10, 50, 100 percent — and rolls back
> automatically if anything breaks."

### 0:35–1:00 — Built with IBM Bob (~55 words)
**Screen:** Cut to actual Bob session transcripts (`BOB_Sessions/`) —
screen-record scrolling through 2–3 real sessions (e.g. the Blueprint agent
build, the fake-ALB harness, the orchestrator wiring). Overlay text: **"Built
with IBM Bob."**

**Say:**
> "We built this whole system with IBM Bob — it scaffolded our orchestrator,
> wrote the Terraform blueprint generator, built the test harness we used
> before we ever touched real AWS, and helped wire the live console you're
> about to see. Bob didn't just suggest code — it drove the build, end to
> end."

> **Production note:** don't just say this — show it. A few seconds of real
> Bob session scrollback (prompts + Bob's file edits/commands) reads as
> proof, not a claim. Pick sessions with visible file names that match what's
> on screen later (`agents/blueprint`, `orchestrator/`, `migration-accelerator-console/`).

---

## 1:00–3:00 — Solution in action (~120s, one real app end-to-end)

Use **app-catalog** — it's the one with a fully rehearsed, concrete
before/after story (open SSH + unencrypted EBS → SSM-only + KMS + private
subnet) and it's the one already verified live (`i-0f3e1e4f37dc02f57`,
healthy, real cutover completed). Keep it to one app; don't hop between apps
— judges lose the thread.

### 1:00–1:25 — Discovery (25s, ~40 words)
**Screen:** Dashboard Fleet tab → click **Run discovery**. Let tiers and the
dependency graph populate live (this takes ~20s for real — fine to use at
real speed).

**Say:**
> "Discovery assumes a read-only role into the legacy account. It finds that
> Orders depends on Pricing depends on Catalog — from tags, config, and
> security groups, not guesswork. Most of the fleet comes back Golden: safe
> to automate."

### 1:25–1:45 — Planning (20s, ~30 words)
**Screen:** Click **Build plan**. Wave schedule + finish-date projection
card appears.

**Say:**
> "Planning packs the fleet into waves — providers before consumers, Golden
> apps first, Red apps parked for a human. At this pace, the whole estate
> finishes well inside the 2027 target."

**On-screen text:** `1,006 apps → 29 waves → finish 2026-12-02`

### 1:45–2:20 — Blueprint (35s, ~45 words)
**Screen:** Click **Generate** on app-catalog. Diff view renders
(SSH-open/unencrypted vs. SSM/KMS/private). Then trigger `terraform apply`
and **speed-ramp the terraform output 4–6x** (real time ~1 min) with a small
on-screen label: **"sped up ~5x — real time 60s."** Land on `PROVISIONED`.

**Say:**
> "Blueprint maps the legacy config onto the golden pattern already live in
> the new account. SSH open to the world becomes SSM-only. An unencrypted
> disk becomes KMS. A public subnet becomes private. Then it applies it for
> real."

### 2:20–3:00 — Cutover + close (40s, ~60 words)
**Screen:** Click **Cut over**. Speed-ramp the traffic chart / particle
canvas (real time ~110s) with the label: **"sped up ~3x — real time under 2
min."** Show the weight steps 10 → 50 → 100 and gates passing. End on the
**MIGRATED** banner.

**Say:**
> "Now real traffic moves — 10 percent, 50, 100 — with health gates at every
> step. If error rate or latency breaks the threshold, it snaps back to
> legacy in seconds, no human involved. This one's clean: fully migrated,
> zero errors."
>
> "Two real AWS accounts, four agents, one console, built with IBM Bob."

**On-screen close card:** project name + one-line tagline, no extra runtime.

---

## Optional cutaway (only if you have seconds to spare)

If the edit comes in under 3:00 with room left, a **5–8s bad-wave rollback
flash** (Run wave → errors spike red → weights snap back → rollback
explanation banner) is a strong governance beat — cut it first if you're
tight, add it last if you're not.

---

## Shot list / capture checklist

Record these as separate clips, then edit to the timeline above — don't try
to do it live in one take.

- [ ] `BOB_Sessions/` scrollback — 2–3 sessions, real prompts + Bob's edits
      (for 0:35–1:00)
- [ ] `/journey` pipeline animation or the architecture diagram (for
      0:15–0:35)
- [ ] Full-speed screen recording of a clean Discovery → Planning →
      Blueprint → Cutover run on **app-catalog** from a reset state
      (`make demo-reset` / the reset button first — confirm `served_by:
      legacy` before recording)
- [ ] Raw terraform apply output (for the sped-up Blueprint segment)
- [ ] Raw cutover traffic chart across the full 10/50/100 run (for the
      sped-up Cutover segment)
- [ ] MIGRATED banner, held for at least 2s so it reads at speed
- [ ] (Optional) bad-wave rollback clip

## Recording notes (from the last real run, 2026-09-27)

- Real cutover timing on the live ALB is ~110s for 10/50/100, not 60–90s —
  budget the speed-ramp accordingly and say "real time" honestly in the
  on-screen label; don't imply it's actually ~40s.
- Discovery is genuinely fast (~20s) — no need to speed it up, real-time
  footage reads as impressive on its own.
- Do a full `make demo-reset` (or the console's Reset) immediately before
  recording so app-catalog starts from 100% legacy, and destroy the
  golden instance again afterward so nothing keeps costing.
- Have a backup recording of a prior clean run in case the live take glitches
  — don't re-record live under time pressure.
