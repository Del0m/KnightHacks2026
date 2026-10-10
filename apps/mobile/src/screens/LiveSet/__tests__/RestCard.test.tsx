/* eslint-disable @typescript-eslint/no-require-imports -- Renderer matches existing mobile tests. */
import React from 'react';
import { Text } from 'react-native';
import { RestCard, useServerRestResult } from '../RestCard';
import { phoneNote, restCardContent, type PhoneResult, type ServerRestResult } from '../restCardContent';
const { act, create } = require('react-test-renderer');

const phone: PhoneResult = { medal: 'silver', cleanReps: 6, totalReps: 8 };
const server: ServerRestResult = {
  score: { medal: 'silver', source: 'databricks' },
  rest_note: { text: '6 of 8 reps were clean. Knees tracking over the toes tends to feel steadier.', source: 'llm', rule_id: 'knee_tracking' },
};
const texts = (screen: ReturnType<typeof create>) => screen.root.findAllByType(Text).map((n: { props: { children: unknown } }) => n.props.children).join(' | ');

describe('rest card content', () => {
  it('uses the same good-news line as the API', () => {
    expect(phoneNote(phone)).toBe('6 of 8 reps were clean.');
    expect(phoneNote({ medal: 'bronze', cleanReps: 0, totalReps: 5 })).toBe('5 reps done.');
  });

  it('shows the phone result until the server result arrives during the rest', () => {
    expect(restCardContent(phone, null, true)).toEqual({ medal: 'silver', note: '6 of 8 reps were clean.', fromServer: false });
    expect(restCardContent(phone, server, true)).toMatchObject({ note: server.rest_note.text, fromServer: true });
    expect(restCardContent(phone, server, false).fromServer).toBe(false);
  });
});

describe('RestCard', () => {
  it("labels the medal as this set's and shows the note and timer", () => {
    let screen: ReturnType<typeof create>;
    act(() => { screen = create(<RestCard phone={phone} server={null} secondsLeft={42} />); });
    expect(texts(screen!)).toContain('Silver');
    expect(texts(screen!)).toContain('This set’s medal');
    expect(texts(screen!)).toContain('6 of 8 reps were clean.');
    expect(texts(screen!)).toContain('42');
    act(() => screen.update(<RestCard phone={phone} server={server} secondsLeft={41} />));
    expect(texts(screen!)).toContain(server.rest_note.text);
    act(() => screen.unmount());
  });
});

describe('useServerRestResult', () => {
  function Probe({ request, resting, onResult }: { request: Promise<ServerRestResult> | null; resting: boolean; onResult: (r: ServerRestResult | null) => void }) {
    onResult(useServerRestResult(request, resting));
    return null;
  }

  it('keeps a result that arrives during the rest', async () => {
    let latest: ServerRestResult | null = null;
    let resolve!: (r: ServerRestResult) => void;
    const request = new Promise<ServerRestResult>((r) => { resolve = r; });
    let screen: ReturnType<typeof create>;
    act(() => { screen = create(<Probe request={request} resting onResult={(r) => { latest = r; }} />); });
    expect(latest).toBeNull();
    await act(async () => { resolve(server); await request; });
    expect(latest).toEqual(server);
    act(() => screen.unmount());
  });

  it('ignores a result that arrives after the rest ended, and a failed request', async () => {
    let latest: ServerRestResult | null = null;
    let resolve!: (r: ServerRestResult) => void;
    const request = new Promise<ServerRestResult>((r) => { resolve = r; });
    let screen: ReturnType<typeof create>;
    act(() => { screen = create(<Probe request={request} resting onResult={(r) => { latest = r; }} />); });
    act(() => screen.update(<Probe request={request} resting={false} onResult={(r) => { latest = r; }} />));
    await act(async () => { resolve(server); await request; });
    expect(latest).toBeNull();
    const failed = Promise.reject(new Error('offline'));
    act(() => screen.update(<Probe request={failed} resting onResult={(r) => { latest = r; }} />));
    await act(async () => { await failed.catch(() => {}); });
    expect(latest).toBeNull();
    act(() => screen.unmount());
  });
});
