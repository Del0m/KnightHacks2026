# Rest-note review, 2026-10-10 (AI-11)

20 sample sets, 4 per exercise, through the real `RestNoteWriter` (`apps/api/src/services/restNote.ts`)
with a 5000 ms note budget. 15 of 20 notes were written by gpt-oss; the rest are the
spec's fixed `rest_note` (all-clean sets never call the LLM). Regenerate with `npm run notes:samples` in `apps/api`.

**What to check** (Architecture §7): good news first; at most one suggestion; about the movement, not the person;
no commands; kind, and specific enough to act on. Put ✓ or ✗ in *OK?* and say why in *Comment*.

| # | Exercise | Set | Note shown | Source | Fixed fallback | Guard rejected | OK? | Comment |
|---|---|---|---|---|---|---|---|---|
| 1 | Bicep curl | 8 reps, all clean | 8 of 8 reps were clean. | fixed (0 ms) | same |  | | |
| 2 | Bicep curl | 8 reps, range on 2 | 6 of 8 reps were clean. Curling until your forearm comes up close to your upper arm could be useful for the next set. | llm (964 ms) | 6 of 8 reps were clean. Next set, try curling until your forearm comes up close to your upper arm. |  | | |
| 3 | Bicep curl | 10 reps, torso_swing on 3 and elbow_drift on 4 (one note, torso_swing wins) | 5 of 10 reps were clean. Your upper body swung on 3 reps. Keeping the torso still can keep the work in your arms. | llm (411 ms) | 5 of 10 reps were clean. Your upper body swung on 3 reps. A still torso keeps the work in your arms. |  | | |
| 4 | Bicep curl | 6 reps, every rep lowered in about 0.8 s | 6 reps done. The way down took about 0.8 s per rep. About 2 s could provide more control. | llm (1581 ms) | 6 reps done. Your reps took about 0.8 s on the way down. Around 2 s gives you more control. |  | | |
| 5 | Lunge | 8 reps, all clean | 8 of 8 reps were clean. | fixed (0 ms) | same |  | | |
| 6 | Lunge | 8 reps, depth on 2 | 6 of 8 reps were clean. Lowering until the front thigh is about level with the floor could be useful for the next set. | llm (615 ms) | 6 of 8 reps were clean. Next set, try lowering until your front thigh is about level with the floor. |  | | |
| 7 | Lunge | 10 reps, trunk_lean on 3 and tempo on 4 (one note, trunk_lean wins) | 5 of 10 reps were clean. Chest tall over the hips could make this easier on the back. | llm (798 ms) | 5 of 10 reps were clean. Keeping your chest tall over your hips makes this easier on your back. |  | | |
| 8 | Lunge | 6 reps, every rep lowered in about 0.8 s | 6 reps done. The way down took about 0.8 s per rep. Around 2 s could give more control. | llm (536 ms) | 6 reps done. Your reps took about 0.8 s on the way down. Around 2 s gives you more control. |  | | |
| 9 | Push-up | 8 reps, all clean | 8 of 8 reps were clean. | fixed (0 ms) | same |  | | |
| 10 | Push-up | 8 reps, hip_sag on 2 | 6 of 8 reps were clean. Your hips dipped on 2 reps. A straight line from shoulders to ankles could keep the effort in your chest and arms. | llm (622 ms) | 6 of 8 reps were clean. Your hips dipped on 2 reps. A straight line from shoulders to ankles keeps the effort in your chest and arms. |  | | |
| 11 | Push-up | 10 reps, depth on 3 and lockout on 4 (one note, depth wins) | 5 of 10 reps were clean. Lowering until your elbows reach about a right angle could be useful for the next set. | llm (400 ms) | 5 of 10 reps were clean. Next set, try lowering until your elbows reach about a right angle. |  | | |
| 12 | Push-up | 6 reps, every rep lowered in about 0.8 s | 6 reps done. The way down took about 0.8 s per rep. About 2 s could provide more control. | llm (319 ms) | 6 reps done. Your reps took about 0.8 s on the way down. Around 2 s gives you more control. |  | | |
| 13 | Shoulder Press | 8 reps, all clean | 8 of 8 reps were clean. | fixed (0 ms) | same |  | | |
| 14 | Shoulder Press | 8 reps, back_arch on 2 | 6 of 8 reps were clean. Your lower back arched on 2 reps. Stacking the ribs over the hips could keep the load off your lower back. | llm (496 ms) | 6 of 8 reps were clean. Your lower back arched on 2 reps. Ribs stacked over the hips keep the load off your lower back. |  | | |
| 15 | Shoulder Press | 10 reps, lockout on 3 and wrist_stack on 4 (one note, lockout wins) | 5 of 10 reps were clean. Reaching until the arms are nearly straight overhead could be useful for the next set. | llm (296 ms) | 5 of 10 reps were clean. Next set, try reaching until your arms are nearly straight overhead. |  | | |
| 16 | Shoulder Press | 6 reps, every rep lowered in about 0.8 s | 6 reps done. The way down took about 0.8 s per rep. Around 2 s could give more control. | llm (261 ms) | 6 reps done. Your reps took about 0.8 s on the way down. Around 2 s gives you more control. |  | | |
| 17 | Squat | 8 reps, all clean | 8 of 8 reps were clean. | fixed (0 ms) | same |  | | |
| 18 | Squat | 8 reps, depth on 2 | 6 of 8 reps were clean. Lowering until your hips are level with your knees could help the next set. | llm (281 ms) | 6 of 8 reps were clean. Next set, try lowering until your hips are level with your knees. |  | | |
| 19 | Squat | 10 reps, knee_tracking on 3 and trunk_lean on 4 (one note, knee_tracking wins) | 5 of 10 reps were clean. Your knees drifted inward on 3 reps. Pointing them over your toes tends to keep them comfortable. | llm (383 ms) | 5 of 10 reps were clean. Your knees drifted inward on 3 reps. Pointing them over your toes keeps them comfortable. |  | | |
| 20 | Squat | 6 reps, every rep lowered in about 0.8 s | 6 reps done. Your reps took about 0.8 s on the way down. Around 2 s gives you more control. | llm (1609 ms) | 6 reps done. Your reps took about 0.8 s on the way down. Around 2 s gives you more control. |  | | |
