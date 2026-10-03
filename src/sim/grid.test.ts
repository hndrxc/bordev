import { describe, expect, it } from 'vitest';
import { FLAG_BUILDING, FLAG_GATE, FLAG_TERRAIN, Grid } from './grid';
import type { GameMap } from './map';
import { Terrain } from './map';

function makeEmptyMap(size = 10): GameMap {
  return {
    version: 1,
    id: 'test_map',
    name: 'Test Map',
    size,
    players: 2,
    tiles: new Uint8Array(size * size).fill(Terrain.GRASS),
    goldMines: [],
    starts: [],
    doodads: [],
  };
}

describe('Grid', () => {
  it('initializes terrain flags from map tiles', () => {
    const map = makeEmptyMap(4);
    map.tiles[0] = Terrain.GRASS;
    map.tiles[1] = Terrain.DIRT;
    map.tiles[2] = Terrain.SAND;
    map.tiles[3] = Terrain.SHALLOW;
    map.tiles[4] = Terrain.WATER;
    map.tiles[5] = Terrain.FOREST;
    map.tiles[6] = Terrain.ROCK;

    const grid = new Grid(map);

    expect(grid.isPassable(0, 0, 0)).toBe(true);
    expect(grid.isPassable(1, 0, 0)).toBe(true);
    expect(grid.isPassable(2, 0, 0)).toBe(true);
    expect(grid.isPassable(3, 0, 0)).toBe(true);
    expect(grid.isPassable(0, 1, 0)).toBe(false);
    expect(grid.isPassable(1, 1, 0)).toBe(false);
    expect(grid.isPassable(2, 1, 0)).toBe(false);

    expect(grid.flags[4] & FLAG_TERRAIN).toBe(FLAG_TERRAIN);
    expect(grid.flags[5] & FLAG_TERRAIN).toBe(FLAG_TERRAIN);
    expect(grid.flags[6] & FLAG_TERRAIN).toBe(FLAG_TERRAIN);
  });

  it('handles out of bounds isPassable queries', () => {
    const grid = new Grid(makeEmptyMap(8));
    expect(grid.isPassable(-1, 0, 0)).toBe(false);
    expect(grid.isPassable(0, -1, 0)).toBe(false);
    expect(grid.isPassable(8, 0, 0)).toBe(false);
    expect(grid.isPassable(0, 8, 0)).toBe(false);
  });

  it('updates building flags and increments revision', () => {
    const grid = new Grid(makeEmptyMap(8));
    expect(grid.revision).toBe(0);

    grid.setBuilding(2, 2, 2, 2, true);
    expect(grid.revision).toBe(1);
    expect(grid.isPassable(2, 2, 0)).toBe(false);
    expect(grid.isPassable(3, 3, 0)).toBe(false);
    expect(grid.flags[2 * 8 + 2] & FLAG_BUILDING).toBe(FLAG_BUILDING);

    grid.setBuilding(2, 2, 2, 2, false);
    expect(grid.revision).toBe(2);
    expect(grid.isPassable(2, 2, 0)).toBe(true);
    expect(grid.isPassable(3, 3, 0)).toBe(true);
  });

  it('restricts gate access to owner and allies', () => {
    const grid = new Grid(makeEmptyMap(8));
    const player0 = 0;
    const player1 = 1;
    const player2 = 2;

    grid.setGate(4, 0, 1, 3, player0);
    expect(grid.revision).toBe(1);
    expect(grid.flags[0 * 8 + 4] & FLAG_GATE).toBe(FLAG_GATE);

    // Player 0 (owner) can pass
    expect(grid.isPassable(4, 1, player0)).toBe(true);

    // Player 1 and 2 cannot pass initially
    expect(grid.isPassable(4, 1, player1)).toBe(false);
    expect(grid.isPassable(4, 1, player2)).toBe(false);

    // Set player 1 as ally of player 0
    grid.setAllies(player0, [player1]);
    expect(grid.revision).toBe(2);

    expect(grid.isPassable(4, 1, player0)).toBe(true);
    expect(grid.isPassable(4, 1, player1)).toBe(true);
    expect(grid.isPassable(4, 1, player2)).toBe(false);
  });

  it('tests canOccupy for continuous circle against obstacles and boundaries', () => {
    const grid = new Grid(makeEmptyMap(10));
    grid.setBuilding(5, 5, 2, 2, true); // Obstacle at [5..7] x [5..7]

    // Point check (radius <= 0)
    expect(grid.canOccupy(2, 2, 0, 0)).toBe(true);
    expect(grid.canOccupy(5.5, 5.5, 0, 0)).toBe(false);

    // Out of bounds
    expect(grid.canOccupy(0.2, 5, 0.3, 0)).toBe(false); // Left edge collision (0.2 - 0.3 < 0)
    expect(grid.canOccupy(9.8, 5, 0.3, 0)).toBe(false); // Right edge collision (9.8 + 0.3 > 10)
    expect(grid.canOccupy(5, 0.2, 0.3, 0)).toBe(false);
    expect(grid.canOccupy(5, 9.8, 0.3, 0)).toBe(false);

    // Far from obstacle
    expect(grid.canOccupy(2, 2, 0.4, 0)).toBe(true);

    // Touching obstacle vs penetrating
    // Obstacle is at x in [5, 7], z in [5, 7].
    // Center at x = 4.5, z = 6.0 with radius 0.4:
    // Distance to x = 5.0 is 0.5 > 0.4 -> valid
    expect(grid.canOccupy(4.5, 6.0, 0.4, 0)).toBe(true);

    // Center at x = 4.8, z = 6.0 with radius 0.4:
    // Distance to x = 5.0 is 0.2 < 0.4 -> penetrates obstacle -> invalid
    expect(grid.canOccupy(4.8, 6.0, 0.4, 0)).toBe(false);

    // Diagonal corner collision with [5, 5]:
    // Distance from (4.8, 4.8) to corner (5.0, 5.0) is sqrt(0.04 + 0.04) = sqrt(0.08) ~= 0.2828.
    // Radius 0.4 > 0.2828 -> penetrates corner
    expect(grid.canOccupy(4.8, 4.8, 0.4, 0)).toBe(false);

    // Radius 0.2 < 0.2828 -> clear
    expect(grid.canOccupy(4.8, 4.8, 0.2, 0)).toBe(true);
  });
});
