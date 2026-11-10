import { AGES } from '../data/ages';
import { isTownCenterType } from '../data/roles';
import type { SimEvent } from '../sim/commands';
import type { BuildingEntity } from '../sim/entity';
import type { World } from '../sim/world';
import { getHudNow, pushHudAlert, type HudAlert } from '../ui/hud';

const ATTACK_COOLDOWN_TICKS = 200;
const ATTACK_RADIUS_SQUARED = 15 * 15;

export class AlertFeed {
  private nextId = 1;
  private readonly attacks: { tick: number; x: number; z: number }[] = [];
  private latest: { x: number; z: number } | null = null;

  constructor(private readonly viewer: number) {}

  ingest(events: readonly SimEvent[], world: World): void {
    let expired = 0;
    while (
      expired < this.attacks.length &&
      world.tick - this.attacks[expired].tick >= ATTACK_COOLDOWN_TICKS
    ) {
      expired++;
    }
    if (expired > 0) this.attacks.splice(0, expired);

    for (const event of events) {
      if (!('player' in event) || event.player !== this.viewer) continue;

      switch (event.kind) {
        case 'underAttack': {
          const suppressed = this.attacks.some((attack) => {
            const dx = event.x - attack.x;
            const dz = event.z - attack.z;
            return dx * dx + dz * dz <= ATTACK_RADIUS_SQUARED;
          });
          if (suppressed) break;
          this.attacks.push({ tick: world.tick, x: event.x, z: event.z });
          this.push('underAttack', 'Under attack', { x: event.x, z: event.z });
          break;
        }
        case 'ageReached': {
          const player = world.players[this.viewer];
          if (!player) break;
          let townCenter: BuildingEntity | undefined;
          for (const entity of world.entities) {
            if (
              entity?.kind !== 'building' ||
              entity.player !== this.viewer ||
              entity.hp <= 0 ||
              !isTownCenterType(entity.type)
            ) {
              continue;
            }
            townCenter = entity;
            if (entity.built) break;
          }
          this.push(
            'age',
            `${AGES[event.age].name[player.faction]} reached`,
            townCenter
              ? {
                  x: townCenter.x + townCenter.width * 0.5,
                  z: townCenter.z + townCenter.height * 0.5,
                }
              : undefined,
          );
          break;
        }
        case 'populationCapped':
          this.push('population', 'Not enough population', {
            x: event.x,
            z: event.z,
          });
          break;
        case 'faithLow':
          this.push('faith', 'Not enough faith');
          break;
      }
    }
  }

  rejection(reason: string): boolean {
    switch (reason) {
      case 'Not enough food':
      case 'Not enough gold':
      case 'Not enough food and gold':
        this.push('resources', reason);
        return true;
      case 'Insufficient resources':
      case 'Not enough resources for wall run':
        this.push('resources', 'Not enough resources');
        return true;
      default:
        return false;
    }
  }

  latestPosition(): { x: number; z: number } | null {
    return this.latest;
  }

  private push(
    kind: HudAlert['kind'],
    text: string,
    position?: { x: number; z: number },
  ): void {
    pushHudAlert({
      id: this.nextId++,
      kind,
      text,
      ...position,
      at: getHudNow(),
    });
    if (position) this.latest = position;
  }
}
