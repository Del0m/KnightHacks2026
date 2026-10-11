# Scheduled streaks and upcoming workouts

Streaks on Train and Me use the saved onboarding schedule (fixed weekdays or every N days), falling back to local workout weekdays. Completed dates count once. Unscheduled rest days preserve the streak; a missed scheduled day breaks it after that day ends. Today can still be completed. Extra workouts on rest days count without adding new obligations. Future-dated history does not contribute.

Plan keeps the current week's weekday selector and displays the next three unfinished workout dates from today, crossing week and month boundaries. Generated routines and rest days are retained within the generated week. Later dates use the offline three-exercise daily full-body routine and are labeled accordingly. Local future routines are previews; their cards do not start today's workout. Completed workout dates are excluded from the upcoming list.

The current API supplies only the current week's generated plan; future previews do not invent AI recommendations or sources. Empty schedules show an instruction to choose workout days. Weekly and interval schedule tests cover grace through today, missed scheduled days, empty history, date boundaries, generated rest days, next-week fallback, and screen rendering.

Validation: 88 mobile test suites / 858 tests pass, TypeScript passes, Expo lint has no errors (9 existing warnings), and standalone Release builds successfully. Independent code review found no actionable regressions.
