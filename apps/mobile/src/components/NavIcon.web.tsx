export function NavIcon({ name, color }: { name: string; color: string }) {
  const paths: Record<string, string[]> = { Train: ['M7 7v10M4 9v6M17 7v10M20 9v6M7 12h10'], Plan: ['M5 5h14v15H5zM8 3v4M16 3v4M5 10h14M9 14h2M14 14h2M9 17h2'], Feed: ['M5 4h14v16H5zM8 8h8M8 12h8M8 16h5'], Buddies: ['M9 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3 20v-2a6 6 0 0 1 12 0v2M16 6a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 5'], Me: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-1a8 8 0 0 1 16 0v1'] };
  return <svg width="27" height="27" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{(paths[name] ?? paths.Train).map((d, i) => <path key={i} d={d} />)}</svg>;
}
