import { calendarDay } from '@/data/workout';
export function monthCells(year: number, month: number) {
  const cells: ({ number: number; key: string } | null)[] = Array(new Date(year, month, 1).getDay()).fill(null);
  const length = new Date(year, month + 1, 0).getDate();
  for (let number = 1; number <= length; number++) cells.push({ number, key: calendarDay(new Date(year, month, number)) });
  while (cells.length % 7) cells.push(null);
  return cells;
}
