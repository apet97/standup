import type { V1 } from './app-types';

type StateEntry = {
  type: string;
  value: string;
} | {
  type: string;
  values: string[];
};

/**
 * Extract a single value from modal state.
 * State structure: { values: { [blockId]: { [actionId]: { type, value } | { type, values } } } }
 */
export function getStateValue(
  state: V1.State | undefined,
  blockId: string,
  actionId: string
): string | undefined {
  if (!state?.values) return undefined;
  const block = state.values[blockId];
  if (!block) return undefined;
  const entry = block[actionId] as StateEntry | undefined;
  if (!entry) return undefined;
  if ('value' in entry) return entry.value;
  return undefined;
}

/**
 * Extract multi-select values from modal state.
 */
export function getStateValues(
  state: V1.State | undefined,
  blockId: string,
  actionId: string
): string[] {
  if (!state?.values) return [];
  const block = state.values[blockId];
  if (!block) return [];
  const entry = block[actionId] as StateEntry | undefined;
  if (!entry) return [];
  if ('values' in entry) return entry.values;
  if ('value' in entry) return [entry.value];
  return [];
}
