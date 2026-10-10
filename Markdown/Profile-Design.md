# Profile design

Based on the owner's profile doodle (IMG_6527 2.HEIC).

- Circular photo/initials on the left, name and bio on the right; editing opens inline name/bio fields. Bio is optional and limited to 160 characters. Tap the photo to use the system library picker; photo removal is available while editing.
- Existing streak counter sits underneath; a gray divider separates identity from the content tabs.
- Calendar opens first. Current month defaults automatically; previous/next controls allow browsing. Workout days come from saved session dates, counted once per day. Today is outlined, and completed days are filled.
- Calendar, Videos and PBs use calendar, video and trophy icons with accessible names. Videos and PBs have independent tabs and empty states. Video creation/library data and personal-best records have not been connected, so no example achievements or media are fabricated.
- Each page now carries its tab palette through the background gradient, brand accent, text, borders, buttons, selected controls, and locked account prompt. Shared buttons receive the page palette from AppPage, so profile editing actions also use rose. Streak text follows the page; flame severity colors are preserved.
- Bottom navigation progresses blue → periwinkle → purple → mauve → rose, keeping Train's existing blue. Profile sub-tabs use blue, purple, rose. Sliding selection indicators animate with color interpolation and honor reduced motion.
- Existing auth gate remains: Me, Feed and Buddies require a confirmed session; Train, Plan and workouts stay public.

Profile fields are stored with existing account-scoped training state. Old saved profiles retain their workout history and gain empty bio/avatar fields. Browser local storage persists edits; native training/profile state remains in memory as before, pending durable account/profile sync. Photos are stored locally as validated JPG/PNG/WebP data URLs, limited to approximately 2 MB. No cloud upload is performed.

Expo ImagePicker 57.0.20 was installed using Expo's SDK-compatible installer. Native development builds need rebuilding to include the picker and its photo permission description. Device photo selection has not been verified; browser inspection remains blocked by the browser tool's security policy.

Verification: 101 Jest tests, TypeScript and lint on changed files; web/iOS/Android Expo exports. Existing unrelated pose lint errors remain outside this change. Commit locally only; do not push without a new explicit request.
