# Pitch

Everything for the Knight Hacks judging: the deck, the printed architecture handout, and the judges' FAQ.

| File | What it is |
|---|---|
| [outline.md](outline.md) | The story, the 3-minute run order, and stat sources (PITCH-01) |
| [deck/](deck/) | Slide source: `deck.json` sets the order, one HTML file per slide, speaker notes in each `<aside>` |
| [architecture-handout.pdf](architecture-handout.pdf) | One US Letter page to print and hand to judges (PITCH-02). Reads in black and white. Source: [architecture-handout.html](architecture-handout.html), preview: [architecture-handout-preview.png](architecture-handout-preview.png) |
| [judges-faq.md](judges-faq.md) | Crib sheet for Q&A. Answers marked **(check)** depend on open issues |

**Live deck:** https://claude.ai/artifact/RMBHctMbtjeYUZmxRio6hB. It's private until its owner shares it from the deck's Share menu, and it downloads as PowerPoint or PDF. The files in `deck/` are a snapshot of it for review; images are hosted with the live deck, so `src="/_blob/…"` paths don't resolve here.

## Rebuilding the handout PDF

The HTML is self-contained. Print it to US Letter with no headers and background graphics on, or with Playwright:

```js
await page.goto('file://' + path.resolve('docs/pitch/architecture-handout.html'));
await page.pdf({ path: 'architecture-handout.pdf', format: 'Letter', printBackground: true, preferCSSPageSize: true });
```

Check it still fits on one page after any text change.
