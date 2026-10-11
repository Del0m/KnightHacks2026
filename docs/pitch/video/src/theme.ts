import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

// Same palette and type as the deck and the printed handout.
export const color = {
  navy: '#10233F',
  light: '#F5F9FD',
  blue: '#1F64C8',
  blueTint: '#E4EEF9',
  amber: '#B86A00',
  amberText: '#8A4F00',
  amberTint: '#FFF1DC',
  muted: '#44546A',
  border: '#D3E1F2',
  white: '#FFFFFF',
  api: '#4B5650',
  neon: '#0A7D55',
  databricks: '#C8322B',
  huggingface: '#8A6500',
};

// Fonts ship in public/fonts so renders work offline (Barlow is SIL OFL).
for (const weight of ['400', '600', '700']) {
  loadFont({ family: 'Barlow', url: staticFile(`fonts/Barlow-${weight}.woff2`), weight });
}
loadFont({ family: 'Barlow Condensed', url: staticFile('fonts/BarlowCondensed-700.woff2'), weight: '700' });

export const font = {
  body: "'Barlow', Arial, sans-serif",
  display: "'Barlow Condensed', Arial, sans-serif",
};

export const FPS = 30;
export const sec = (s: number) => Math.round(s * FPS);
