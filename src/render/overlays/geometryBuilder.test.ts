import { describe, expect, it } from 'vitest';
import type {
  InterpolatedEntity,
  SessionSnapshot,
} from '../../game/GameSession';
import type { UnitEntity } from '../../sim/entity';
import {
  COLOR_LINE_GREEN,
  COLOR_LINE_RED,
  OverlayGeometryBuilder,
} from './geometryBuilder';

function createMockUnitEntity(overrides: Partial<UnitEntity> = {}): UnitEntity {
  return {
    id: 1,
    kind: 'unit',
    player: 0,
    type: 'crown_spearman',
    faction: 'crown',
    x: 10,
    z: 10,
    previousX: 10,
    previousZ: 10,
    radius: 0.35,
    speed: 1,
    baseSpeed: 1,
    facing: 0,
    hp: 100,
    maxHp: 100,
    pop: 1,
    lineOfSight: 5,
    tags: [],
    orders: [],
    orderGeneration: 1,
    stuckTicks: 0,
    stuckProgressX: 0,
    stuckProgressZ: 0,
    stuckLastCheckTick: 0,
    ...overrides,
  };
}

function createMockSnapshot(
  unitRaw: UnitEntity,
  overrides: Partial<InterpolatedEntity> = {},
): SessionSnapshot {
  const interpolated: InterpolatedEntity = {
    id: unitRaw.id,
    kind: unitRaw.kind,
    player: unitRaw.player,
    x: unitRaw.x,
    z: unitRaw.z,
    simX: unitRaw.x,
    simZ: unitRaw.z,
    previousX: unitRaw.previousX,
    previousZ: unitRaw.previousZ,
    radius: unitRaw.radius,
    hp: unitRaw.hp,
    maxHp: unitRaw.maxHp,
    raw: unitRaw,
    ...overrides,
  };

  return {
    tick: 1,
    alpha: 0,
    simTime: 0.05,
    entities: [interpolated],
  };
}

describe('OverlayGeometryBuilder', () => {
  it('queued move -> attackMove route ends with a cross in the attack-move colour (regression for ReviewRender#3)', () => {
    const builder = new OverlayGeometryBuilder();

    // Unit currently has a 'move' order toward (20, 20), and a queued 'attackMove' order to (30, 30)
    const unitRaw = createMockUnitEntity({
      x: 10,
      z: 10,
      order: { kind: 'move', x: 20, z: 20 },
      orders: [{ kind: 'attackMove', x: 30, z: 30 }],
    });
    const snapshot = createMockSnapshot(unitRaw);

    builder.build({
      snapshot,
      selectedIds: [unitRaw.id],
    });

    // There should be line segments:
    // 1. Move segment (10, 10) -> (20, 20) [Green]
    // 2. Attack-move segment (20, 20) -> (30, 30) [Red]
    // 3. Destination cross arms at (30, 30) [MUST be Red per ReviewRender#3]
    expect(builder.lineSegmentCount).toBeGreaterThanOrEqual(4);

    const segCount = builder.lineSegmentCount;
    const horizArm = builder.getLineSegment(segCount - 2);
    const vertArm = builder.getLineSegment(segCount - 1);

    // Cross is centered at destination (30, 30) with arm length 0.25
    expect(horizArm.x1).toBeCloseTo(30 - 0.25);
    expect(horizArm.x2).toBeCloseTo(30 + 0.25);
    expect(horizArm.z1).toBeCloseTo(30);
    expect(horizArm.z2).toBeCloseTo(30);

    expect(vertArm.x1).toBeCloseTo(30);
    expect(vertArm.x2).toBeCloseTo(30);
    expect(vertArm.z1).toBeCloseTo(30 - 0.25);
    expect(vertArm.z2).toBeCloseTo(30 + 0.25);

    // Verify cross color matches COLOR_LINE_RED (attackMove) and NOT COLOR_LINE_GREEN (move)
    expect(horizArm.r).toBeCloseTo(COLOR_LINE_RED[0]);
    expect(horizArm.g).toBeCloseTo(COLOR_LINE_RED[1]);
    expect(horizArm.b).toBeCloseTo(COLOR_LINE_RED[2]);
    expect(horizArm.a).toBeCloseTo(COLOR_LINE_RED[3]);

    expect(vertArm.r).toBeCloseTo(COLOR_LINE_RED[0]);
    expect(vertArm.g).toBeCloseTo(COLOR_LINE_RED[1]);
    expect(vertArm.b).toBeCloseTo(COLOR_LINE_RED[2]);
    expect(vertArm.a).toBeCloseTo(COLOR_LINE_RED[3]);

    // Ensure it's not green
    expect(horizArm.g).not.toBeCloseTo(COLOR_LINE_GREEN[1]);
    expect(vertArm.g).not.toBeCloseTo(COLOR_LINE_GREEN[1]);
  });

  it("unit's bar height does not change when only its animation frame changes (regression for ReviewRender#0)", () => {
    const builder = new OverlayGeometryBuilder();

    const unitRaw = createMockUnitEntity({
      id: 42,
      hp: 100,
      maxHp: 100,
    });
    const snapshot = createMockSnapshot(unitRaw);

    // Stable sprite top px per asset (provided by Renderer)
    const stableSpriteTop = 85;
    const getSpriteTopPx = (id: number) =>
      id === 42 ? stableSpriteTop : undefined;

    // Frame 1: time = 0.0s
    builder.build({
      snapshot,
      selectedIds: [42],
      timeSeconds: 0.0,
      getSpriteTopPx,
    });

    expect(builder.healthBarCount).toBe(1);
    const barFrame1 = builder.getHealthBar(0);
    const initialBarY = barFrame1.barY;

    // Frame 2: time = 0.5s (unit animation frame has progressed, but getSpriteTopPx is stable)
    builder.build({
      snapshot,
      selectedIds: [42],
      timeSeconds: 0.5,
      getSpriteTopPx,
    });

    expect(builder.healthBarCount).toBe(1);
    const barFrame2 = builder.getHealthBar(0);
    const nextBarY = barFrame2.barY;

    // Bar Y position must be completely identical across animation frames
    expect(nextBarY).toBe(initialBarY);

    // Frame 3: facing or frame changed
    const unitFacingChanged = createMockUnitEntity({
      id: 42,
      facing: 5,
      hp: 100,
      maxHp: 100,
    });
    const snapshotFacing = createMockSnapshot(unitFacingChanged);

    builder.build({
      snapshot: snapshotFacing,
      selectedIds: [42],
      timeSeconds: 1.0,
      getSpriteTopPx,
    });

    const barFrame3 = builder.getHealthBar(0);
    expect(barFrame3.barY).toBe(initialBarY);
  });
});
