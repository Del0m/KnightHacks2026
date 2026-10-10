/* eslint-disable @typescript-eslint/no-require-imports -- Existing renderer test setup. */
import React from 'react';
import { Text } from 'react-native';
import { useAuth } from '../session';
import { AccountGate } from '../AccountGate';
const { act, create } = require('react-test-renderer');
jest.mock('../session', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/components/AppPage', () => ({
  AppPage: ({ children }: { children: React.ReactNode }) => children,
  Action: ({ children }: { children: string }) => require('react').createElement(require('react-native').Text, null, children),
  ui: {},
}));
let renderer: ReturnType<typeof create>;
afterEach(() => act(() => renderer.unmount()));
it.each(['Feed', 'Buddies', 'Me'])('does not mount %s account content for guests', title => {
  jest.mocked(useAuth).mockReturnValue({ user: null, loading: false } as never);
  const mount = jest.fn();
  function PrivateContent() { mount(); return <Text>Private</Text>; }
  act(() => { renderer = create(<AccountGate title={title}><PrivateContent /></AccountGate>); });
  expect(mount).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType(Text).some((node: { props: { children: unknown } }) => node.props.children === 'Log in')).toBe(true);
});
it('holds account content while restoring a session', () => {
  jest.mocked(useAuth).mockReturnValue({ user: null, loading: true } as never);
  act(() => { renderer = create(<AccountGate title="Me"><Text>Private</Text></AccountGate>); });
  expect(renderer.root.findAllByType(Text).some((node: { props: { children: unknown } }) => node.props.children === 'Private')).toBe(false);
});
it('relocks mounted account content immediately after logout', () => {
  jest.mocked(useAuth).mockReturnValue({ user: { id: 'first' }, loading: false } as never);
  act(() => { renderer = create(<AccountGate title="Me"><Text>Private</Text></AccountGate>); });
  expect(renderer.root.findByType(Text).props.children).toBe('Private');
  jest.mocked(useAuth).mockReturnValue({ user: null, loading: false } as never);
  act(() => { renderer.update(<AccountGate title="Me"><Text>Private</Text></AccountGate>); });
  expect(renderer.root.findAllByType(Text).some((node: { props: { children: unknown } }) => node.props.children === 'Private')).toBe(false);
});
