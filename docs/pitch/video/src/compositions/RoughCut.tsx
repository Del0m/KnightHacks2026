import React from 'react';
import { AbsoluteFill, OffthreadVideo, Sequence, Series, getStaticFiles, staticFile } from 'remotion';
import script from '../data/script.json';
import { Caption } from '../components/Caption';
import { Slate } from '../components/Slate';
import { sec } from '../theme';
import { ArchitectureFlow } from './ArchitectureFlow';
import { CloseCard } from './Cards';
import { ProblemStats } from './ProblemStats';
import { SponsorCards } from './SponsorCards';

// The whole Devpost video, assembled from data/script.json. Screen recordings
// go in public/clips/<name>.mp4; any that are missing render as a slate.

const remotionBeats: Record<string, React.FC> = { ProblemStats, ArchitectureFlow: () => <ArchitectureFlow loop={false} />, SponsorCards, CloseCard };

const Clip: React.FC<{ name: string }> = ({ name }) => {
  const path = `clips/${name}.mp4`;
  const exists = getStaticFiles().some((f) => f.name === path);
  return exists ? <OffthreadVideo src={staticFile(path)} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Slate clip={name} />;
};

export const RoughCut: React.FC = () => (
  <AbsoluteFill style={{ background: 'black' }}>
    {script.beats.map((b) => {
      const length = sec(b.to - b.from);
      const Beat = b.remotion ? remotionBeats[b.remotion] : null;
      const clips = b.clips ?? [];
      const each = clips.length ? Math.floor(length / clips.length) : length;
      return (
        <Sequence key={b.id} from={sec(b.from)} durationInFrames={length} name={b.id}>
          {Beat ? (
            <Beat />
          ) : (
            <Series>
              {clips.map((c, i) => (
                <Series.Sequence key={c + i} durationInFrames={i === clips.length - 1 ? length - each * i : each}>
                  <Clip name={c} />
                </Series.Sequence>
              ))}
            </Series>
          )}
          {b.caption && <Caption text={b.caption} />}
        </Sequence>
      );
    })}
  </AbsoluteFill>
);
