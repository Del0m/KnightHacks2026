import type { ReactNode } from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';
import { colors } from '@/theme/tokens';

export default function Html({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content={colors.background} />
        <meta name="description" content="SteadyForum. Workout tracking and community." />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: `
          :root { --steadyforum-background: ${colors.background}; --steadyforum-surface: ${colors.surface};
            --steadyforum-text: ${colors.text}; --steadyforum-muted: ${colors.muted};
            --steadyforum-blue: ${colors.primary}; --steadyforum-sky: ${colors.primarySoft};
            --steadyforum-border: ${colors.border}; color-scheme: light; }
          [data-testid^="exercise-"] { transition: background-color 350ms ease, border-color 350ms ease; }
          [data-testid="glass-playback"], [data-testid="glass-navigation"], [data-testid="glass-action"] {
            isolation: isolate; overflow: hidden; background-color: rgba(236,248,255,.2) !important;
            border-color: rgba(255,255,255,.9) !important;
            box-shadow: inset 0 1px 1px rgba(255,255,255,.95), inset 0 -1px 2px rgba(100,153,185,.22), 0 7px 24px rgba(46,99,131,.14) !important;
          }
          [data-testid="glass-playback"]::before, [data-testid="glass-navigation"]::before, [data-testid="glass-action"]::before {
            content: ''; position: absolute; inset: 0; border-radius: inherit; z-index: -1; pointer-events: none;
            background: linear-gradient(135deg,rgba(255,255,255,.6),rgba(255,255,255,.12) 45%,rgba(171,220,248,.18) 75%,rgba(255,255,255,.5));
            -webkit-backdrop-filter: blur(7px) saturate(150%);
            backdrop-filter: blur(7px) saturate(150%);
          }
          @supports (backdrop-filter: url(#steadyforum-glass-lens)) {
            [data-testid="glass-playback"]::before, [data-testid="glass-navigation"]::before, [data-testid="glass-action"]::before {
              backdrop-filter: url(#steadyforum-glass-lens) blur(3px) saturate(150%);
            }
          }
          [data-testid="glass-action"] { background-color: rgba(109,180,223,.32) !important; }
          [data-testid="glass-action"] > div { color: #173F59 !important; text-shadow: 0 1px 0 rgba(255,255,255,.65); }
          [data-testid="glass-navigation"] [role="tab"] { border-radius: 20px; }
          [data-testid="tab-highlight"] { background: linear-gradient(145deg,rgba(255,255,255,.85),rgba(172,219,246,.35)); box-shadow: inset 0 1px 0 white, 0 2px 8px rgba(68,119,148,.1); }
          [data-testid="glass-navigation"] svg { filter: drop-shadow(0 1px 0 rgba(255,255,255,.9)); }
          @media (prefers-reduced-transparency: reduce) {
            [data-testid="glass-playback"], [data-testid="glass-navigation"], [data-testid="glass-action"] { background-color: #EAF6FD !important; }
            [data-testid="glass-playback"]::before, [data-testid="glass-navigation"]::before, [data-testid="glass-action"]::before { backdrop-filter: none; -webkit-backdrop-filter: none; }
          }
          [role="button"], [role="tab"], [role="radio"], [role="checkbox"] { transition: opacity 180ms ease, transform 180ms cubic-bezier(.22,1,.36,1), scale 180ms cubic-bezier(.22,1,.36,1), color 220ms ease, background-color 220ms ease; }
          @media (hover: hover) and (pointer: fine) {
            [role="button"]:not([aria-disabled="true"]):hover, [role="tab"]:hover, [role="radio"]:hover, [role="checkbox"]:hover { scale: 1.02; }
          }
          input { transition: border-color 200ms ease, box-shadow 200ms ease; }
          input:focus { border-color: var(--steadyforum-blue); box-shadow: 0 2px 0 rgba(78,162,213,.2); }
          @media (prefers-reduced-motion: reduce) { [role="button"], [role="tab"], [role="radio"], [role="checkbox"], input, [data-testid^="exercise-"] { transition: none; scale: 1 !important; } }
          body { background: var(--steadyforum-background); color: var(--steadyforum-text); }
          a:focus-visible, button:focus-visible, [role="button"]:focus-visible, [role="tab"]:focus-visible {
            outline: 3px solid var(--steadyforum-blue); outline-offset: 4px;
          }
        ` }} />
      </head>
      <body>
        <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }}>
          <defs><filter id="steadyforum-glass-lens" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.012 0.035" numOctaves="1" seed="4" result="lens" />
            <feDisplacementMap in="SourceGraphic" in2="lens" scale="14" xChannelSelector="R" yChannelSelector="G" />
          </filter></defs>
        </svg>
        {children}
      </body>
    </html>
  );
}
