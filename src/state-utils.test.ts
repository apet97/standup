import { describe, it, expect } from 'vitest';
import { getStateValue, getStateValues } from './state-utils';

describe('getStateValue', () => {
  it('extracts single value', () => {
    const state = {
      values: {
        block1: {
          action1: { type: 'plain_text_input', value: 'hello' },
        },
      },
    };
    expect(getStateValue(state as any, 'block1', 'action1')).toBe('hello');
  });

  it('returns undefined for missing block', () => {
    const state = { values: {} };
    expect(getStateValue(state as any, 'missing', 'action')).toBeUndefined();
  });

  it('returns undefined for missing action', () => {
    const state = { values: { block1: {} } };
    expect(getStateValue(state as any, 'block1', 'missing')).toBeUndefined();
  });

  it('returns undefined for multi-value entry', () => {
    const state = {
      values: {
        block1: {
          action1: { type: 'checkboxes', values: ['a', 'b'] },
        },
      },
    };
    expect(getStateValue(state as any, 'block1', 'action1')).toBeUndefined();
  });

  it('returns undefined for undefined state', () => {
    expect(getStateValue(undefined, 'block1', 'action1')).toBeUndefined();
  });
});

describe('getStateValues', () => {
  it('extracts multi-value (checkboxes)', () => {
    const state = {
      values: {
        block1: {
          action1: { type: 'checkboxes', values: ['a', 'b', 'c'] },
        },
      },
    };
    expect(getStateValues(state as any, 'block1', 'action1')).toEqual(['a', 'b', 'c']);
  });

  it('wraps single value in array', () => {
    const state = {
      values: {
        block1: {
          action1: { type: 'select', value: 'single' },
        },
      },
    };
    expect(getStateValues(state as any, 'block1', 'action1')).toEqual(['single']);
  });

  it('returns empty array for missing', () => {
    expect(getStateValues(undefined, 'block1', 'action1')).toEqual([]);
    expect(getStateValues({ values: {} } as any, 'missing', 'action')).toEqual([]);
  });
});
