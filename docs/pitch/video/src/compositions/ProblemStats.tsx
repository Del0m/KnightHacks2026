import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { color, font, sec } from '../theme';

// R1: the two audiences and their numbers, one after the other.

const columns = [
  {
    eyebrow: 'New to the gym',
    at: 1.5,
    stats: [
      { value: 64, suffix: '%', text: "of beginners don't know how heavy their weights should be", at: 2.5 },
      { range: '44–48%', text: 'are too embarrassed to ask for help', at: 6 },
    ],
  },
  {
    eyebrow: 'Coming back from injury',
    at: 9,
    stats: [
      { range: '30–50%', text: "of physio patients don't do their home exercises as prescribed", at: 10 },
      { range: 'No. 1', text: 'reason people stop or scale back sport after ACL surgery: fear of getting hurt again', at: 13.5 },
    ],
  },
];

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export const ProblemStats: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const closing = interpolate(frame, [sec(16.5), sec(17)], [0, 1], clamp);

  return (
    <AbsoluteFill style={{ background: color.light, fontFamily: font.body, color: color.navy, padding: 128 }}>
      <p style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: 3, textTransform: 'uppercase', color: color.blue, opacity: interpolate(frame, [0, 12], [0, 1], clamp) }}>
        The problem
      </p>
      <div style={{ display: 'flex', gap: 64, marginTop: 40 }}>
        {columns.map((col) => {
          const appear = spring({ frame: frame - sec(col.at), fps, config: { damping: 200 }, durationInFrames: 18 });
          return (
            <div key={col.eyebrow} style={{ flex: 1, opacity: appear, transform: `translateY(${(1 - appear) * 30}px)`, background: color.white, border: `2px solid ${color.border}`, borderRadius: 28, padding: 48, display: 'flex', flexDirection: 'column', gap: 36 }}>
              <h2 style={{ margin: 0, fontFamily: font.display, fontSize: 64, fontWeight: 700 }}>{col.eyebrow}</h2>
              {col.stats.map((s) => {
                const p = interpolate(frame, [sec(s.at), sec(s.at) + 20], [0, 1], clamp);
                const value = 'value' in s ? `${Math.round((s.value ?? 0) * p)}${s.suffix}` : s.range;
                return (
                  <div key={s.text} style={{ opacity: p, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontFamily: font.display, fontSize: 92, fontWeight: 700, lineHeight: 1, color: color.blue }}>{value}</span>
                    <span style={{ fontSize: 32, lineHeight: 1.3, color: color.muted }}>{s.text}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <p style={{ margin: '48px 0 0', fontFamily: font.display, fontSize: 72, fontWeight: 700, color: color.amber, opacity: closing, transform: `translateY(${(1 - closing) * 16}px)` }}>
        Both groups train alone.
      </p>
      <p style={{ position: 'absolute', left: 128, bottom: 40, margin: 0, fontSize: 20, color: color.muted, opacity: interpolate(frame, [sec(2), sec(3)], [0, 1], clamp) }}>
        Sources: PureGym gym fear report; Argent et al., JMIR mHealth 2018; Ardern et al., BJSM 2011
      </p>
    </AbsoluteFill>
  );
};
