import { describe, expect, it } from 'vitest';
import { TERRAIN_CODES } from '../data/terrain.js';
import { buildTerrainSplats } from './Terrain.js';

describe('Terrain splat blending invariants', () => {
  it('allocates correct splat buffer dimensions (4 texels per tile)', () => {
    const mapSize = 8;
    const tiles = new Uint8Array(mapSize * mapSize).fill(TERRAIN_CODES.GRASS);
    const splats = buildTerrainSplats({ size: mapSize, tiles });

    const expectedDimension = mapSize * 4;
    expect(splats.width).toBe(expectedDimension);
    expect(splats.height).toBe(expectedDimension);
    expect(splats.splat0.length).toBe(expectedDimension * expectedDimension * 4);
    expect(splats.splat1.length).toBe(expectedDimension * expectedDimension * 4);
  });

  it('preserves partition of unity (sum of biome weights = 255) for all texels', () => {
    // Construct a test map with all 7 terrain codes
    const codes = [
      TERRAIN_CODES.GRASS,
      TERRAIN_CODES.DIRT,
      TERRAIN_CODES.SAND,
      TERRAIN_CODES.SHALLOW,
      TERRAIN_CODES.WATER,
      TERRAIN_CODES.FOREST,
      TERRAIN_CODES.ROCK,
      TERRAIN_CODES.GRASS,
    ];
    const mapSize = 8;
    const tiles = new Uint8Array(mapSize * mapSize);
    for (let i = 0; i < tiles.length; i++) {
      tiles[i] = codes[i % codes.length];
    }

    const splats = buildTerrainSplats({ size: mapSize, tiles });
    const totalTexels = splats.width * splats.height;

    for (let i = 0; i < totalTexels; i++) {
      const offset = i * 4;
      const s0r = splats.splat0[offset];
      const s0g = splats.splat0[offset + 1];
      const s0b = splats.splat0[offset + 2];
      const s0a = splats.splat0[offset + 3];
      const s1r = splats.splat1[offset];
      const s1g = splats.splat1[offset + 1];
      const s1b = splats.splat1[offset + 2];
      const s1a = splats.splat1[offset + 3];

      // Sum of active channels must be exactly 255 (partition of unity)
      const sum = s0r + s0g + s0b + s0a + s1r + s1g;
      expect(sum).toBe(255);

      // Unused channels must strictly be 0
      expect(s1b).toBe(0);
      expect(s1a).toBe(0);
    }
  });

  it('correctly maps all 7 terrain codes to splat channels', () => {
    // Helper to get splat weights at tile (x, z)
    function getTileWeights(tileCode: number) {
      const single = buildTerrainSplats({ size: 1, tiles: new Uint8Array([tileCode]) });
      return {
        s0: [single.splat0[0], single.splat0[1], single.splat0[2], single.splat0[3]],
        s1: [single.splat1[0], single.splat1[1], single.splat1[2], single.splat1[3]],
      };
    }

    // Grass (code 0) -> splat0.r
    expect(getTileWeights(TERRAIN_CODES.GRASS)).toEqual({
      s0: [255, 0, 0, 0],
      s1: [0, 0, 0, 0],
    });

    // Dirt (code 1) -> splat0.g
    expect(getTileWeights(TERRAIN_CODES.DIRT)).toEqual({
      s0: [0, 255, 0, 0],
      s1: [0, 0, 0, 0],
    });

    // Sand (code 2) -> splat0.b
    expect(getTileWeights(TERRAIN_CODES.SAND)).toEqual({
      s0: [0, 0, 255, 0],
      s1: [0, 0, 0, 0],
    });

    // Shallow (code 3) -> splat0.a
    expect(getTileWeights(TERRAIN_CODES.SHALLOW)).toEqual({
      s0: [0, 0, 0, 255],
      s1: [0, 0, 0, 0],
    });

    // Water (code 4) -> splat1.r
    expect(getTileWeights(TERRAIN_CODES.WATER)).toEqual({
      s0: [0, 0, 0, 0],
      s1: [255, 0, 0, 0],
    });

    // Forest (code 5) -> Forest ground is grass -> splat0.r
    expect(getTileWeights(TERRAIN_CODES.FOREST)).toEqual({
      s0: [255, 0, 0, 0],
      s1: [0, 0, 0, 0],
    });

    // Rock (code 6) -> Rock ground is rock-ground -> splat1.g
    expect(getTileWeights(TERRAIN_CODES.ROCK)).toEqual({
      s0: [0, 0, 0, 0],
      s1: [0, 255, 0, 0],
    });

    // Unknown code -> fallback to grass
    expect(getTileWeights(99)).toEqual({
      s0: [255, 0, 0, 0],
      s1: [0, 0, 0, 0],
    });
  });

  it('preserves map coordinate orientation without transpose or flip', () => {
    // 2x2 map with four unique codes at the four corners:
    // (0, 0) = GRASS
    // (1, 0) = DIRT
    // (0, 1) = SHALLOW
    // (1, 1) = WATER
    const map = {
      size: 2,
      tiles: new Uint8Array([
        TERRAIN_CODES.GRASS,   // x=0, z=0
        TERRAIN_CODES.DIRT,    // x=1, z=0
        TERRAIN_CODES.SHALLOW, // x=0, z=1
        TERRAIN_CODES.WATER,   // x=1, z=1
      ]),
    };

    const splats = buildTerrainSplats(map);
    // width = 8, height = 8 texels
    const width = splats.width;

    // Texel (0, 0) -> x=0, z=0 -> GRASS -> splat0.r = 255
    const idx00 = (0 * width + 0) * 4;
    expect(splats.splat0[idx00]).toBe(255);
    expect(splats.splat0[idx00 + 1]).toBe(0);

    // Texel (4, 0) -> x=1, z=0 -> DIRT -> splat0.g = 255
    const idx10 = (0 * width + 4) * 4;
    expect(splats.splat0[idx10 + 1]).toBe(255);
    expect(splats.splat0[idx10]).toBe(0);

    // Texel (0, 4) -> x=0, z=1 -> SHALLOW -> splat0.a = 255
    const idx01 = (4 * width + 0) * 4;
    expect(splats.splat0[idx01 + 3]).toBe(255);
    expect(splats.splat0[idx01]).toBe(0);

    // Texel (4, 4) -> x=1, z=1 -> WATER -> splat1.r = 255
    const idx11 = (4 * width + 4) * 4;
    expect(splats.splat1[idx11]).toBe(255);
    expect(splats.splat0[idx11]).toBe(0);
  });

  it('guarantees partition of unity under bilinear interpolation across biome boundaries', () => {
    // 2x2 map with 4 different biomes
    const map = {
      size: 2,
      tiles: new Uint8Array([
        TERRAIN_CODES.GRASS,
        TERRAIN_CODES.DIRT,
        TERRAIN_CODES.SAND,
        TERRAIN_CODES.WATER,
      ]),
    };

    const splats = buildTerrainSplats(map);
    const width = splats.width;
    const height = splats.height;

    // Simulate bilinear sampling at arbitrary fractional coordinates (fx, fz)
    function sampleBilinear(fx: number, fz: number) {
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, width - 1);
      const z0 = Math.floor(fz);
      const z1 = Math.min(z0 + 1, height - 1);

      const tx = fx - x0;
      const tz = fz - z0;

      const w00 = (1 - tx) * (1 - tz);
      const w10 = tx * (1 - tz);
      const w01 = (1 - tx) * tz;
      const w11 = tx * tz;

      const getChannel = (texelX: number, texelZ: number, channel: number, isSplat1: boolean) => {
        const arr = isSplat1 ? splats.splat1 : splats.splat0;
        return arr[(texelZ * width + texelX) * 4 + channel] / 255;
      };

      let totalWeight = 0;
      // 6 biomes: splat0 (0..3), splat1 (0..1)
      for (let ch = 0; ch < 4; ch++) {
        const v =
          w00 * getChannel(x0, z0, ch, false) +
          w10 * getChannel(x1, z0, ch, false) +
          w01 * getChannel(x0, z1, ch, false) +
          w11 * getChannel(x1, z1, ch, false);
        totalWeight += v;
      }
      for (let ch = 0; ch < 2; ch++) {
        const v =
          w00 * getChannel(x0, z0, ch, true) +
          w10 * getChannel(x1, z0, ch, true) +
          w01 * getChannel(x0, z1, ch, true) +
          w11 * getChannel(x1, z1, ch, true);
        totalWeight += v;
      }

      return totalWeight;
    }

    // Test a grid of continuous coordinates across the tile boundaries
    for (let fz = 0; fz < height - 1; fz += 0.37) {
      for (let fx = 0; fx < width - 1; fx += 0.37) {
        const total = sampleBilinear(fx, fz);
        expect(total).toBeCloseTo(1.0, 5);
      }
    }
  });
});
