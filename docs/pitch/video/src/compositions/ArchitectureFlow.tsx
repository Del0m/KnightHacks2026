import React from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import arch from '../data/architecture.json';
import { color, font, sec } from '../theme';

// R2: the architecture builds up one part at a time, then the offload path
// lights up in amber. Plays as a silent loop on the deck's how slide and as
// the 1:45 beat of the Devpost video.

const ORIGIN = { x: 128, y: 230 };

type Line = { text: string; sub: string; at?: number; offload?: boolean; offloadSub?: string };
type Node = { id: string; footer?: string; title: string; color: string; x: number; y: number; w: number; h: number; at: number; lines: Line[] };
type Edge = { id: string; x1: number; y1: number; x2: number; y2: number; at: number; both?: boolean; offload?: boolean; label: string; lx: number; ly: number };

const OFFLOAD_NODES = new Set(['phone', 'api', 'huggingface']);
const OFFLOAD_EDGES = new Set(['frames', 'relay']);

const fadeIn = (frame: number, start: number, length = 12) =>
  interpolate(frame, [start, start + length], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

export const ArchitectureFlow: React.FC<{ loop?: boolean }> = ({ loop = true }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const offloadStart = sec(arch.offloadAt);
  const offload = fadeIn(frame, offloadStart, 15);
  // Fade the whole frame out at the end so the loop restarts cleanly.
  const outro = loop ? interpolate(frame, [durationInFrames - 18, durationInFrames - 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1;

  const caption = [...arch.captions].reverse().find((c) => frame >= sec(c.at));
  const captionStart = caption ? sec(caption.at) : 0;

  return (
    <AbsoluteFill style={{ background: color.light, fontFamily: font.body, color: color.navy }}>
      <AbsoluteFill style={{ opacity: outro }}>
        <div style={{ position: 'absolute', left: ORIGIN.x, top: 64, opacity: fadeIn(frame, 0, 15) }}>
          <p style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: 3, textTransform: 'uppercase', color: color.blue }}>How it works</p>
          <h1 style={{ margin: '8px 0 0', fontFamily: font.display, fontSize: 76, fontWeight: 700, lineHeight: 1.05 }}>
            Five parts, each doing the job it's fastest at.
          </h1>
        </div>

        <div style={{ position: 'absolute', left: ORIGIN.x, top: ORIGIN.y, width: 1664, height: 680 }}>
          {(arch.nodes as Node[]).map((n) => (
            <NodeBox key={n.id} node={n} frame={frame} fps={fps} offload={offload} />
          ))}
          <svg width={1664} height={680} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
            {(arch.edges as Edge[]).map((e) => (
              <EdgeLine key={e.id} edge={e} frame={frame} offload={offload} />
            ))}
          </svg>
          {(arch.edges as Edge[]).filter((e) => e.label).map((e) => (
            <p
              key={e.id}
              style={{
                position: 'absolute', left: e.lx, top: e.ly, margin: 0, width: 190, fontSize: 24, lineHeight: 1.15, whiteSpace: 'pre-line',
                fontStyle: 'italic', fontWeight: e.offload ? 700 : 400,
                color: e.offload ? color.amberText : color.navy,
                opacity: fadeIn(frame, sec(e.at) + 6) * (e.offload || OFFLOAD_EDGES.has(e.id) ? 1 : 1 - 0.65 * offload),
              }}
            >
              {e.label}
            </p>
          ))}
        </div>

        {caption && (
          <div
            style={{
              position: 'absolute', left: ORIGIN.x, right: ORIGIN.x, bottom: 44, padding: '18px 28px', borderRadius: 16,
              background: caption.offload ? color.amberTint : color.blueTint,
              borderLeft: `6px solid ${caption.offload ? color.amber : color.blue}`,
              fontSize: 32, fontWeight: 600, lineHeight: 1.25,
              color: caption.offload ? color.amberText : color.navy,
              opacity: fadeIn(frame, captionStart, 8),
              transform: `translateY(${interpolate(fadeIn(frame, captionStart, 8), [0, 1], [10, 0])}px)`,
            }}
          >
            {caption.text}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const NodeBox: React.FC<{ node: Node; frame: number; fps: number; offload: number }> = ({ node, frame, fps, offload }) => {
  const appear = spring({ frame: frame - sec(node.at), fps, config: { damping: 200 }, durationInFrames: 18 });
  const dim = OFFLOAD_NODES.has(node.id) ? 1 : 1 - 0.65 * offload;
  return (
    <div
      style={{
        position: 'absolute', left: node.x, top: node.y, width: node.w, height: node.h, boxSizing: 'border-box',
        background: color.white, border: `3px solid ${node.color}`, borderRadius: 28, padding: '24px 28px',
        display: 'flex', flexDirection: 'column', gap: 14,
        opacity: appear * dim, transform: `translateY(${(1 - appear) * 24}px) scale(${0.96 + 0.04 * appear})`,
      }}
    >
      <h3 style={{ margin: 0, fontSize: 34, fontWeight: 700, color: node.color }}>{node.title}</h3>
      {node.lines.map((l) => {
        const lit = l.at === undefined ? 1 : fadeIn(frame, sec(l.at), 10);
        const offloaded = (l.offload || l.offloadSub ? 1 : 0) * offload;
        return (
          <div
            key={l.text}
            style={{
              opacity: l.at === undefined ? 1 : 0.25 + 0.75 * lit,
              borderLeft: `5px solid ${offloaded > 0.5 ? color.amber : l.at === undefined ? 'transparent' : node.color}`,
              paddingLeft: 14,
              background: offloaded > 0.5 ? color.amberTint : 'transparent',
              borderRadius: 6,
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 700, color: offloaded > 0.5 ? color.amberText : color.navy }}>{l.text}</div>
            <div style={{ fontSize: 22, color: offloaded > 0.5 ? color.amberText : color.muted }}>
              {offloaded > 0.5 && l.offloadSub ? l.offloadSub : l.sub}
            </div>
          </div>
        );
      })}
      {node.footer && (
        <p style={{ margin: 'auto 0 0', fontSize: 24, fontWeight: 600, color: color.blue }}>{node.footer}</p>
      )}
    </div>
  );
};

const EdgeLine: React.FC<{ edge: Edge; frame: number; offload: number }> = ({ edge, frame, offload }) => {
  const start = sec(edge.at);
  const drawn = interpolate(frame, [start, start + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  if (drawn === 0) return null;
  const x2 = edge.x1 + (edge.x2 - edge.x1) * drawn;
  const y2 = edge.y1 + (edge.y2 - edge.y1) * drawn;
  const stroke = edge.offload ? color.amber : color.navy;
  const dim = edge.offload ? 1 : 1 - 0.65 * offload;
  const angle = Math.atan2(edge.y2 - edge.y1, edge.x2 - edge.x1);

  // Pulses travel along the edge once it is drawn, to show data moving.
  const period = sec(1.2);
  const t = frame - start - 14;
  const pulses: number[] = [];
  if (t >= 0) {
    pulses.push((t % period) / period);
    if (edge.both) pulses.push(1 - ((t + period / 2) % period) / period);
  }

  return (
    <g opacity={dim}>
      <line x1={edge.x1} y1={edge.y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={edge.offload ? 5 : 3} strokeDasharray={edge.offload ? '14 10' : undefined} />
      {drawn === 1 && <Arrowhead x={edge.x2} y={edge.y2} angle={angle} fill={stroke} />}
      {drawn === 1 && edge.both && <Arrowhead x={edge.x1} y={edge.y1} angle={angle + Math.PI} fill={stroke} />}
      {pulses.map((p, i) => (
        <circle key={i} cx={edge.x1 + (edge.x2 - edge.x1) * p} cy={edge.y1 + (edge.y2 - edge.y1) * p} r={edge.offload ? 9 : 7} fill={edge.offload ? color.amber : color.blue} />
      ))}
    </g>
  );
};

const Arrowhead: React.FC<{ x: number; y: number; angle: number; fill: string }> = ({ x, y, angle, fill }) => {
  const size = 16;
  const a = (d: number) => `${x - size * Math.cos(angle + d)},${y - size * Math.sin(angle + d)}`;
  return <polygon points={`${x},${y} ${a(0.45)} ${a(-0.45)}`} fill={fill} />;
};
