import React from 'react';
import { AbsoluteFill, Series, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import sponsors from '../data/sponsors.json';
import { color, font } from '../theme';

// R3: one card per sponsor prize. Presage only shows once it is built.

export type SponsorProps = { includeUnbuilt?: boolean };

export const sponsorList = (includeUnbuilt = false) => sponsors.filter((s) => s.built || includeUnbuilt);

export const SponsorCards: React.FC<SponsorProps> = ({ includeUnbuilt = false }) => {
  const { durationInFrames } = useVideoConfig();
  const list = sponsorList(includeUnbuilt);
  const each = Math.floor(durationInFrames / list.length);
  return (
    <AbsoluteFill style={{ background: color.light }}>
      <Series>
        {list.map((s, i) => (
          <Series.Sequence key={s.name} durationInFrames={i === list.length - 1 ? durationInFrames - each * i : each}>
            <Card {...s} />
          </Series.Sequence>
        ))}
      </Series>
    </AbsoluteFill>
  );
};

const Card: React.FC<(typeof sponsors)[number]> = ({ name, color: accent, claim, where }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const appear = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 14 });
  const stripe = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: color.light, fontFamily: font.body, color: color.navy, padding: 160, justifyContent: 'center' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 24 * stripe, background: accent }} />
      <div style={{ opacity: appear, transform: `translateX(${(1 - appear) * 40}px)`, display: 'flex', flexDirection: 'column', gap: 32 }}>
        <p style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: 3, textTransform: 'uppercase', color: accent }}>Built with</p>
        <h2 style={{ margin: 0, fontFamily: font.display, fontSize: 140, fontWeight: 700, lineHeight: 1 }}>{name}</h2>
        <p style={{ margin: 0, fontSize: 46, lineHeight: 1.3, maxWidth: 1400 }}>{claim}</p>
        <p style={{ margin: 0, fontSize: 30, color: color.muted }}>In the demo: {where}</p>
      </div>
    </AbsoluteFill>
  );
};
