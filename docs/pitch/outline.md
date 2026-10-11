# Pitch outline and story

## One-sentence pitch

Spotter is a quiet coach on the phone you already own, for people new to the gym and people coming back from an injury: it watches every rep, never talks over you mid-set, and plans around your level and any injury.

## Who it's for

Two co-equal audiences who train alone and aren't sure they're doing it right:

- **New gym-goers:** don't know what weight or form is right, and are too embarrassed to ask.
- **People returning from injury:** do their physio exercises alone, are afraid of getting hurt again, and lose all support once discharged.

## The 3-minute run order

About 3:00 including the live demo. Visible slides only; everything else in the deck is hidden backup.

| # | Slide (`deck/slides/`) | Time | What happens |
|---|---|---|---|
| 1 | `cover` | 0:10 | Name and one-line promise |
| 2 | `problem` | 0:25 | Two columns: beginners and injury recovery, with the stats below |
| 3 | `demo` | 1:30 | Live on a phone mirrored to the laptop. One teammate squats 4–5 reps with one deliberate knees-in rep (amber cue), then the rest note and medal, then the plan (beginner judge) or recovery chart (injury story). A 60 s backup cut plays in the slide's frame if the phone fails |
| 4 | `buddies` | 0:20 | Community: gym and recovery buddies, feed and advice, moderation. Hand out the architecture sheet here |
| 5 | One of `hf`, `dbx`, `neon`, `bestai`, `presage` | 0:25 | Unhide only the slide for the judge's track (PITCH-03, #70). Hugging Face is visible by default |
| 6 | `close` | 0:10 | Closing line and repo link |

**Hidden backup slides, for Q&A or if the live demo fails:** `how` (architecture), `meet`, `liveset`, `cue`, `rest`, `recovery`, `plan`, `offload` (on-device vs cloud pose), `different`, `safety`.

## Problem stats and sources

| Stat | Source | Caveat |
|---|---|---|
| 64% of beginners don't know how heavy their weights should be | [PureGym gym fear report](https://one.puregym.com/blog/gym-fear-intimidation-report) | Gym-chain poll, methods and sample size undisclosed. Say "a survey found" |
| 44–48% are too embarrassed to ask for help | Same PureGym report | Same |
| 30–50% of musculoskeletal patients don't do their home exercises as prescribed | Argent et al., [JMIR mHealth 2018](https://mhealth.jmir.org/2018/3/e47/) | Peer-reviewed |
| Fear of reinjury is the most common reason people stop or scale back sport after ACL reconstruction | Ardern et al., [BJSM 2011](https://bjsm.bmj.com/content/45/7/596) | Peer-reviewed |

## Messaging rules

- **Lead with** silent coaching during the set, plans for your level and injury, and community. Don't lead with rep counting; judges have seen many pose-model rep counters.
- **Privacy line:** pose runs on the phone when it can and offloads through our API to the Hugging Face pose endpoint when it can't (Android, iPhones under 12 fps, or by choice, always with consent). Say "video is never stored", not "video never leaves the phone".
- **Moderation** is Llama Guard on Hugging Face; Neon stores the posts and runs buddy matching with pgvector.
- **Safety:** no diagnosis, never changes a physio's limits, pain routes to "check with your physio or a doctor".

## Before judging

- `cloudReachable` is stubbed to `false` in `apps/mobile/src/pose/usePoseMode.ts`, so a slow phone currently pauses instead of offloading. Wire the cloud pose path before claiming it, or drop the claim.
- Record the demo clips (V1–V10 in the slide notes) and the 60 s backup cut.
- Fill `[Team names]` on `cover` and `close`, and the knee-range numbers in `recovery`'s notes from the seeded demo branch.
- Presage (MLH) is pitched but not built.
- The official judging criteria page couldn't be read when this was written; check the deck against it.
