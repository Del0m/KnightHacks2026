import { createContext, useContext } from 'react';
export const colors = {
  background: '#F7FCFF', surface: '#FFFFFF', text: '#153F58', muted: '#4E6C7E',
  primary: '#087DBA', primarySoft: '#E4F5FE', border: '#D6EAF4', amber: '#946000',
  bronze: '#97613D', silver: '#657580', gold: '#8B6A11',
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
export const radius = { sm: 12, md: 20, pill: 999 } as const;
export const typography = {
  family: 'Barlow', strong: 'BarlowBold', label: 'BarlowSemiBold',
  display: 'BarlowCondensed', caption: 12, body: 17, subtitle: 22, title: 38,
} as const;

export function useTheme() {
  return { scheme: 'light' as const, colors, spacing, radius, typography };
}

export const tabAccents = [
  { color: colors.primary, glass: 'rgba(197,231,250,0.65)' },
  { color: '#5D73BB', glass: 'rgba(211,221,250,0.65)' },
  { color: '#8463B3', glass: 'rgba(227,214,249,0.65)' },
  { color: '#A75B97', glass: 'rgba(243,214,237,0.65)' },
  { color: '#B64F70', glass: 'rgba(250,215,225,0.65)' },
] as const;

const pagePalettes = [
  { background: colors.background, primarySoft: colors.primarySoft, text: colors.text, muted: colors.muted, border: colors.border },
  { background: '#F8FAFF', primarySoft: '#EDF0FD', text: '#293C64', muted: '#68718A', border: '#DCE2F1' },
  { background: '#FCF9FF', primarySoft: '#F3EDFC', text: '#443354', muted: '#776982', border: '#E8DEF0' },
  { background: '#FFF9FD', primarySoft: '#FAEDF7', text: '#583A50', muted: '#826C7C', border: '#EEDFE9' },
  { background: '#FFF9FB', primarySoft: '#FDECF1', text: '#5B3542', muted: '#856975', border: '#EFDEE4' },
];
export function pageColors(title = 'Train') {
  const index = Math.max(0, ['train', 'plan', 'feed', 'buddies', 'me'].indexOf(title.toLowerCase()));
  return { ...colors, ...pagePalettes[index], primary: tabAccents[index].color };
}
export const PageColors = createContext(pageColors());
export function usePageColors() { return useContext(PageColors); }
