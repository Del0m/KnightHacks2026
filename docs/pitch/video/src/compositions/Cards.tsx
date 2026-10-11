import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { color, font } from '../theme';

// R4: title and close cards. Captions live in components/Caption.tsx.

const fade = (frame: number) => interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });

export const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: color.navy, alignItems: 'center', justifyContent: 'center', fontFamily: font.body, color: color.white }}>
      <h1 style={{ margin: 0, fontFamily: font.display, fontSize: 220, fontWeight: 700, opacity: fade(frame) }}>Spotter</h1>
      <p style={{ margin: '8px 0 0', fontSize: 48, color: '#C9D8EE', opacity: fade(frame - 10) }}>A quiet coach on the phone you already own.</p>
    </AbsoluteFill>
  );
};

export const CloseCard: React.FC<{ team?: string }> = ({ team = '[Team names]' }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: color.navy, alignItems: 'center', justifyContent: 'center', fontFamily: font.body, color: color.white, gap: 24 }}>
      <h1 style={{ margin: 0, fontFamily: font.display, fontSize: 180, fontWeight: 700, opacity: fade(frame) }}>Spotter</h1>
      <p style={{ margin: 0, fontSize: 46, color: '#C9D8EE', opacity: fade(frame - 6) }}>A quiet coach on the phone you already own.</p>
      <p style={{ margin: '24px 0 0', fontSize: 32, opacity: fade(frame - 12) }}>github.com/Del0m/KnightHacks2026 · Knight Hacks 2026</p>
      <p style={{ margin: 0, fontSize: 30, color: '#C9D8EE', opacity: fade(frame - 12) }}>{team}</p>
    </AbsoluteFill>
  );
};
