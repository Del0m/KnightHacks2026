import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { color, font } from '../theme';

// Burned-in voiceover caption, bottom centre.
export const Caption: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: 160, right: 160, bottom: 56, display: 'flex', justifyContent: 'center', opacity }}>
      <p style={{ margin: 0, padding: '14px 28px', borderRadius: 14, background: 'rgba(16,35,63,0.86)', color: color.white, fontFamily: font.body, fontSize: 36, fontWeight: 600, lineHeight: 1.3, textAlign: 'center' }}>
        {text}
      </p>
    </div>
  );
};
