import React from 'react';
import { Composition } from 'remotion';
import arch from './data/architecture.json';
import script from './data/script.json';
import { ArchitectureFlow } from './compositions/ArchitectureFlow';
import { CloseCard, TitleCard } from './compositions/Cards';
import { ProblemStats } from './compositions/ProblemStats';
import { RoughCut } from './compositions/RoughCut';
import { SponsorCards } from './compositions/SponsorCards';
import { FPS, sec } from './theme';

const size = { width: 1920, height: 1080, fps: FPS };
const totalSeconds = script.beats[script.beats.length - 1].to;

export const Root: React.FC = () => (
  <>
    <Composition id="ProblemStats" component={ProblemStats} durationInFrames={sec(20)} {...size} />
    <Composition id="ArchitectureFlow" component={ArchitectureFlow} durationInFrames={sec(arch.duration)} defaultProps={{ loop: true }} {...size} />
    <Composition id="SponsorCards" component={SponsorCards} durationInFrames={sec(15)} defaultProps={{ includeUnbuilt: false }} {...size} />
    <Composition id="TitleCard" component={TitleCard} durationInFrames={sec(4)} {...size} />
    <Composition id="CloseCard" component={CloseCard} durationInFrames={sec(5)} defaultProps={{ team: '[Team names]' }} {...size} />
    <Composition id="RoughCut" component={RoughCut} durationInFrames={sec(totalSeconds)} {...size} />
  </>
);
