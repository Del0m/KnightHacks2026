# Judges' FAQ (draft 1)

A crib sheet for rehearsal. Each answer is meant to be said out loud in about 15 seconds: the first sentence is the answer, the rest is backup if they push. Swap "Spotter" for the final name.

Items marked **(check)** depend on work that's still open; confirm them before judging.

---

## The idea

**Who is this for?**
Two groups who train alone and aren't sure they're doing it right: new gym-goers, and people coming back from an injury. Beginners get silent form checks, a plan for their level, and buddies at the same stage, without having to ask anyone. People in recovery also get physio limits, range-of-motion tracking and a report for their physio.

**Why does this matter?**
For beginners, a PureGym survey found 64% don't know how heavy their weights should be and 44–48% are too embarrassed to ask for help (a gym-chain poll with undisclosed methods, so quote it as a survey). For recovery, 30–50% of musculoskeletal patients don't do their home exercises as prescribed, and adherence goes up when someone checks the exercise is being done correctly (Argent et al., JMIR mHealth 2018). Fear of reinjury is the most common reason people stop or scale back sport after ACL reconstruction (Ardern et al., BJSM 2011).

**Isn't this just another AI rep counter?**
Rep counting is the baseline, not the pitch. What's different is that coaching happens silently during the set, pose runs on the phone whenever it can and video is never stored, it works with bodyweight and dumbbells, and "good form" means "within the limits your physio set", tracked as range of motion over weeks.

**How is this different from FormCoach / Tempo / Hinge Health?**
- Most form apps analyze an uploaded video after the set; we coach live, during the set, on the phone.
- We keep joint positions only, never video. Pose runs on the phone when it can; slower phones offload frames that are processed in memory and dropped.
- Tempo and similar products need their own hardware; we use the phone you already own.
- Hinge, Kaia and Exer are gated behind an employer, insurer or clinician code and stop at discharge; we start there, and we're open to beginners with no injury at all.
- Tempo users complain it penalizes modified moves; our physio limits make a modified range count as a clean rep.

**Why silent coaching instead of voice?**
Talking at someone mid-rep is distracting, and users of existing products complain about punitive audio cues. We show a quiet amber tint on the joint that drifted, then give one short, kind note during rest.

---

## Safety and medical

**Is this a medical device? What about liability?**
No. Spotter tracks the plan a physio already gave you; it never diagnoses, never prescribes treatment and never changes a physio's limits. Any mention of pain routes to "please check with your physio or a doctor", and every recovery screen carries that note.

**What if someone gets hurt following it?**
The app only narrows what counts as a clean rep to the range the physio set; it never pushes anyone past it. The rest notes are checked against a banned-phrase list, so they never use commanding or alarming language, and if the language model's wording fails the check we fall back to a fixed, reviewed note.

**How does it know my physio's limits?**
You enter the exercises, sets, reps and range limits your physio gave you. Those limits override the exercise's default thresholds in the form engine, so a squat stopped at 110° of knee bend can still be a clean rep for you.

**Can I share it with my physio?**
Yes, the user can choose to share a one-page report: sessions done, range-of-motion trend, left vs right, and any reps outside the prescribed limits. Nothing is sent automatically. **(check: FE-17, BE-16)**

---

## Privacy

**Do you store video?**
No, never. On an iPhone that passes the on-device benchmark, video doesn't leave the phone at all; only joint positions and scores are uploaded after the set. On phones that offload pose to the cloud, frames are processed in memory and never stored.

**What about phones that can't run the model?**
We offload pose to the cloud. Android always does, and so does any iPhone under 12 fps on the startup benchmark, or a user who picks cloud in settings. Frames stream over a WebSocket to the Spotter API, which relays them to our Hugging Face pose endpoint and returns only joints; the phone never talks to Hugging Face directly. It needs explicit consent. Without consent, a capable iPhone stays on-device and anything else falls back to logging sets by hand. If the cloud is unreachable, the phone uses on-device pose if it can, otherwise it pauses. **(check: cloud path is stubbed off in the app until the cloud pose work lands)**

**Can I delete my data?**
Yes. Deleting an account cascades through Neon and triggers a Databricks job that removes the user's rows.

---

## Technical

**What runs on the phone?**
YOLOv8n-pose exported to Core ML on the iPhone's Neural Engine, plus our form engine: smoothing, joint angles, a rep state machine and the form rules. Each exercise is a JSON spec, so adding an exercise is data, not code.

**How fast is it?**
9.8 ms mean and 10.8 ms p95 per frame on an iPhone 17 Pro Max, which is about 15% of the chip's capacity at 15 fps. On first launch the app benchmarks itself and drops to a smaller input or to cloud mode if a phone can't hold 12 fps. Older phones haven't been measured yet **(check)**.

**How accurate is the form checking?**
The rules are transparent joint-angle thresholds per exercise, so every flag can be explained ("your knees came within 90% of your ankle width"). Low-confidence joints are held briefly and then treated as missing, so a bad frame freezes the counter instead of counting a false rep. The learned form-quality model is a prototype trained on our own labelled clips **(check: AI-09, AI-10)**; the rules carry the demo if it isn't ready.

**What camera angle does it need?**
Each exercise spec names a recommended view (side for squat depth, front for knee tracking), and a framing guide helps you place the phone before the set starts.

**What does Databricks actually do?**
Finished sets land in a Volume and flow through a Lakeflow bronze, silver and gold pipeline. An MLflow form-quality model on Model Serving scores each set during the rest period, about a second. Gold tables, including the range-of-motion trend, sync back into Neon, so the app never waits on a warehouse. If serving is slow, the phone's own rule score sets the medal.

**What does Hugging Face do?**
Our pose and form models are published on the Hub and the app checks for updates. gpt-oss through Inference Providers writes rest notes and plans. bge-small embeddings power retrieval over our injury-modification notes. Llama Guard moderates the social feed. An Inference Endpoint runs pose for cloud mode. We're publishing our labelled form dataset and a Gradio Space **(check: CONN-12)**.

**What does Neon do?**
It's the system of record: Neon Auth, profiles and injuries, sessions, the social graph, rehab plans and limits, pgvector for retrieval and buddy matching, and the synced Databricks insights. Each developer works on a branch, and we demo off a seeded branch.

**Why an LLM at all?**
Only for wording and planning, never for judging form. The scores come from rules and our model; the LLM turns them into one sentence and must stay inside a banned-phrase list. Plans are grounded by retrieval over exercise and injury notes, with "why this exercise" sources shown.

**What happens with no internet?**
On an iPhone running pose on-device, a set works in airplane mode. Phones that offload pose pause until the connection is back, and sets can be logged by hand. Sets queue offline and upload later; the rest note falls back to the rule's fixed text. **(check: INT-03 offline queue)**

---

**What does Presage do? (only if we build it)**
During rest, when the lifter looks at the phone, Presage SmartSpectra reads pulse and breathing rate from the face, computed on the phone. Spotter uses it as a readiness check ("breathing has settled") and tracks heart-rate recovery between sets over weeks. It's never a diagnosis. The pose camera is too far away to read vitals during the set, which is why it runs at rest.

## Business and next steps

**How would this make money?**
Free for individuals; a paid tier for physio clinics that want to see patients' range-of-motion reports between visits. (Inferred direction, not validated with clinics.)

**Licensing: YOLOv8 is AGPL-3.0.**
Our repo is public, which satisfies AGPL for the hackathon. For a commercial build, we'd swap in MediaPipe or MoveNet, both Apache-2.0; the form engine works on 17 COCO joints, so the pose model is replaceable. Apple Vision basic mode is already wired in as an alternative on iPhone.

**What would you build next?**
More exercises (deadlift, row, RDL, plank, glute bridge are planned as JSON specs), an Android on-device build with TFLite, and a clinician view for the physio report.

**What was hardest?**
Running the pose model inside the camera's frame processor in an Expo app, and making one definition of a "clean rep" agree across the phone, the API and Databricks (we have parity tests for that).

**What did each team member build?**
_Fill in: name, role, one thing they built._
