// The cloud transport's config for a camera screen (AI-17). The screen decides eligibility (camera
// check or debug screen, foreground and focused, signed in, consent for this account, mode cloud or
// paused, no local override); this builds the config, or null, which stops the transport.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { apiUrl } from '../screens/Auth/client';
import { nativeSocket, poseStreamUrl, type CloudFailure, type CreateSocket } from './cloud';
import { reportCloudAvailability } from './usePoseMode';
import type { CloudConfig } from './usePoseOutput';

let createSocket: CreateSocket = nativeSocket;

/** Test-only: fake sockets for the screens; null restores React Native's WebSocket. */
export function __setCloudSocketForTests(create: CreateSocket | null): void {
  createSocket = create ?? nativeSocket;
}

function streamUrl(): string | null {
  try { return poseStreamUrl(apiUrl); } catch { return null; }
}

/**
 * A new config (so a new client, with its backoff reset) when eligibility, the account or `attempt`
 * changes; the same one otherwise, so re-renders and cloud <-> paused flips keep the socket.
 */
export function useCloudConfig(opts: {
  enabled: boolean;
  userId: string | null | undefined;
  /** `useAuth().getApiToken`; read at call time, so a new closure each render doesn't reconnect. */
  getToken: () => Promise<string | null>;
  /** Bump to retry with a fresh client. */
  attempt?: number;
  onFailure?: (kind: CloudFailure) => void;
}): CloudConfig | null {
  const latest = useRef(opts);
  useLayoutEffect(() => { latest.current = opts; });
  const { enabled, userId, attempt = 0 } = opts;
  return useMemo<CloudConfig | null>(() => {
    const url = streamUrl();
    if (!enabled || !userId || !url) return null;
    return {
      url,
      createSocket,
      getToken: () => latest.current.getToken(),
      onAvailability: reportCloudAvailability,
      onFailure: (kind) => latest.current.onFailure?.(kind),
    };
    // `attempt` isn't read: a new value only gives the config a new identity, which reconnects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, userId, attempt]);
}
