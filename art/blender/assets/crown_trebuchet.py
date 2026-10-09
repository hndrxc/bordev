"""Crown counterweight trebuchet on four wheels; the throwing arm, hinged counterweight and sling really swing."""
import math
from lib import anim
from lib.model import root, box, ico, beam, mesh, wheel

_parts = None
PIVOT_Z = 0.74
LONG_ARM = 0.75
SHORT_ARM = 0.40
ROPE = 0.38
COCKED = -0.6
COCKED_ROPE = -0.25
# Attack tables: arm angle about X (positive lifts the long end), rope world angle,
# counterweight bounce and chassis recoil. Stone leaves the sling at frame index 5.
ARM = (-0.62, -0.62, -0.55, -0.10, 0.75, 1.65, 2.15, 2.35)
ROPE_ANGLE = (-0.25, -0.25, -0.25, -0.25, 0.0, 1.2, 2.7, 3.6)
BOUNCE = (0.0, 0.0, 0.0, 0.04, 0.10, 0.20, -0.30, 0.20)
RECOIL = (0.0, 0.0, 0.0, 0.0, -0.01, 0.0, 0.03, -0.015)


def _pennant(parent, base, length, height, axis):
    """Two-sided team pennant flying along X or Y from a pole at base."""
    x, y, z = base
    dx, dy = (length, 0) if axis == "x" else (0, length)
    return mesh("Team pennant", [(x, y, z + height), (x + dx, y + dy, z + height * 0.82),
                                 (x + dx * 0.8, y + dy * 0.8, z + height * 0.3), (x, y, z + height * 0.45)],
                [(0, 1, 2, 3)], "TEAM", parent)


def build():
    global _parts
    parent = root("Crown trebuchet")
    parent.rotation_euler.z = math.pi / 4
    chassis = root("Trebuchet chassis", parent=parent)
    for x in (-0.34, 0.34):
        box("Sill beam", (x, 0, 0.32), (0.10, 1.30, 0.11), "WOOD", chassis, 0.012)
        for y in (-0.60, 0.60):
            beam("A-frame leg", (x, y, 0.36), (x, 0, PIVOT_Z), 0.055, "WOOD_LIGHT", chassis)
        box("Iron bearing", (x * 1.12, 0, PIVOT_Z), (0.07, 0.14, 0.12), "IRON", chassis)
        box("Team side panel", (x * 1.16, 0, 0.50), (0.025, 0.95, 0.17), "TEAM", chassis)
        box("Gold panel trim", (x * 1.16, 0, 0.405), (0.03, 0.97, 0.025), "GOLD", chassis)
    for y in (-0.56, 0.56):
        box("Cross beam", (0, y, 0.32), (0.78, 0.10, 0.10), "WOOD", chassis, 0.012)
        for x in (-0.22, 0.22):
            box("Team plank board", (x, y * 1.07, 0.52), (0.26, 0.04, 0.26), "TEAM", chassis)
        beam("Board rail", (-0.31, y * 1.07, 0.66), (0.31, y * 1.07, 0.66), 0.02, "IRON", chassis)
    wheels = []
    for y in (-0.45, 0.45):
        beam("Wheel axle", (-0.5, y, 0.2), (0.5, y, 0.2), 0.03, "WOOD", chassis)
        for x in (-0.47, 0.47):
            wheels.append(wheel(chassis, (x, y, 0.2), 0.2))
    banner = root("Front banner", (-0.38, 0, PIVOT_Z + 0.04), chassis)
    beam("Banner pole", (0, 0, 0), (0, 0, 0.55), 0.018, "WOOD", banner)
    _pennant(banner, (0, 0, 0.08), -0.30, 0.45, "x")
    flag = root("Side banner", (0.38, 0.0, PIVOT_Z + 0.04), chassis)
    beam("Banner pole", (0, 0, 0), (0, 0, 0.55), 0.018, "WOOD", flag)
    _pennant(flag, (0, 0, 0.08), 0.30, 0.45, "y")

    arm = root("Throwing arm pivot", (0, 0, PIVOT_Z), chassis)
    beam("Pivot axle", (-0.38, 0, 0), (0.38, 0, 0), 0.04, "IRON", arm)
    beam("Long throwing arm", (0, -0.05, 0), (0, LONG_ARM, 0), 0.055, "WOOD_LIGHT", arm)
    beam("Short counter arm", (0, 0, 0), (0, -SHORT_ARM, 0), 0.07, "WOOD", arm)
    for y in (0.0, 0.28, 0.52):
        box("Arm iron band", (0, y, 0), (0.12, 0.05, 0.12), "IRON", arm)
    ico("Arm iron cap", (0, -SHORT_ARM, 0), (0.08, 0.06, 0.08), "IRON", arm)
    hinge = root("Counterweight hinge", (0, -SHORT_ARM, 0), arm)
    for x in (-0.12, 0.12):
        beam("Counterweight rod", (x, 0, 0), (x, 0, -0.10), 0.015, "IRON", hinge)
    box("Counterweight", (0, 0, -0.24), (0.40, 0.30, 0.30), "STONE_DARK", hinge, 0.02)
    for z in (-0.11, -0.37):
        box("Counterweight band", (0, 0, z), (0.42, 0.32, 0.04), "IRON", hinge)
    for x in (-0.205, 0.205):
        box("Team counterweight plate", (x, 0, -0.24), (0.02, 0.22, 0.20), "TEAM", hinge)
    for y in (-0.155, 0.155):
        box("Team counterweight plate", (0, y, -0.24), (0.26, 0.02, 0.20), "TEAM", hinge)
    sling = root("Sling pivot", (0, LONG_ARM, 0), arm)
    for x in (-0.03, 0.03):
        beam("Sling rope", (x, 0, 0), (x * 0.4, ROPE, 0), 0.01, "LEATHER", sling)
    ico("Sling pouch", (0, ROPE, 0), (0.07, 0.05, 0.045), "LEATHER", sling)
    stone = ico("Trebuchet boulder", (0, ROPE + 0.02, 0.03), (0.085, 0.085, 0.085), "STONE_LIGHT", sling, 2)
    _parts = {"root": parent, "chassis": chassis, "wheels": wheels, "banner": banner, "flag": flag,
              "arm": arm, "hinge": hinge, "sling": sling, "stone": stone}
    return parent


def _pose(parts, arm_angle, rope_angle, swing):
    """Arm, hanging counterweight and trailing sling stay geometrically consistent."""
    parts["arm"].rotation_euler.x = arm_angle
    parts["hinge"].rotation_euler.x = -arm_angle + swing
    parts["sling"].rotation_euler.x = rope_angle - arm_angle


def anims():
    parts = _parts
    chassis, banner, flag, stone = parts["chassis"], parts["banner"], parts["flag"], parts["stone"]

    def pose(name, frame, count):
        phase = 2 * math.pi * frame / count
        if name == "idle":
            _pose(parts, COCKED + 0.012 * math.sin(phase), COCKED_ROPE + 0.04 * math.sin(phase + 1.0),
                  0.06 * math.sin(phase))
            banner.rotation_euler.z = 0.05 * math.sin(phase)
            flag.rotation_euler.z = 0.05 * math.sin(phase + 0.8)
        elif name == "walk":
            anim.bob(chassis, frame * 2, count, 0.012, 0.012)
            _pose(parts, COCKED + 0.025 * math.sin(2 * phase), COCKED_ROPE + 0.06 * math.sin(2 * phase + 1.0),
                  0.10 * math.sin(phase))
            for wheel_part in parts["wheels"]:
                wheel_part.rotation_euler.x = frame * math.pi / 8
            banner.rotation_euler.z = 0.08 * math.sin(phase)
            flag.rotation_euler.z = 0.08 * math.sin(phase + 0.8)
            chassis.rotation_euler.x = 0.01 * math.sin(2 * phase)
        elif name == "attack":
            _pose(parts, ARM[frame], ROPE_ANGLE[frame], BOUNCE[frame])
            chassis.rotation_euler.x = RECOIL[frame]
            anim.visibility(stone, frame < 5)
            banner.rotation_euler.z = 0.1 * math.sin(frame * 1.2)
        else:
            eased = anim.smoothstep(frame / (count - 1))
            chassis.rotation_euler.y = 0.30 * eased
            chassis.rotation_euler.x = -0.12 * eased
            chassis.location.z = 0.07 * eased
            _pose(parts, COCKED + 1.1 * eased, COCKED_ROPE - 0.9 * eased, 0.5 * math.sin(frame * 1.1) * (1 - eased))
            parts["arm"].rotation_euler.z = 0.35 * eased
            parts["hinge"].location.z -= 0.10 * eased
            banner.rotation_euler.x = 1.2 * eased
            flag.rotation_euler.y = -1.0 * eased
            # One front wheel shears off and rolls clear; the rest stop turning.
            broken = parts["wheels"][0]
            broken.location.x -= 0.45 * eased
            broken.location.z -= 0.10 * eased
            broken.rotation_euler.y = 0.9 * eased
            anim.visibility(stone, frame < 2)

    return anim.clip_set(parts["root"], anim.UNIT_ANIMS, pose)
