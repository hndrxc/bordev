import { describe, expect, it } from 'vitest';
import type { AtlasFrame } from '../assets/atlas';
import { worldToScreen, type IsoView } from './iso';
import {
  pickFrontmost,
  writeSpriteScreenRect,
  type CachedEntityRect,
} from './Renderer';

function projectScreenIndependent(
  worldX: number,
  worldZ: number,
  view: IsoView,
): { x: number; y: number } {
  const dx = worldX - view.targetX;
  const dz = worldZ - view.targetZ;
  return {
    x: view.width * 0.5 + (dx - dz) * 48 * view.zoom,
    y: view.height * 0.5 + (dx + dz) * 24 * view.zoom,
  };
}

function createEmptyRect(id = 1, kind = 'unit'): CachedEntityRect {
  return {
    id,
    kind,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    depth: 0,
    frameAy: 0,
    stamp: 0,
  };
}

describe('writeSpriteScreenRect', () => {
  const zooms = [0.5, 1, 1.5] as const;

  const unitFrame: AtlasFrame = {
    page: 0,
    x: 10,
    y: 10,
    w: 45,
    h: 108,
    ax: 22,
    ay: 103,
  };

  const buildingFrame: AtlasFrame = {
    page: 0,
    x: 0,
    y: 0,
    w: 470,
    h: 325,
    ax: 188,
    ay: 228,
  };

  for (const zoom of zooms) {
    it(`projects unit frame corners at zoom ${zoom} matching independent projection`, () => {
      const view: IsoView = {
        targetX: 20,
        targetZ: 20,
        width: 1280,
        height: 720,
        zoom,
      };
      const anchorX = 25.5;
      const anchorZ = 18.25;

      const out = createEmptyRect(101, 'unit');
      writeSpriteScreenRect(
        out,
        101,
        'unit',
        anchorX,
        anchorZ,
        unitFrame,
        view,
        1,
      );

      const independentAnchor = projectScreenIndependent(
        anchorX,
        anchorZ,
        view,
      );
      const isoAnchor = worldToScreen(anchorX, anchorZ, view);

      expect(isoAnchor.x).toBeCloseTo(independentAnchor.x, 9);
      expect(isoAnchor.y).toBeCloseTo(independentAnchor.y, 9);

      const expectedLeft = independentAnchor.x - unitFrame.ax * zoom;
      const expectedTop = independentAnchor.y - unitFrame.ay * zoom;
      const expectedRight =
        independentAnchor.x + (unitFrame.w - unitFrame.ax) * zoom;
      const expectedBottom =
        independentAnchor.y + (unitFrame.h - unitFrame.ay) * zoom;
      const expectedDepth = anchorX + anchorZ;

      expect(out.left).toBeCloseTo(expectedLeft, 9);
      expect(out.top).toBeCloseTo(expectedTop, 9);
      expect(out.right).toBeCloseTo(expectedRight, 9);
      expect(out.bottom).toBeCloseTo(expectedBottom, 9);
      expect(out.depth).toBeCloseTo(expectedDepth, 9);
      expect(out.frameAy).toBe(unitFrame.ay);
    });

    it(`projects building frame corners at zoom ${zoom} matching independent projection`, () => {
      const view: IsoView = {
        targetX: 30,
        targetZ: 30,
        width: 1920,
        height: 1080,
        zoom,
      };
      const anchorX = 32;
      const anchorZ = 32;

      const out = createEmptyRect(202, 'building');
      writeSpriteScreenRect(
        out,
        202,
        'building',
        anchorX,
        anchorZ,
        buildingFrame,
        view,
        2,
      );

      const independentAnchor = projectScreenIndependent(
        anchorX,
        anchorZ,
        view,
      );
      const isoAnchor = worldToScreen(anchorX, anchorZ, view);

      expect(isoAnchor.x).toBeCloseTo(independentAnchor.x, 9);
      expect(isoAnchor.y).toBeCloseTo(independentAnchor.y, 9);

      const expectedLeft = independentAnchor.x - buildingFrame.ax * zoom;
      const expectedTop = independentAnchor.y - buildingFrame.ay * zoom;
      const expectedRight =
        independentAnchor.x + (buildingFrame.w - buildingFrame.ax) * zoom;
      const expectedBottom =
        independentAnchor.y + (buildingFrame.h - buildingFrame.ay) * zoom;
      const expectedDepth = anchorX + anchorZ;

      expect(out.left).toBeCloseTo(expectedLeft, 9);
      expect(out.top).toBeCloseTo(expectedTop, 9);
      expect(out.right).toBeCloseTo(expectedRight, 9);
      expect(out.bottom).toBeCloseTo(expectedBottom, 9);
      expect(out.depth).toBeCloseTo(expectedDepth, 9);
      expect(out.frameAy).toBe(buildingFrame.ay);
    });
  }
});

describe('pickFrontmost', () => {
  it('returns greatest-depth rect for overlapping rects', () => {
    const rectLow: CachedEntityRect = {
      id: 1,
      kind: 'unit',
      left: 100,
      top: 100,
      right: 200,
      bottom: 200,
      depth: 10,
      frameAy: 50,
      stamp: 1,
    };
    const rectHigh: CachedEntityRect = {
      id: 2,
      kind: 'unit',
      left: 120,
      top: 120,
      right: 220,
      bottom: 220,
      depth: 50,
      frameAy: 50,
      stamp: 1,
    };
    const rectMid: CachedEntityRect = {
      id: 3,
      kind: 'building',
      left: 110,
      top: 110,
      right: 210,
      bottom: 210,
      depth: 30,
      frameAy: 100,
      stamp: 1,
    };

    const rects = [rectLow, rectHigh, rectMid];

    // (150, 150) is covered by all 3 rects; depth 50 wins
    expect(pickFrontmost(rects, 3, 150, 150)).toBe(2);

    // (105, 105) is only covered by rectLow
    expect(pickFrontmost(rects, 3, 105, 105)).toBe(1);

    // (215, 215) is only covered by rectHigh
    expect(pickFrontmost(rects, 3, 215, 215)).toBe(2);
  });

  it('handles depth ties deterministically', () => {
    const rectA: CachedEntityRect = {
      id: 10,
      kind: 'unit',
      left: 100,
      top: 100,
      right: 200,
      bottom: 200,
      depth: 40,
      frameAy: 50,
      stamp: 1,
    };
    const rectB: CachedEntityRect = {
      id: 20,
      kind: 'unit',
      left: 100,
      top: 100,
      right: 200,
      bottom: 200,
      depth: 40,
      frameAy: 50,
      stamp: 1,
    };

    // When rectA precedes rectB, rectA wins and repeated calls return the same ID
    expect(pickFrontmost([rectA, rectB], 2, 150, 150)).toBe(10);
    expect(pickFrontmost([rectA, rectB], 2, 150, 150)).toBe(10);

    // When rectB precedes rectA, rectB wins
    expect(pickFrontmost([rectB, rectA], 2, 150, 150)).toBe(20);
    expect(pickFrontmost([rectB, rectA], 2, 150, 150)).toBe(20);
  });

  it('returns undefined outside all rects', () => {
    const rect: CachedEntityRect = {
      id: 1,
      kind: 'unit',
      left: 100,
      top: 100,
      right: 200,
      bottom: 200,
      depth: 10,
      frameAy: 50,
      stamp: 1,
    };

    expect(pickFrontmost([rect], 1, 50, 50)).toBeUndefined();
    expect(pickFrontmost([rect], 1, 250, 250)).toBeUndefined();
    expect(pickFrontmost([rect], 0, 150, 150)).toBeUndefined();
    expect(pickFrontmost([], 0, 150, 150)).toBeUndefined();
  });

  it('ignores doodad rects even if they have higher depth', () => {
    const unitRect: CachedEntityRect = {
      id: 5,
      kind: 'unit',
      left: 100,
      top: 100,
      right: 200,
      bottom: 200,
      depth: 10,
      frameAy: 50,
      stamp: 1,
    };
    const doodadRect: CachedEntityRect = {
      id: 99,
      kind: 'doodad',
      left: 100,
      top: 100,
      right: 200,
      bottom: 200,
      depth: 1000,
      frameAy: 50,
      stamp: 1,
    };

    expect(pickFrontmost([unitRect, doodadRect], 2, 150, 150)).toBe(5);
  });
});
