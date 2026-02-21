import { describe, it, expect, vi } from 'vitest';

// Must set env before any imports that reach config.ts
vi.stubEnv('PUMBLE_ADDON_MANIFEST_PATH', './manifest.json');

import { parseNumberedResponse } from '../runner';

describe('parseNumberedResponse', () => {
  it('parses numbered answers', () => {
    const text = '1. Did some coding\n2. Will do more coding\n3. None';
    const answers = parseNumberedResponse(text, 3);
    expect(answers).toEqual(['Did some coding', 'Will do more coding', 'None']);
  });

  it('parses answers with ) delimiter', () => {
    const text = '1) First\n2) Second';
    const answers = parseNumberedResponse(text, 2);
    expect(answers).toEqual(['First', 'Second']);
  });

  it('parses unnumbered answers', () => {
    const text = 'First answer\nSecond answer';
    const answers = parseNumberedResponse(text, 2);
    expect(answers).toEqual(['First answer', 'Second answer']);
  });

  it('pads with empty strings when fewer answers than questions', () => {
    const text = '1. Only one answer';
    const answers = parseNumberedResponse(text, 3);
    expect(answers).toEqual(['Only one answer', '', '']);
  });

  it('truncates extra answers', () => {
    const text = '1. A\n2. B\n3. C\n4. D';
    const answers = parseNumberedResponse(text, 2);
    expect(answers).toEqual(['A', 'B']);
  });

  it('handles empty input', () => {
    const answers = parseNumberedResponse('', 3);
    expect(answers).toEqual(['', '', '']);
  });

  it('skips blank lines', () => {
    const text = '1. First\n\n\n2. Second';
    const answers = parseNumberedResponse(text, 2);
    expect(answers).toEqual(['First', 'Second']);
  });
});
