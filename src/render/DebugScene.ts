import type { Sim } from '../sim/sim';
import type { BuildingEntity, UnitEntity } from '../sim/entity';
import { Rng } from '../sim/rng';

export interface DebugProbeInfo {
  id: number;
  x: number;
  z: number;
  type: string;
  facing: number;
}

export interface DebugSceneProbes {
  northProbe: DebugProbeInfo;
  southProbe: DebugProbeInfo;
  allDebugUnitIds: number[];
}

export function setupDebugScene(sim: Sim, seed = 7): DebugSceneProbes {
  const world = sim.world;
  const allDebugUnitIds: number[] = [];

  // Separate seeded RNG so simulation deterministic RNG stream is unaffected
  const rng = new Rng((seed ^ 0x9e3779b9) >>> 0);

  // Update existing standard start units to have distributed facings 0..7
  const initialUnits = world.entities.filter(
    (e): e is UnitEntity => e !== undefined && e.kind === 'unit',
  );
  for (let i = 0; i < initialUnits.length; i++) {
    initialUnits[i].facing = i % 8;
  }

  // Find Keep 0 dynamically from actual Sim world entities
  const keep0 = world.entities.find(
    (e): e is BuildingEntity =>
      e !== undefined && e.kind === 'building' && e.player === 0 && e.type === 'keep',
  );
  const kx = keep0 ? keep0.x : 20;
  const kz = keep0 ? keep0.z : 20;
  const kw = keep0 ? keep0.width : 4;
  const kh = keep0 ? keep0.height : 4;

  // 1. Identifiable North Probe (behind Keep 0)
  // Positioned at (kx + kw / 2, kz - 0.4) -> (22.0, 19.6). x + z = 41.6 < 44 (behind Keep artwork)
  const northX = kx + kw / 2;
  const northZ = kz - 0.4;
  const northUnit = world.spawnUnit(0, 'spearman', northX, northZ, 'crown');
  northUnit.facing = 0;
  allDebugUnitIds.push(northUnit.id);
  const northProbe: DebugProbeInfo = {
    id: northUnit.id,
    x: northX,
    z: northZ,
    type: 'spearman',
    facing: 0,
  };

  // 2. Identifiable South Probe (in front of Keep 0)
  // Positioned at (kx + 3.5, kz + kh + 1.0) -> (23.5, 25.0) to maintain >= 1.1 clearance
  // from start peasants at (21.5, 24.5) and (22.5, 24.5), while overlapping Keep south artwork.
  const southX = kx + 3.5;
  const southZ = kz + kh + 1.0;
  const southUnit = world.spawnUnit(0, 'spearman', southX, southZ, 'crown');
  southUnit.facing = 0;
  allDebugUnitIds.push(southUnit.id);
  const southProbe: DebugProbeInfo = {
    id: southUnit.id,
    x: southX,
    z: southZ,
    type: 'spearman',
    facing: 0,
  };

  // 3. Collect dynamic obstacles (buildings & mines) from actual Sim world entities
  const obstacles: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  for (let i = 0; i < world.entities.length; i++) {
    const e = world.entities[i];
    if (!e) continue;
    if (e.kind === 'building' || e.kind === 'mine') {
      obstacles.push({
        minX: e.x,
        maxX: e.x + e.width,
        minZ: e.z,
        maxZ: e.z + e.height,
      });
    }
  }

  const placedPositions: { x: number; z: number }[] = [
    ...initialUnits.map((u) => ({ x: u.x, z: u.z })),
    { x: northX, z: northZ },
    { x: southX, z: southZ },
  ];

  // 4. Generate candidate positions around Keep 0 center
  const centerX = kx + kw / 2;
  const centerZ = kz + kh / 2;
  const candidates: { x: number; z: number }[] = [];

  for (let r = 2; r <= 14; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;

        const candidateX = centerX + dx + 0.5;
        const candidateZ = centerZ + dz + 0.5;
        const tx = Math.floor(candidateX);
        const tz = Math.floor(candidateZ);

        if (!world.grid.isPassable(tx, tz, 0)) continue;

        // Ensure clear margin from all buildings and mines
        let collides = false;
        for (let o = 0; o < obstacles.length; o++) {
          const obs = obstacles[o];
          if (
            candidateX >= obs.minX - 0.8 &&
            candidateX <= obs.maxX + 0.8 &&
            candidateZ >= obs.minZ - 0.8 &&
            candidateZ <= obs.maxZ + 0.8
          ) {
            collides = true;
            break;
          }
        }
        if (!collides) {
          candidates.push({ x: candidateX, z: candidateZ });
        }
      }
    }
  }

  // Shuffle candidate positions with independent seeded RNG (Fisher-Yates)
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const temp = candidates[i];
    candidates[i] = candidates[j];
    candidates[j] = temp;
  }

  // 5. Select 38 units with >= 1.1 spacing, ensuring all 8 facings appear across total 50 units
  const unitTypes = ['peasant', 'spearman', 'ox_cart'] as const;
  const facingPool: number[] = [];
  for (let f = 0; f < 8; f++) {
    facingPool.push(f, f, f, f);
  }
  while (facingPool.length < 38) {
    facingPool.push(rng.int(8));
  }
  for (let i = facingPool.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const temp = facingPool[i];
    facingPool[i] = facingPool[j];
    facingPool[j] = temp;
  }

  let count = 0;
  for (let c = 0; c < candidates.length && count < 38; c++) {
    const cand = candidates[c];

    // Ensure separation from all already placed units
    let tooClose = false;
    for (let p = 0; p < placedPositions.length; p++) {
      const u = placedPositions[p];
      if (Math.hypot(cand.x - u.x, cand.z - u.z) < 1.1) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    const type = unitTypes[rng.int(unitTypes.length)];
    const unit = world.spawnUnit(0, type, cand.x, cand.z, 'crown');
    unit.facing = facingPool[count];
    allDebugUnitIds.push(unit.id);
    placedPositions.push({ x: cand.x, z: cand.z });
    count++;
  }

  return {
    northProbe,
    southProbe,
    allDebugUnitIds,
  };
}
