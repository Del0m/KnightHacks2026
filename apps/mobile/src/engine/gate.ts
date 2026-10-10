import type { Metrics, PrimaryGate } from './types';

/** Shared by counting and measurement so a rest position cannot supply a rep's range. */
export function gatePasses(gate: PrimaryGate | undefined, metrics: Metrics): boolean {
  if (!gate) return true;
  const value = metrics[gate.metric];
  if (value == null || !Number.isFinite(value)) return false;
  switch (gate.op) {
    case '<=': return value <= gate.value;
    case '>=': return value >= gate.value;
    case '<': return value < gate.value;
    case '>': return value > gate.value;
  }
}
