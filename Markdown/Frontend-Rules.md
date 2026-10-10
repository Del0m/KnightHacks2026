# Frontend design rules

These rules apply to future frontend design tasks. The current Spotter direction prioritizes white and light blue, inspired by Wii Sports: friendly, open, athletic, and bright.

- **One composition:** The first viewport must read as one composition, not a dashboard unless the surface is a dashboard.
- **Brand first:** On branded pages, the brand or product name must be a hero-level signal. No headline should overpower the brand.
- **Brand test:** Removing the navigation must not make the first viewport interchangeable with another brand.
- **Typography:** Use expressive, purposeful fonts. Avoid default stacks such as Inter, Roboto, Arial, and system fonts.
- **Background:** Use gradients, imagery, or subtle patterns to build atmosphere; do not rely on flat single-color backgrounds.
- **Full-bleed hero:** On landing pages and promotional surfaces, make the hero image a dominant edge-to-edge visual plane or background. Avoid inset images, side-panel images, rounded media cards, tiled collages, and floating image blocks unless the existing design system requires them.
- **Hero budget:** Usually limit the first viewport to the brand, one headline, one short supporting sentence, one CTA group, and one dominant image. Keep stats, schedules, event listings, addresses, promos, weekly callouts, metadata, and secondary marketing content out of it.
- **No hero overlays:** No detached labels, floating badges, promo stickers, info chips, or callout boxes over hero media.
- **Cards:** Default to no cards. Never use cards in the hero. Cards are allowed only as containers for user interaction. If removing the border, shadow, background, or radius does not hurt interaction or understanding, remove the card treatment.
- **One job per section:** Each section has one purpose, one headline, and usually one short supporting sentence.
- **Real visual anchor:** Show the product, place, atmosphere, or context. Decorative gradients and abstract backgrounds cannot be the main visual idea.
- **Reduce clutter:** Avoid pill clusters, stat strips, icon rows, boxed promos, schedule snippets, and competing text blocks.
- **Motion:** Create presence and hierarchy without noise. Include at least two or three intentional motions for visually led work. Respect reduced-motion preferences.
- **Color and look:** Choose a clear direction and define CSS variables for web styles. Keep matching native theme tokens. Avoid purple-on-white defaults, purple bias, and dark-mode bias.
- **Responsive verification:** Verify loading and layout on desktop and mobile.
- **React:** Use modern patterns such as `useEffectEvent`, `startTransition`, and `useDeferredValue` when appropriate to the team's code. Do not add `useMemo` or `useCallback` by default. Follow repository React Compiler guidance.

- **Imagery provenance:** Do not create or use fully generative AI art. Small logos are the only permitted exception. Use real photography, user-supplied artwork, or actual product screenshots for dominant visuals. Do not invoke image generation for hero imagery or illustrations.

## Design reference

[Designing delightful frontends with GPT-5.4](https://developers.openai.com/blog/designing-delightful-frontends-with-gpt-5-4)

Apply the article's practical principles: establish typography, color, and composition before components; ground the content in the real product; limit each section to one clear purpose; use relevant imagery; keep motion from overlapping content; inspect the result at multiple screen sizes.

The reference informs visual decisions; it does not authorize changes to product scope or external services.
