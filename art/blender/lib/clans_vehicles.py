"""Clans vehicles: a pony-drawn wicker haul wagon and a four-wheeled battering ram."""
import math

from lib import anim
from lib.model import root, box, ico, cylinder, cone, beam, mesh, wheel, flag


def haul_wagon():
    """Wicker-sided gold wagon drawn by a shaggy draft pony.

    Returns the same part contract as lib.cart.build, so lib.cart.clips can
    animate the chassis, cargo, pony, head and wheels unchanged.
    """
    parent = root("Clans haul wagon")
    parent.rotation_euler.z = math.pi / 4
    chassis = root("Wagon suspension", parent=parent)

    for side in (-1, 1):
        beam("Pony shaft", (side * 0.28, -0.30, 0.44), (side * 0.30, -1.00, 0.47),
             0.030, "WOOD", chassis)
    for x in (-0.32, -0.16, 0.0, 0.16, 0.32):
        box("Bed plank", (x, 0.32, 0.50), (0.145, 1.16, 0.055), "WOOD_LIGHT", chassis)
    for y in (-0.22, 0.26, 0.74, 0.88):
        box("Bed joist", (0, y, 0.455), (0.82, 0.055, 0.055), "WOOD", chassis)
    for y in (-0.25, 0.90):
        box("End rail", (0, y, 0.66), (0.86, 0.05, 0.30), "WOOD", chassis)
    for side in (-1, 1):
        x = side * 0.42
        for y in (-0.18, 0.02, 0.22, 0.42, 0.62, 0.82):
            box("Wattle stake", (x, y, 0.64), (0.045, 0.045, 0.30), "WOOD", chassis)
        for z in (0.55, 0.72):
            box("Wattle rail", (x, 0.32, z), (0.045, 1.16, 0.045), "WOOD_LIGHT", chassis)
        for y in (-0.18, 0.30):
            beam("Wattle weave", (x, y, 0.54), (x, y + 0.28, 0.76), 0.018, "WOOD_LIGHT", chassis)
        box("Team side cloth", (side * 0.448, 0.32, 0.64), (0.016, 0.36, 0.17), "TEAM", chassis)

    wheels = []
    for y in (-0.10, 0.72):
        box("Axle beam", (0, y, 0.25), (1.10, 0.07, 0.07), "WOOD", chassis)
        for x in (-0.52, 0.52):
            wheels.append(wheel(parent, (x, y, 0.25), 0.25))

    cargo = root("Gold load", (0, 0, 0.50), chassis)
    for x, y, z in ((-0.16, 0.10, 0.10), (0.15, 0.16, 0.10), (-0.13, 0.48, 0.10), (0.13, 0.54, 0.20)):
        ico("Gold sack", (x, y, z), (0.17, 0.20, 0.15), "CLOTH", cargo)
        ico("Visible gold", (x, y, z + 0.13), (0.095, 0.09, 0.045), "GOLD", cargo)

    ox = root("Pony motion", (0, -0.82, 0), parent)
    ico("Pony body", (0, 0, 0.62), (0.27, 0.40, 0.28), "HORSE_DUN", ox, 2)
    ico("Pony shoulder", (0, -0.24, 0.70), (0.25, 0.18, 0.25), "HORSE_DUN", ox)
    ico("Pony hindquarters", (0, 0.25, 0.68), (0.25, 0.18, 0.24), "HORSE_DUN", ox)
    ico("Pony neck", (0, -0.33, 0.80), (0.17, 0.20, 0.26), "HORSE_DUN", ox)
    beam("Harness girth", (0.30, -0.30, 0.60), (-0.30, -0.30, 0.60), 0.020, "LEATHER", ox)
    for side in (-1, 1):
        beam("Harness trace", (side * 0.30, -0.18, 0.47), (side * 0.24, -0.32, 0.62),
             0.022, "LEATHER", ox)

    head = root("Pony head pivot", (0, -0.40, 0.90), ox)
    ico("Pony head", (0, -0.13, -0.06), (0.15, 0.23, 0.17), "HORSE_DUN", head, 2)
    ico("Pony muzzle", (0, -0.32, -0.14), (0.11, 0.12, 0.09), "HIDE", head)
    for side in (-1, 1):
        ico("Pony eye", (side * 0.12, -0.25, 0.02), (0.026, 0.026, 0.026), "DARK", head)
        ear = cone("Pony ear", (side * 0.09, -0.03, 0.15), 0.05, 0.16, "FUR_DARK", head,
                   radius_top=0, vertices=5)
        ear.rotation_euler.y = side * 0.20
    for y, z in ((-0.18, 0.92), (-0.28, 0.98)):
        ico("Shaggy mane", (0, y, z), (0.09, 0.11, 0.10), "FUR_DARK", ox)
    ico("Forelock", (0, -0.10, 0.13), (0.10, 0.09, 0.07), "FUR_DARK", head)
    beam("Pony tail", (0, 0.40, 0.66), (0, 0.50, 0.34), 0.040, "FUR_DARK", ox)

    legs = []
    for x, y in ((-0.17, -0.26), (0.17, -0.26), (-0.17, 0.26), (0.17, 0.26)):
        leg = root("Pony leg", (x, y, 0.52), ox)
        beam("Pony shin", (0, 0, 0), (0, 0, -0.40), 0.055, "HORSE_DUN", leg)
        box("Hoof", (0, -0.015, -0.445), (0.10, 0.13, 0.09), "DARK", leg)
        legs.append(leg)

    return {"root": parent, "chassis": chassis, "cargo": cargo, "ox": ox,
            "head": head, "legs": legs, "wheels": wheels}


# Attack offsets for the ram log in local Y; positive is backward, negative is the strike.
RAM_Y = (0.0, 0.10, 0.22, 0.32, 0.36, -0.30, -0.12, 0.0)


def battering_ram():
    """Four-wheeled timber ram under a hide A-frame with a horned iron head."""
    parent = root("Clans battering ram")
    parent.rotation_euler.z = math.pi / 4
    chassis = root("Ram chassis", parent=parent)
    for x in (-0.40, 0.40):
        box("Sill beam", (x, 0, 0.30), (0.10, 1.60, 0.11), "WOOD", chassis)
    for y in (-0.58, 0.0, 0.58):
        box("Cross beam", (0, y, 0.30), (0.86, 0.10, 0.10), "WOOD_LIGHT", chassis)
    for x, y in ((-0.40, -0.58), (0.40, -0.58), (-0.40, 0.58), (0.40, 0.58)):
        box("Corner post", (x, y, 0.46), (0.09, 0.09, 0.36), "WOOD_LIGHT", chassis)
    box("Deck plank", (0, 0, 0.37), (0.74, 1.24, 0.05), "WOOD", chassis)

    wheels = []
    left_wheels = []
    for y in (-0.50, 0.50):
        box("Axle beam", (0, y, 0.22), (1.04, 0.07, 0.07), "WOOD", chassis)
        for x in (-0.52, 0.52):
            axle = wheel(chassis, (x, y, 0.22), 0.22)
            wheels.append(axle)
            if x < 0:
                left_wheels.append(axle)

    roof = root("Ram roof", parent=chassis)
    for side in (-1, 1):
        mesh("Hide roof panel",
             [(side * 0.56, -0.64, 0.58), (side * 0.56, 0.64, 0.58),
              (0.0, 0.64, 1.02), (0.0, -0.64, 1.02)],
             [(0, 1, 2, 3)], "HIDE", roof)
        beam("Eave beam", (side * 0.56, -0.64, 0.58), (side * 0.56, 0.64, 0.58),
             0.035, "WOOD", roof)
        for y in (-0.60, 0.0, 0.60):
            beam("Roof rib", (side * 0.56, y, 0.58), (0, y, 1.02), 0.028, "WOOD", roof)
    box("Fur ridge", (0, 0, 1.02), (0.10, 1.28, 0.10), "FUR_DARK", roof, 0.01)

    banner = root("Rear banner", (0, 0.56, 0.98), chassis)
    flag(banner, (0, 0, 0), 0.32)

    ram = root("Ram log pivot", (0, 0, 0.52), chassis)
    log = cylinder("Ram log", (0, 0, 0), 0.09, 1.30, "WOOD", ram, 8)
    log.rotation_euler.x = math.pi / 2
    for y in (-0.42, 0.42):
        band = cylinder("Iron log band", (0, y, 0), 0.105, 0.07, "IRON", ram, 8)
        band.rotation_euler.x = math.pi / 2
    box("Ram iron head", (0, -0.72, 0.0), (0.24, 0.20, 0.24), "IRON", ram, 0.02)
    nose = cone("Ram iron nose", (0, -0.87, 0.0), 0.13, 0.18, "IRON", ram,
                radius_top=0.05, vertices=6)
    nose.rotation_euler.x = math.pi / 2
    for side in (-1, 1):
        beam("Bone horn", (side * 0.11, -0.72, 0.06), (side * 0.28, -0.76, 0.15),
             0.040, "BONE", ram)
        beam("Bone horn tip", (side * 0.28, -0.76, 0.15), (side * 0.26, -0.86, 0.02),
             0.022, "BONE", ram)
    for y in (-0.34, 0.34):
        for side in (-1, 1):
            beam("Leather ram rope", (0, y, 1.00), (side * 0.28, y, 0.61),
                 0.018, "LEATHER", chassis)

    return {"root": parent, "chassis": chassis, "roof": roof, "wheels": wheels,
            "left_wheels": left_wheels, "banner": banner, "ram": ram}


def ram_clips(parts):
    """Idle sway, rolling walk, a frame-five log strike and a collapsing die."""
    def pose(name, frame, count):
        if name == "idle":
            parts["banner"].rotation_euler.y = 0.05 * math.sin(2 * math.pi * frame / count)
        elif name == "walk":
            for axle in parts["wheels"]:
                axle.rotation_euler.x = -frame * math.pi / 4
            anim.bob(parts["chassis"], frame, count, 0.01)
        elif name == "attack":
            parts["ram"].location.y = RAM_Y[frame]
        else:
            progress = anim.smoothstep(frame / (count - 1))
            parts["roof"].rotation_euler.y = 0.5 * progress
            parts["chassis"].location.z = -0.12 * progress
            for axle in parts["left_wheels"]:
                axle.rotation_euler.y = 1.2 * progress

    return anim.clip_set(parts["root"], anim.UNIT_ANIMS, pose)
