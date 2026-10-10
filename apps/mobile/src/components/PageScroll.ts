import { createContext } from 'react';

/** Embedded native previews forward single-finger drags to their page. */
export const PageScroll = createContext<((delta: number) => void) | null>(null);
