import { createContext } from 'react';

/** Embedded native previews forward single-finger drags to their page. */
export const PageScroll = createContext<((delta: number) => void) | null>(null);

/** Sliders reserve vertical scrolling while held; each control owns its lock. */
export const PageScrollLock = createContext<((control: string, locked: boolean) => void) | null>(null);
