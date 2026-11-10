import { describe, expect, it } from 'vitest';
import { parseHeadlessArgs } from './sim-headless.js';

describe('parseHeadlessArgs', () => {
  it('parses passive and Normal AI slots with an inclusive seed range', () => {
    const options = parseHeadlessArgs([
      '--p1',
      'none',
      '--p2',
      'crown:normal',
      '--seeds',
      '1-3',
    ]);

    expect(options.slots).toEqual([
      { kind: 'none', faction: 'crown' },
      { kind: 'ai', faction: 'crown', difficulty: 'normal' },
    ]);
    expect(options.seeds).toEqual([1, 2, 3]);
    expect(options.maxTicks).toBe(72000);
  });

  it('rejects reversed seed ranges', () => {
    expect(() => parseHeadlessArgs(['--seeds', '3-1'])).toThrow(
      /--seeds.*ascending/,
    );
  });

  it('rejects unavailable difficulties', () => {
    expect(() => parseHeadlessArgs(['--p1', 'crown:hard'])).toThrow(
      /--p1.*crown:hard/,
    );
  });

  it('defaults to the Alpha map, seed 1, and two Crown Normal AI slots', () => {
    expect(parseHeadlessArgs([])).toEqual({
      map: 'alpha_test',
      slots: [
        { kind: 'ai', faction: 'crown', difficulty: 'normal' },
        { kind: 'ai', faction: 'crown', difficulty: 'normal' },
      ],
      specifiedSlots: [],
      seeds: [1],
      maxTicks: 72000,
      json: false,
      help: false,
    });
  });

  it('keeps map ids and paths for resolution by the CLI', () => {
    expect(parseHeadlessArgs(['--map', 'custom']).map).toBe('custom');
    expect(parseHeadlessArgs(['--map', 'maps/custom.json']).map).toBe(
      'maps/custom.json',
    );
  });

  it('accepts all four slots and leaves Clans availability to each match', () => {
    const options = parseHeadlessArgs(['--p4', 'none', '--p3', 'clans:normal']);
    expect(options.slots).toEqual([
      { kind: 'ai', faction: 'crown', difficulty: 'normal' },
      { kind: 'ai', faction: 'crown', difficulty: 'normal' },
      { kind: 'ai', faction: 'clans', difficulty: 'normal' },
      { kind: 'none', faction: 'crown' },
    ]);
    expect(options.specifiedSlots).toEqual([3, 2]);
  });

  it('parses a single seed, custom tick limit, JSON, and help', () => {
    expect(
      parseHeadlessArgs([
        '--seeds',
        '7',
        '--max-ticks',
        '30000',
        '--json',
        '--help',
      ]),
    ).toMatchObject({ seeds: [7], maxTicks: 30000, json: true, help: true });
  });

  it.each(['--p0', '--p5', '--p01'])(
    'rejects invalid player slot %s',
    (flag) => {
      expect(() => parseHeadlessArgs([flag, 'none'])).toThrow(
        /Invalid player slot/,
      );
    },
  );

  it.each(['--map', '--p1', '--seeds', '--max-ticks'])(
    'rejects missing values for %s',
    (flag) => {
      expect(() => parseHeadlessArgs([flag])).toThrow(/Missing argument/);
      expect(() => parseHeadlessArgs([flag, '--json'])).toThrow(
        /Missing argument/,
      );
    },
  );

  it.each(['0', '-1', '1.5', '30ticks', '9007199254740992'])(
    'rejects invalid tick limit %s',
    (value) => {
      expect(() => parseHeadlessArgs(['--max-ticks', value])).toThrow(
        /--max-ticks/,
      );
    },
  );

  it.each(['1-3-5', '1.5', 'abc', '9007199254740992'])(
    'rejects malformed seed value %s',
    (value) => {
      expect(() => parseHeadlessArgs(['--seeds', value])).toThrow(/--seeds/);
    },
  );

  it('rejects unknown arguments', () => {
    expect(() => parseHeadlessArgs(['--unknown'])).toThrow(/Unknown argument/);
  });
});
