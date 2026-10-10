import { elasticTabPosition, tabAtPosition, adjacentTab } from '../tabSwipe';
it('navigates one adjacent tab in finger direction without wrapping', () => {
  expect(adjacentTab('/', -100, 4, 1)).toBe('/plan');
  expect(adjacentTab('/feed', 100, 4, 1)).toBe('/plan');
  expect(adjacentTab('/me', -100, 0, 1)).toBeNull();
  expect(adjacentTab('/', 100, 0, 1)).toBeNull();
});
it('leaves vertical scrolling, short drags, two-finger gestures and other screens alone', () => {
  for (const [path, dx, dy, touches] of [['/plan', 90, 80, 1], ['/plan', 20, 0, 1], ['/plan', 100, 0, 2], ['/workout', 100, 0, 1]] as const) {
    expect(adjacentTab(path, dx, dy, touches)).toBeNull();
  }
});


test('tab dragging resists both edges and resolves to a bounded nearest tab', () => {
  expect(elasticTabPosition(-100, 300)).toBe(-18);
  expect(elasticTabPosition(400, 300)).toBe(318);
  expect(elasticTabPosition(120, 300)).toBe(120);
  expect(tabAtPosition(-18, 75, 5)).toBe(0);
  expect(tabAtPosition(318, 75, 5)).toBe(4);
  expect(tabAtPosition(160, 75, 5)).toBe(2);
});
