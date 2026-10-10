// Jest: MMKV's own in-memory mock, without loading Nitro's native module. One instance per id,
// like the real library, so a test can read what the code under test wrote.
const { createMockMMKV } = jest.requireActual('react-native-mmkv/lib/createMMKV/createMockMMKV');

const instances = new Map<string, unknown>();

export function createMMKV(config: { id?: string } = {}) {
  const id = config.id ?? 'mmkv.default';
  if (!instances.has(id)) instances.set(id, createMockMMKV({ ...config, id }));
  return instances.get(id);
}

export type MMKV = ReturnType<typeof createMockMMKV>;
