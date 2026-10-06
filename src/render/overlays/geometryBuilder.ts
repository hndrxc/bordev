import type { SessionSnapshot } from '../../game/GameSession';
import { PPU } from '../iso';

export interface OrderMarker {
  x: number;
  z: number;
  kind: 'move' | 'attackMove';
  expiresAt: number;
}

export interface PlacementGhostItem {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly valid: boolean;
}

export interface OverlayGeometryInput {
  snapshot?: SessionSnapshot;
  selectedIds?: readonly number[];
  markers?: readonly OrderMarker[];
  timeSeconds?: number;
  getSpriteTopPx?: (id: number) => number | undefined;
  placement?: readonly PlacementGhostItem[];
}

export const COLOR_LINE_GREEN: readonly [number, number, number, number] = [
  0.2, 0.9, 0.35, 0.85,
];
export const COLOR_LINE_RED: readonly [number, number, number, number] = [
  0.95, 0.2, 0.2, 0.85,
];
export const COLOR_LINE_YELLOW: readonly [number, number, number, number] = [
  1.0, 0.82, 0.2, 0.85,
];

export const COLOR_FRIENDLY: readonly [number, number, number, number] = [
  0.2, 0.9, 0.35, 0.95,
];
export const COLOR_ENEMY: readonly [number, number, number, number] = [
  0.95, 0.2, 0.2, 0.95,
];
export const COLOR_NEUTRAL: readonly [number, number, number, number] = [
  0.95, 0.9, 0.25, 0.95,
];

export function computePlacementMatrix(
  out: Float32Array,
  offset: number,
  x: number,
  z: number,
  width: number,
  height: number,
  elevation = 0.015,
): void {
  out[offset + 0] = width;
  out[offset + 1] = 0;
  out[offset + 2] = 0;
  out[offset + 3] = 0;

  out[offset + 4] = 0;
  out[offset + 5] = 1;
  out[offset + 6] = 0;
  out[offset + 7] = 0;

  out[offset + 8] = 0;
  out[offset + 9] = 0;
  out[offset + 10] = height;
  out[offset + 11] = 0;

  out[offset + 12] = x;
  out[offset + 13] = elevation;
  out[offset + 14] = z;
  out[offset + 15] = 1;
}

export function computePlacementColor(
  out: Float32Array,
  offset: number,
  valid: boolean,
): void {
  if (valid) {
    out[offset + 0] = COLOR_LINE_GREEN[0];
    out[offset + 1] = COLOR_LINE_GREEN[1];
    out[offset + 2] = COLOR_LINE_GREEN[2];
    out[offset + 3] = 1.0;
  } else {
    out[offset + 0] = COLOR_LINE_RED[0];
    out[offset + 1] = COLOR_LINE_RED[1];
    out[offset + 2] = COLOR_LINE_RED[2];
    out[offset + 3] = 1.0;
  }
}

export class OverlayGeometryBuilder {
  // Pre-sized capacities (ReviewRender#2: ellipses/bars >= 256, lines >= 2048)
  private ellipseCapacity = 256;
  public ellipseCount = 0;
  public ellipseMatrices = new Float32Array(256 * 16);
  public ellipseColors = new Float32Array(256 * 4);

  private placementCapacity = 256;
  public placementCount = 0;
  public placementMatrices = new Float32Array(256 * 16);
  public placementColors = new Float32Array(256 * 4);
  public placementParams = new Float32Array(256 * 4);

  private healthBarCapacity = 256;
  public healthBarCount = 0;
  public healthBarPositions = new Float32Array(256 * 3);
  public healthBarParams = new Float32Array(256 * 4);

  private lineCapacity = 2048;
  public lineSegmentCount = 0;
  public linePositions = new Float32Array(2048 * 6);
  public lineColors = new Float32Array(2048 * 8);

  private selectionStamps = new Uint32Array(512);
  private selectionStamp = 0;
  private selectedCount = 0;

  build(input: OverlayGeometryInput): this {
    const selectedIds = input.selectedIds ?? [];
    const markers = input.markers ?? [];
    const snapshot = input.snapshot;
    const now =
      input.timeSeconds ??
      (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
    const getSpriteTopPx = input.getSpriteTopPx;

    this.ellipseCount = 0;
    this.healthBarCount = 0;
    this.lineSegmentCount = 0;

    this.selectedCount = selectedIds.length;
    this.selectionStamp = (this.selectionStamp + 1) >>> 0;
    if (this.selectionStamp === 0) {
      this.selectionStamps.fill(0);
      this.selectionStamp = 1;
    }
    for (let s = 0; s < selectedIds.length; s++) {
      const id = selectedIds[s];
      if (id >= this.selectionStamps.length) {
        const grown = new Uint32Array(
          Math.max(id + 1, this.selectionStamps.length * 2),
        );
        grown.set(this.selectionStamps);
        this.selectionStamps = grown;
      }
      this.selectionStamps[id] = this.selectionStamp;
    }

    // 1. Dynamic lines: Waypoints, Rally lines, and Order Markers
    this.buildDynamicLines(snapshot, markers, now);

    // 2. Selection Ellipses and Health Bars
    if (snapshot && snapshot.entities && this.selectedCount > 0) {
      const entities = snapshot.entities;
      const count = entities.length;

      for (let i = 0; i < count; i++) {
        const ent = entities[i];
        if (this.selectionStamps[ent.id] !== this.selectionStamp) continue;

        const kind = ent.kind;
        let color = COLOR_FRIENDLY;
        if (ent.player === 1) {
          color = COLOR_ENEMY;
        } else if (ent.player === undefined || ent.player < 0) {
          color = COLOR_NEUTRAL;
        }

        // Add selection ellipse
        if (kind === 'unit') {
          const r = (ent.radius ?? 0.35) * 1.25;
          this.addEllipse(ent.x, ent.z, r, r, color);
        } else if (kind === 'building') {
          const w = ent.width ?? 4;
          const h = ent.height ?? 4;
          // Radius chosen as 0.80 * dimension:
          // For a 4x4 keep (w=4), radius is 3.2 tiles. The 4x4 footprint diamond has corner extent ~2.83 tiles.
          // With shader smoothstep ring at 0.85-0.93 of R (2.72-2.98 tiles), this ensures the ring encloses
          // the footprint diamond and gives ~60-65% visibility around the keep sprite, fixing ReviewRender#1.
          this.addEllipse(
            ent.x + w * 0.5,
            ent.z + h * 0.5,
            w * 0.8,
            h * 0.8,
            color,
          );
        } else if (kind === 'mine') {
          const w = ent.width ?? 2;
          const h = ent.height ?? 2;
          this.addEllipse(
            ent.x + w * 0.5,
            ent.z + h * 0.5,
            w * 0.8,
            h * 0.8,
            COLOR_NEUTRAL,
          );
        }

        // Add health bar
        const hp = ent.hp;
        const maxHp = ent.maxHp;
        if (hp !== undefined && maxHp !== undefined && maxHp > 0) {
          const frac = Math.max(0, Math.min(1, hp / maxHp));
          let barW = 0.7;
          let barH = 0.09;
          let posX = ent.x;
          let posZ = ent.z;
          let margin = 8;

          if (kind === 'building') {
            const bw = ent.width ?? 4;
            const bh = ent.height ?? 4;
            barW = Math.max(1.2, bw * 0.5);
            barH = 0.12;
            posX = ent.x + bw * 0.5;
            posZ = ent.z + bh * 0.5;
            margin = 12;
          }
          // Mine health-bar branch deleted per ReviewRender#5 (mines have no HP).

          // Stable health-bar height via getSpriteTopPx per ReviewRender#0
          const spriteTopPx = getSpriteTopPx
            ? getSpriteTopPx(ent.id)
            : undefined;
          let barY: number;
          if (spriteTopPx !== undefined) {
            barY = (spriteTopPx + margin) / PPU + barH * 0.5;
          } else {
            if (kind === 'building') {
              barY = 3.6;
            } else {
              barY = 1.55;
            }
          }

          this.addHealthBar(posX, posZ, barW, barH, frac, barY);
        }
      }
    }

    // 3. Placement ghost footprints and outlines
    this.placementCount = 0;
    if (input.placement && input.placement.length > 0) {
      for (let i = 0; i < input.placement.length; i++) {
        const p = input.placement[i];
        this.addPlacement(p.x, p.z, p.width, p.height, p.valid);
      }
    }

    return this;
  }

  private buildDynamicLines(
    snapshot: SessionSnapshot | undefined,
    markers: readonly OrderMarker[],
    now: number,
  ): void {
    const yLine = 0.02;

    // 1. Unit waypoints, paths, and building rally lines (ONLY for local player 0!)
    if (snapshot && snapshot.entities && this.selectedCount > 0) {
      const entities = snapshot.entities;
      const entCount = entities.length;

      for (let i = 0; i < entCount; i++) {
        const ent = entities[i];
        if (this.selectionStamps[ent.id] !== this.selectionStamp) continue;
        if (ent.player !== 0) continue;

        if (ent.raw.kind === 'unit') {
          const unit = ent.raw;
          const isAttack =
            unit.order?.kind === 'attackMove' || unit.order?.kind === 'attack';
          let lastColor = isAttack ? COLOR_LINE_RED : COLOR_LINE_GREEN;

          let currentX = ent.x;
          let currentZ = ent.z;

          // Follow path if present
          if (unit.path && unit.path.length > 0) {
            for (let p = 0; p < unit.path.length; p++) {
              const pt = unit.path[p];
              this.addSegment(
                currentX,
                yLine,
                currentZ,
                pt.x,
                yLine,
                pt.z,
                lastColor,
              );
              currentX = pt.x;
              currentZ = pt.z;
            }
          } else if (
            unit.order &&
            unit.order.x !== undefined &&
            unit.order.z !== undefined
          ) {
            this.addSegment(
              currentX,
              yLine,
              currentZ,
              unit.order.x,
              yLine,
              unit.order.z,
              lastColor,
            );
            currentX = unit.order.x;
            currentZ = unit.order.z;
          }

          // Follow queued orders if any
          if (unit.orders && unit.orders.length > 0) {
            for (let o = 0; o < unit.orders.length; o++) {
              const qOrder = unit.orders[o];
              if (qOrder.x !== undefined && qOrder.z !== undefined) {
                const qIsAttack =
                  qOrder.kind === 'attackMove' || qOrder.kind === 'attack';
                lastColor = qIsAttack ? COLOR_LINE_RED : COLOR_LINE_GREEN;
                this.addSegment(
                  currentX,
                  yLine,
                  currentZ,
                  qOrder.x,
                  yLine,
                  qOrder.z,
                  lastColor,
                );
                currentX = qOrder.x;
                currentZ = qOrder.z;
              }
            }
          }

          // Destination cross coloured with the last emitted segment color (ReviewRender#3)
          if (currentX !== ent.x || currentZ !== ent.z) {
            this.addCross(currentX, yLine, currentZ, 0.25, lastColor);
          }
        } else if (ent.raw.kind === 'building') {
          const bld = ent.raw;
          if (bld.rallyPoint) {
            const bx = ent.x + (bld.width ?? 4) * 0.5;
            const bz = ent.z + (bld.height ?? 4) * 0.5;
            const rx = bld.rallyPoint.x;
            const rz = bld.rallyPoint.z;

            this.addSegment(bx, yLine, bz, rx, yLine, rz, COLOR_LINE_YELLOW);

            // Small diamond marker at rally point
            this.addDiamond(rx, yLine, rz, 0.3, COLOR_LINE_YELLOW);
          }
        }
      }
    }

    // 2. Active unexpired OrderMarkers
    for (let m = 0; m < markers.length; m++) {
      const marker = markers[m];
      if (marker.expiresAt > now) {
        const isAttack = marker.kind === 'attackMove';
        const mColor = isAttack ? COLOR_LINE_RED : COLOR_LINE_GREEN;
        const mx = marker.x;
        const mz = marker.z;

        // Diamond outline
        this.addDiamond(mx, yLine, mz, 0.35, mColor);

        // Inner cross
        this.addCross(mx, yLine, mz, 0.2, mColor);
      }
    }
  }

  addSegment(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    color: readonly [number, number, number, number],
  ): void {
    if (this.lineSegmentCount >= this.lineCapacity) {
      this.growLines();
    }

    const idx = this.lineSegmentCount;
    const pOffset = idx * 6;
    this.linePositions[pOffset + 0] = x1;
    this.linePositions[pOffset + 1] = y1;
    this.linePositions[pOffset + 2] = z1;
    this.linePositions[pOffset + 3] = x2;
    this.linePositions[pOffset + 4] = y2;
    this.linePositions[pOffset + 5] = z2;

    const cOffset = idx * 8;
    const r = color[0];
    const g = color[1];
    const b = color[2];
    const a = color[3];
    this.lineColors[cOffset + 0] = r;
    this.lineColors[cOffset + 1] = g;
    this.lineColors[cOffset + 2] = b;
    this.lineColors[cOffset + 3] = a;
    this.lineColors[cOffset + 4] = r;
    this.lineColors[cOffset + 5] = g;
    this.lineColors[cOffset + 6] = b;
    this.lineColors[cOffset + 7] = a;

    this.lineSegmentCount++;
  }

  addDiamond(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    color: readonly [number, number, number, number],
  ): void {
    this.addSegment(cx, cy, cz - radius, cx + radius, cy, cz, color);
    this.addSegment(cx + radius, cy, cz, cx, cy, cz + radius, color);
    this.addSegment(cx, cy, cz + radius, cx - radius, cy, cz, color);
    this.addSegment(cx - radius, cy, cz, cx, cy, cz - radius, color);
  }

  addCross(
    cx: number,
    cy: number,
    cz: number,
    arm: number,
    color: readonly [number, number, number, number],
  ): void {
    this.addSegment(cx - arm, cy, cz, cx + arm, cy, cz, color);
    this.addSegment(cx, cy, cz - arm, cx, cy, cz + arm, color);
  }

  addEllipse(
    x: number,
    z: number,
    radiusX: number,
    radiusZ: number,
    color: readonly [number, number, number, number],
  ): void {
    if (this.ellipseCount >= this.ellipseCapacity) {
      this.growEllipses();
    }

    const idx = this.ellipseCount;
    const mOffset = idx * 16;
    this.ellipseMatrices[mOffset + 0] = radiusX;
    this.ellipseMatrices[mOffset + 1] = 0;
    this.ellipseMatrices[mOffset + 2] = 0;
    this.ellipseMatrices[mOffset + 3] = 0;

    this.ellipseMatrices[mOffset + 4] = 0;
    this.ellipseMatrices[mOffset + 5] = 1;
    this.ellipseMatrices[mOffset + 6] = 0;
    this.ellipseMatrices[mOffset + 7] = 0;

    this.ellipseMatrices[mOffset + 8] = 0;
    this.ellipseMatrices[mOffset + 9] = 0;
    this.ellipseMatrices[mOffset + 10] = radiusZ;
    this.ellipseMatrices[mOffset + 11] = 0;

    this.ellipseMatrices[mOffset + 12] = x;
    this.ellipseMatrices[mOffset + 13] = 0.008;
    this.ellipseMatrices[mOffset + 14] = z;
    this.ellipseMatrices[mOffset + 15] = 1;

    const cOffset = idx * 4;
    this.ellipseColors[cOffset + 0] = color[0];
    this.ellipseColors[cOffset + 1] = color[1];
    this.ellipseColors[cOffset + 2] = color[2];
    this.ellipseColors[cOffset + 3] = color[3];

    this.ellipseCount++;
  }

  addHealthBar(
    posX: number,
    posZ: number,
    barW: number,
    barH: number,
    hpFrac: number,
    barY: number,
  ): void {
    if (this.healthBarCount >= this.healthBarCapacity) {
      this.growHealthBars();
    }

    const idx = this.healthBarCount;
    const pOffset = idx * 3;
    this.healthBarPositions[pOffset + 0] = posX;
    this.healthBarPositions[pOffset + 1] = 0;
    this.healthBarPositions[pOffset + 2] = posZ;

    const bOffset = idx * 4;
    this.healthBarParams[bOffset + 0] = barW;
    this.healthBarParams[bOffset + 1] = barH;
    this.healthBarParams[bOffset + 2] = hpFrac;
    this.healthBarParams[bOffset + 3] = barY;

    this.healthBarCount++;
  }

  getLineSegment(index: number): {
    x1: number;
    y1: number;
    z1: number;
    x2: number;
    y2: number;
    z2: number;
    r: number;
    g: number;
    b: number;
    a: number;
  } {
    const p = index * 6;
    const c = index * 8;
    return {
      x1: this.linePositions[p + 0],
      y1: this.linePositions[p + 1],
      z1: this.linePositions[p + 2],
      x2: this.linePositions[p + 3],
      y2: this.linePositions[p + 4],
      z2: this.linePositions[p + 5],
      r: this.lineColors[c + 0],
      g: this.lineColors[c + 1],
      b: this.lineColors[c + 2],
      a: this.lineColors[c + 3],
    };
  }

  getHealthBar(index: number): {
    posX: number;
    posZ: number;
    barW: number;
    barH: number;
    hpFrac: number;
    barY: number;
  } {
    const p = index * 3;
    const b = index * 4;
    return {
      posX: this.healthBarPositions[p + 0],
      posZ: this.healthBarPositions[p + 2],
      barW: this.healthBarParams[b + 0],
      barH: this.healthBarParams[b + 1],
      hpFrac: this.healthBarParams[b + 2],
      barY: this.healthBarParams[b + 3],
    };
  }

  getEllipse(index: number): {
    x: number;
    z: number;
    radiusX: number;
    radiusZ: number;
    r: number;
    g: number;
    b: number;
    a: number;
  } {
    const m = index * 16;
    const c = index * 4;
    return {
      x: this.ellipseMatrices[m + 12],
      z: this.ellipseMatrices[m + 14],
      radiusX: this.ellipseMatrices[m + 0],
      radiusZ: this.ellipseMatrices[m + 10],
      r: this.ellipseColors[c + 0],
      g: this.ellipseColors[c + 1],
      b: this.ellipseColors[c + 2],
      a: this.ellipseColors[c + 3],
    };
  }

  private growEllipses(): void {
    const newCap = this.ellipseCapacity * 2;
    const nextMatrices = new Float32Array(newCap * 16);
    nextMatrices.set(this.ellipseMatrices);
    this.ellipseMatrices = nextMatrices;

    const nextColors = new Float32Array(newCap * 4);
    nextColors.set(this.ellipseColors);
    this.ellipseColors = nextColors;

    this.ellipseCapacity = newCap;
  }

  private growHealthBars(): void {
    const newCap = this.healthBarCapacity * 2;
    const nextPositions = new Float32Array(newCap * 3);
    nextPositions.set(this.healthBarPositions);
    this.healthBarPositions = nextPositions;

    const nextParams = new Float32Array(newCap * 4);
    nextParams.set(this.healthBarParams);
    this.healthBarParams = nextParams;

    this.healthBarCapacity = newCap;
  }

  private growLines(): void {
    const newCap = this.lineCapacity * 2;
    const nextPositions = new Float32Array(newCap * 6);
    nextPositions.set(this.linePositions);
    this.linePositions = nextPositions;

    const nextColors = new Float32Array(newCap * 8);
    nextColors.set(this.lineColors);
    this.lineColors = nextColors;

    this.lineCapacity = newCap;
  }

  addPlacement(
    x: number,
    z: number,
    width: number,
    height: number,
    valid: boolean,
  ): void {
    if (this.placementCount >= this.placementCapacity) {
      this.growPlacement();
    }

    const idx = this.placementCount;
    const mOffset = idx * 16;
    const cOffset = idx * 4;
    const pOffset = idx * 4;

    const w = Math.max(1, width || 1);
    const h = Math.max(1, height || 1);

    computePlacementMatrix(this.placementMatrices, mOffset, x, z, w, h);
    computePlacementColor(this.placementColors, cOffset, valid);

    this.placementParams[pOffset + 0] = w;
    this.placementParams[pOffset + 1] = h;
    this.placementParams[pOffset + 2] = valid ? 1.0 : 0.0;
    this.placementParams[pOffset + 3] = 0.0;

    this.placementCount++;
  }

  getPlacement(index: number): {
    x: number;
    z: number;
    width: number;
    height: number;
    valid: boolean;
    r: number;
    g: number;
    b: number;
    a: number;
  } {
    const m = index * 16;
    const c = index * 4;
    const p = index * 4;
    return {
      x: this.placementMatrices[m + 12],
      z: this.placementMatrices[m + 14],
      width: this.placementParams[p + 0],
      height: this.placementParams[p + 1],
      valid: this.placementParams[p + 2] > 0.5,
      r: this.placementColors[c + 0],
      g: this.placementColors[c + 1],
      b: this.placementColors[c + 2],
      a: this.placementColors[c + 3],
    };
  }

  private growPlacement(): void {
    const newCap = this.placementCapacity * 2;
    const nextMatrices = new Float32Array(newCap * 16);
    nextMatrices.set(this.placementMatrices);
    this.placementMatrices = nextMatrices;

    const nextColors = new Float32Array(newCap * 4);
    nextColors.set(this.placementColors);
    this.placementColors = nextColors;

    const nextParams = new Float32Array(newCap * 4);
    nextParams.set(this.placementParams);
    this.placementParams = nextParams;

    this.placementCapacity = newCap;
  }
}
