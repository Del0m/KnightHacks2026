import { adjacentTab } from '../tabSwipe';
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
