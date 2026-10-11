# Daily full-body workouts

Train uses a date-based full-body routine whenever no generated weekly plan is available. Each routine includes the five currently rigged and camera-tracked exercises: bicep curl, squat, shoulder press, push-up, and lunge. Exercise order rotates, with 2–3 sets and 8–12 reps per exercise. This runs locally without login, network access, or Metro.

The routine is stable for a local calendar date and varies across dates. It uses the supported exercise catalog rather than suggesting movements without animations or camera tracking. This is a local daily rotation, not an AI-generated personal plan. Generated weekly plans and their rest days still take priority.

New workouts persist the routine and date immediately, before any set is completed. Resuming after midnight or an interruption keeps that snapshot. Existing unfinished workouts retain their previous prescription. Practice remains separate.

Validation: 86 mobile test suites / 850 tests pass; TypeScript passes; Expo lint has no errors (9 existing warnings). Coverage includes monthly daily variation, calendar boundaries, Train prescription display, first-exercise preview, immediate persistence, midnight recovery, manual completion, generated plans, and rest days.
