import { orderLabel } from '../index';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

describe('orderLabel', () => {
  it('matches the English ordinal rules without Intl', () => {
    const rules = new Intl.PluralRules('en', { type: 'ordinal' });
    const suffix: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
    for (let n = 1; n <= 200; n++) expect(orderLabel(n)).toBe(`${n}${suffix[rules.select(n)]}`);
  });
});
