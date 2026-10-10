export { MAX_PRIMARY_DEG_PER_S, createFormEngine, type FormEngine } from './engine';
export { useFormEngine, type FormEngineState } from './useFormEngine';
export { EXERCISE_SPECS, getSpec } from './specs';
export { DEFAULT_ONE_EURO, JointSmoother, OneEuroFilter } from './oneEuro';
export { createMetricComputer, jointAngle, resolvePoint, segmentTilt, widthRatio, type MetricComputer } from './angles';
export { STILL_BAND_DEG, createRepCounter, type RepCounter } from './repCounter';
export { FRONT_MIN_RATIO, SIDE_MAX_RATIO, detectView, viewRatio } from './view';
export {
  MIN_COVERAGE,
  NEAR_EXTREME_DEG,
  createSetRules,
  evaluateRep,
  evaluateRule,
  fillRestNote,
  formatValue,
  phaseDuration,
  restNote,
  summarizeSet,
  type RulesEvent,
  type SetRules,
} from './rules';
export { useFormRules, type FormRulesState } from './useFormRules';
export { INJURY_ORDER, applyInjuries, applyOverride } from './overrides';
export {
  LEAD_IN_MS,
  MAX_SET_FRAMES,
  buildSetRecord,
  createSetRecorder,
  type SetRecord,
  type SetRecordInput,
  type SetRecorder,
} from './setRecord';
export * from './types';
