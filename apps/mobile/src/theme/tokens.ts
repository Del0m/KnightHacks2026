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
