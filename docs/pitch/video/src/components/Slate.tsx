import React from 'react';
import { AbsoluteFill } from 'remotion';
import { color, font } from '../theme';

// Stand-in for a screen recording that hasn't been made yet.
export const Slate: React.FC<{ clip: string }> = ({ clip }) => (
  <AbsoluteFill style={{ background: color.navy, alignItems: 'center', justifyContent: 'center', fontFamily: font.body }}>
    <div style={{ border: `4px dashed ${color.blue}`, borderRadius: 32, padding: '48px 72px', textAlign: 'center' }}>
      <p style={{ margin: 0, fontSize: 30, letterSpacing: 3, textTransform: 'uppercase', color: '#9DB8DE' }}>Clip goes here</p>
      <p style={{ margin: '12px 0 0', fontFamily: font.display, fontSize: 120, fontWeight: 700, color: color.white }}>{clip}</p>
      <p style={{ margin: '8px 0 0', fontSize: 26, color: '#9DB8DE' }}>Drop public/clips/{clip}.mp4 to replace this slate</p>
    </div>
  </AbsoluteFill>
);
