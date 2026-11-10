"""Clans timber halls, shrines and defences with thatch, hide, fur and bone."""
import math
import random
from lib import anim, buildings
from lib.model import box, ico, cylinder, cone, beam, roof, flag, mesh, wheel


def _log(parent, name, x, y, z0, z1, radius, mat="WOOD", vertices=6):
    return cylinder(name, (x, y, (z0 + z1) / 2), radius, z1 - z0, mat, parent, vertices)


def _spike(parent, name, x, y, z, radius, mat="WOOD"):
    return cone(name, (x, y, z), radius, 0.20, mat, parent, vertices=6)


def _shield_front(parent, x, y, z, radius=0.18, disc="TEAM", rim="IRON", boss="IRON"):
    backing = cylinder("Shield backing", (x, y, z), radius, 0.030, rim, parent, 12)
    backing.rotation_euler.x = math.pi / 2
    face = cylinder("Painted shield face", (x, y - 0.018, z), radius * 0.82, 0.026, disc, parent, 12)
    face.rotation_euler.x = math.pi / 2
    boss_obj = cylinder("Shield iron boss", (x, y - 0.036, z), radius * 0.22, 0.022, boss, parent, 8)
    boss_obj.rotation_euler.x = math.pi / 2
    return face


def _shield_side(parent, x, y, z, radius=0.18, sign=1, disc="TEAM", rim="IRON", boss="IRON"):
    backing = cylinder("Shield backing", (x, y, z), radius, 0.030, rim, parent, 12)
    backing.rotation_euler.y = math.pi / 2
    face = cylinder("Painted shield face", (x + sign * 0.018, y, z), radius * 0.82, 0.026, disc, parent, 12)
    face.rotation_euler.y = math.pi / 2
    boss_obj = cylinder("Shield iron boss", (x + sign * 0.036, y, z), radius * 0.22, 0.022, boss, parent, 8)
    boss_obj.rotation_euler.y = math.pi / 2
    return face


def _antlers(parent, x, y, z, scale=1.0, mat="BONE"):
    ico("Antler skull mount", (x, y, z), (0.07 * scale, 0.05 * scale, 0.07 * scale), mat, parent)
    for side in (-1, 1):
        beam("Antler main beam", (x, y - 0.01 * scale, z),
             (x + side * 0.24 * scale, y - 0.04 * scale, z + 0.38 * scale),
             0.030 * scale, mat, parent)
        beam("Antler upper tine", (x + side * 0.23 * scale, y - 0.04 * scale, z + 0.36 * scale),
             (x + side * 0.34 * scale, y - 0.06 * scale, z + 0.58 * scale),
             0.020 * scale, mat, parent)
        beam("Antler brow tine", (x + side * 0.09 * scale, y - 0.02 * scale, z + 0.14 * scale),
             (x + side * 0.30 * scale, y - 0.05 * scale, z + 0.20 * scale),
             0.018 * scale, mat, parent)


def _crossed_finials(parent, x, y, z, scale=1.0):
    beam("Crossed gable finial", (x, y - 0.24 * scale, z + 0.05 * scale),
         (x, y + 0.24 * scale, z + 0.50 * scale), 0.032 * scale, "BONE", parent)
    beam("Crossed gable finial", (x, y + 0.24 * scale, z + 0.05 * scale),
         (x, y - 0.24 * scale, z + 0.50 * scale), 0.032 * scale, "BONE", parent)


def _barrel(parent, x, y, z, radius=0.16, depth=0.42, mat="WOOD"):
    cylinder("Barrel body", (x, y, z), radius, depth, mat, parent, 8)
    for hoop_z in (z - depth * 0.32, z + depth * 0.32):
        cylinder("Barrel iron hoop", (x, y, hoop_z), radius * 1.04, 0.028, "IRON", parent, 8)


def _hay_pile(parent, x, y, z, sx=0.40, sy=0.32, sz=0.28):
    ico("Hay pile", (x, y, z), (sx, sy, sz), "THATCH", parent)
    ico("Hay pile crown", (x + sx * 0.18, y - sy * 0.20, z + sz * 0.55),
        (sx * 0.62, sy * 0.58, sz * 0.62), "THATCH", parent)
    box("Loose straw", (x - sx * 0.45, y + sy * 0.25, 0.06), (sx * 0.8, sy * 0.7, 0.035), "WHEAT", parent)


def _target_disc(parent, x, y, z, radius=0.22):
    disc = cylinder("Thatch target disc", (x, y, z), radius, 0.06, "THATCH", parent, 10)
    disc.rotation_euler.x = math.pi / 2
    ring = cylinder("Bone target ring", (x, y - 0.035, z), radius * 0.68, 0.020, "BONE", parent, 10)
    ring.rotation_euler.x = math.pi / 2
    centre = cylinder("Team bullseye", (x, y - 0.050, z), radius * 0.30, 0.020, "TEAM", parent, 8)
    centre.rotation_euler.x = math.pi / 2


def _pelt(parent, x, y, z, width=0.28, height=0.38, mat="HIDE"):
    w, h = width / 2, height / 2
    return mesh("Hanging pelt",
                [(x - w, y, z + h * 0.9), (x + w, y, z + h * 0.9),
                 (x + w * 0.7, y, z + h * 0.2), (x + w * 0.9, y, z - h * 0.2),
                 (x + w * 0.35, y, z - h), (x - w * 0.4, y, z - h * 0.9),
                 (x - w, y, z - h * 0.1), (x - w * 0.8, y, z + h * 0.3)],
                [(0, 1, 2, 3, 4, 5, 6, 7)], mat, parent)


def _drying_rack(parent, x, y, width=0.85, height=1.15):
    for side in (-1, 1):
        beam("Drying rack post", (x + side * width / 2, y, 0.08),
             (x + side * width / 2, y, height), 0.035, "WOOD", parent)
    beam("Drying rack top rail", (x - width / 2, y, height),
         (x + width / 2, y, height), 0.034, "WOOD_LIGHT", parent)
    beam("Drying rack lower rail", (x - width / 2, y, height * 0.62),
         (x + width / 2, y, height * 0.62), 0.024, "WOOD", parent)
    _pelt(parent, x - width * 0.25, y - 0.028, height * 0.82, 0.26, 0.38, "HIDE")
    _pelt(parent, x + width * 0.25, y - 0.028, height * 0.80, 0.30, 0.44, "FUR")


def great_hall():
    parts = buildings.states("Clans great hall", 4, rubble_mats=("DARK", "WOOD"))
    base, walls, top = parts["levels"]

    box("Great hall footing", (0, 0, 0.13), (3.86, 3.86, 0.26), "STONE_DARK", base, 0.04)
    box("Great hall footing course", (0, 0, 0.30), (3.62, 3.54, 0.12), "STONE", base)
    box("Great hall plank floor", (0, 0.05, 0.37), (3.50, 3.40, 0.06), "WOOD", base)
    box("Great hall threshold", (0, -1.82, 0.17), (1.62, 0.44, 0.16), "STONE_LIGHT", base)
    box("Great hall entry step", (0, -1.98, 0.08), (1.44, 0.30, 0.10), "STONE", base)

    box("Timber hall body", (0, 0.15, 1.18), (3.24, 3.00, 1.58), "WOOD", walls, 0.03)
    for z in (0.62, 0.92, 1.22, 1.50):
        box("Hall log course", (0, -1.36, z), (3.28, 0.05, 0.10), "WOOD_LIGHT", walls)
    for x in (-1.60, 1.60):
        for y in (-1.32, 1.62):
            box("Hall corner post", (x, y, 1.22), (0.17, 0.17, 1.68), "WOOD_LIGHT", walls)
    box("West gable post", (-1.62, 0.15, 1.46), (0.14, 0.14, 1.14), "WOOD_LIGHT", walls)
    box("East gable post", (1.62, 0.15, 1.46), (0.14, 0.14, 1.14), "WOOD_LIGHT", walls)
    box("Hall wall plate", (0, 0.15, 1.97), (3.36, 3.12, 0.11), "WOOD_LIGHT", walls)

    box("Double door recess", (0, -1.38, 0.80), (1.24, 0.05, 1.34), "DARK", walls)
    for side in (-1, 1):
        box("Double door leaf", (side * 0.29, -1.41, 0.77), (0.55, 0.04, 1.26), "WOOD_LIGHT", walls)
        for z in (0.36, 0.86, 1.18):
            box("Door iron strap", (side * 0.29, -1.435, z), (0.51, 0.02, 0.045), "IRON", walls)
        box("Door iron handle", (side * 0.10, -1.45, 0.72), (0.035, 0.02, 0.16), "IRON", walls)
    box("Carved ochre lintel", (0, -1.44, 1.56), (1.52, 0.12, 0.23), "OCHRE", walls)
    for index in range(5):
        box("Lintel carved notch", (-0.60 + index * 0.30, -1.51, 1.56),
            (0.07, 0.025, 0.09), "DARK", walls)
    for x in (-0.80, 0.80):
        box("Carved ochre door post", (x, -1.42, 0.84), (0.13, 0.10, 1.30), "OCHRE", walls)
        box("Door post notch", (x, -1.48, 1.01), (0.09, 0.02, 0.06), "DARK", walls)
    _shield_front(walls, -1.26, -1.42, 1.06, 0.25)
    _shield_front(walls, 1.26, -1.42, 1.06, 0.25)
    box("Hall front team banner", (0, -1.40, 1.88), (0.86, 0.025, 0.16), "TEAM", walls)

    buildings._ridge_roof_x("Steep thatched great hall roof", (0, 0.15, 1.98),
                            3.94, 3.80, 1.65, "THATCH", top)
    for y in (-1.75, 2.05):
        beam("Thatch eave rail", (-1.94, y, 1.98), (1.94, y, 1.98), 0.055, "WOOD", top)
    beam("Roof ridge timber", (-1.94, 0.15, 3.63), (1.94, 0.15, 3.63), 0.075, "WOOD_LIGHT", top)
    for x in (-1.94, 1.94):
        _crossed_finials(top, x, 0.15, 3.60, 0.95)

    box("Smoke lantern base", (0.55, 0.15, 3.67), (0.30, 0.30, 0.06), "WOOD", top)
    box("Smoke lantern frame", (0.55, 0.15, 3.82), (0.28, 0.28, 0.26), "DARK", top)
    for lx in (-1, 1):
        for ly in (-1, 1):
            box("Smoke lantern corner post", (0.55 + lx * 0.13, 0.15 + ly * 0.13, 3.82),
                (0.035, 0.035, 0.28), "WOOD_LIGHT", top)
    box("Smoke lantern ember", (0.55, 0.15, 3.77), (0.13, 0.13, 0.08), "GOLD", top)
    cone("Smoke lantern cap", (0.55, 0.15, 4.00), 0.22, 0.16, "THATCH", top, vertices=8)
    ico("Lantern smoke", (0.55, 0.15, 4.15), (0.10, 0.10, 0.14), "CLOTH", top)
    flag(top, (2.02, 2.02, 0.40), 2.50)

    ico("Scorched door stone", (0.92, -1.43, 0.52), (0.22, 0.10, 0.18), "DARK", parts["damage"])
    ico("Scorched wall timber", (-1.56, -1.39, 1.38), (0.16, 0.08, 0.20), "DARK", parts["damage"])
    broken_plank = box("Broken wall plank", (1.55, -1.39, 0.84), (0.18, 0.03, 0.34),
                       "DARK", parts["damage"])
    broken_plank.rotation_euler.z = 0.22
    beam("Splintered door plank", (-0.50, -1.50, 0.66), (0.10, -1.58, 0.30),
         0.030, "WOOD_LIGHT", parts["damage"])
    fallen_shield = cylinder("Fallen team shield", (-1.02, -1.08, 0.13), 0.25, 0.025,
                             "TEAM", parts["damage"], 12)
    fallen_shield.rotation_euler.x = math.radians(12)

    beam("Collapsed roof timber", (0.20, -0.25, 0.20), (1.15, -0.05, 0.12),
         0.055, "WOOD", parts["rubble"])
    ico("Fallen thatch clump", (0.15, 0.10, 0.18), (0.42, 0.32, 0.16), "THATCH", parts["rubble"])
    box("Smashed door plank", (-0.55, -1.10, 0.12), (0.50, 0.08, 0.04), "WOOD_LIGHT", parts["rubble"])
    torn_shield = cylinder("Shattered team shield", (0.85, -1.15, 0.12), 0.23, 0.025,
                           "TEAM", parts["rubble"], 12)
    torn_shield.rotation_euler.x = math.radians(18)
    return parts


def longhouse():
    parts = buildings.states("Clans longhouse", 2, rubble_mats=("DARK", "WOOD"))
    base, walls, top = parts["levels"]

    box("Longhouse earth footing", (0, 0, 0.06), (1.86, 1.78, 0.12), "EARTH", base)
    box("Longhouse stone sill", (0, 0, 0.13), (1.68, 1.58, 0.10), "STONE_DARK", base)
    box("Longhouse threshold", (0, -0.72, 0.14), (0.62, 0.22, 0.10), "WOOD", base)

    box("Wattle longhouse walls", (0, 0.02, 0.55), (1.50, 1.35, 0.85), "WOOD_LIGHT", walls)
    for x in (-0.71, 0.71):
        for y in (-0.63, 0.67):
            box("Longhouse corner post", (x, y, 0.57), (0.11, 0.11, 0.94), "WOOD", walls)
    for z in (0.36, 0.62, 0.86):
        box("Woven wall band", (0, -0.685, z), (1.48, 0.045, 0.050), "WOOD", walls)
    for x in (-0.55, -0.30, -0.05, 0.20, 0.45):
        box("Wall wattle stake", (x, -0.705, 0.56), (0.035, 0.035, 0.86), "WOOD_LIGHT", walls)
    box("Longhouse wall plate", (0, -0.695, 0.99), (1.56, 0.07, 0.07), "WOOD", walls)
    box("Longhouse door recess", (-0.34, -0.70, 0.43), (0.54, 0.04, 0.66), "DARK", walls)
    box("Longhouse door leaf", (-0.34, -0.72, 0.43), (0.46, 0.03, 0.62), "WOOD", walls)
    box("Longhouse team door cloth", (-0.34, -0.752, 0.62), (0.52, 0.020, 0.28), "TEAM", walls)
    box("Door cloth bone fringe", (-0.34, -0.765, 0.46), (0.50, 0.012, 0.035), "BONE", walls)
    for x in (-0.60, -0.08):
        box("Door cloth timber peg", (x, -0.77, 0.77), (0.035, 0.02, 0.05), "WOOD", walls)

    roof("Longhouse shaggy thatch roof", (0, 0.02, 0.78), 2.08, 1.94, 1.04, "THATCH", top)
    beam("Longhouse ridge pole", (0, -0.97, 1.80), (0, 1.01, 1.80), 0.060, "WOOD_LIGHT", top)
    box("Longhouse smoke hole", (0, 0.10, 1.86), (0.24, 0.24, 0.05), "DARK", top)
    box("Longhouse roof weight stone", (-0.72, 0.52, 1.21), (0.16, 0.16, 0.10), "STONE", top)

    ico("Scorched thatch", (0.45, -0.20, 0.95), (0.30, 0.24, 0.14), "DARK", parts["damage"])
    beam("Splintered wattle stake", (-0.52, -0.74, 0.80), (-0.42, -0.86, 0.34),
         0.025, "WOOD_LIGHT", parts["damage"])
    box("Torn door cloth", (-0.58, -0.77, 0.40), (0.16, 0.012, 0.30), "TEAM", parts["damage"])

    ico("Collapsed thatch", (0.30, 0.10, 0.16), (0.36, 0.30, 0.14), "THATCH", parts["rubble"])
    beam("Fallen ridge pole", (-0.45, -0.20, 0.14), (0.55, 0.05, 0.10), 0.050, "WOOD_LIGHT", parts["rubble"])
    box("Broken door plank", (-0.50, -0.45, 0.10), (0.42, 0.06, 0.035), "WOOD", parts["rubble"])
    return parts


def field():
    parts = buildings.states("Clans field", 2, rubble_mats=("DARK", "WOOD"))
    base, fence, crops = parts["levels"]

    box("Tilled clan soil", (0, 0, 0.035), (1.92, 1.92, 0.07), "EARTH", base)
    for x in (-0.69, -0.35, 0, 0.35, 0.69):
        box("Raised planting row", (x, 0, 0.078), (0.21, 1.72, 0.075), "WOOD", base)

    for side in (-1, 1):
        for index in range(9):
            offset = -0.88 + index * 0.22
            box("Wattle fence stake", (offset, side * 0.95, 0.28), (0.04, 0.04, 0.44),
                "WOOD_LIGHT", fence)
            box("Wattle fence side stake", (side * 0.95, offset, 0.28), (0.04, 0.04, 0.44),
                "WOOD_LIGHT", fence)
        for z in (0.18, 0.38):
            beam("Woven fence rail", (-0.98, side * 0.95, z), (0.98, side * 0.95, z),
                 0.022, "WOOD_LIGHT", fence)
            beam("Woven fence side rail", (side * 0.95, -0.98, z), (side * 0.95, 0.98, z),
                 0.022, "WOOD_LIGHT", fence)

    rng = random.Random(719)
    for x in (-0.69, -0.35, 0, 0.35, 0.69):
        for row in range(7):
            y = -0.70 + row * 0.23
            height = 0.31 + rng.random() * 0.10
            beam("Wheat stalk", (x, y, 0.10), (x, y, height), 0.012, "WHEAT", crops)
            cone("Ripe wheat ear", (x, y, height + 0.085), 0.055, 0.18, "WHEAT", crops, vertices=5)
            beam("Wheat leaf", (x, y, 0.20), (x + 0.10, y + 0.045, 0.32), 0.012, "LEAF_LIGHT", crops)

    beam("Scarecrow pole", (0.42, 0.42, 0.08), (0.42, 0.42, 1.06), 0.035, "WOOD", crops)
    beam("Scarecrow cross arm", (0.08, 0.42, 0.82), (0.76, 0.42, 0.82), 0.028, "WOOD", crops)
    ico("Scarecrow sack head", (0.42, 0.42, 1.10), (0.13, 0.12, 0.15), "CLOTH", crops)
    cone("Scarecrow thatch hat", (0.42, 0.42, 1.24), 0.20, 0.10, "THATCH", crops, vertices=8)
    mesh("Scarecrow team rag",
         [(0.27, 0.375, 0.98), (0.57, 0.375, 0.98), (0.55, 0.375, 0.80),
          (0.59, 0.375, 0.66), (0.45, 0.375, 0.73), (0.31, 0.375, 0.64),
          (0.26, 0.375, 0.80)],
         [(0, 1, 2, 3, 4, 5, 6)], "TEAM", crops)
    box("Scarecrow straw cuff", (0.14, 0.42, 0.80), (0.10, 0.07, 0.16), "WHEAT", crops)
    box("Scarecrow straw cuff east", (0.70, 0.42, 0.80), (0.10, 0.07, 0.16), "WHEAT", crops)

    for x in (-0.69, 0, 0.69):
        for y in (-0.4, 0.25):
            broken = box("Trampled crop", (x, y, 0.24), (0.18, 0.30, 0.08), "DARK", parts["damage"])
            broken.rotation_euler.z = 0.35
    beam("Snapped fence rail", (0.30, -0.95, 0.34), (0.72, -0.86, 0.12), 0.022,
         "WOOD_LIGHT", parts["damage"])
    box("Scorched scarecrow rag", (0.34, 0.36, 0.60), (0.16, 0.015, 0.12), "DARK", parts["damage"])

    box("Scattered straw", (-0.20, 0.35, 0.12), (0.50, 0.30, 0.035), "WHEAT", parts["rubble"])
    beam("Broken fence stake", (-0.60, -0.20, 0.10), (-0.30, -0.05, 0.13), 0.035,
         "WOOD_LIGHT", parts["rubble"])
    ico("Fallen scarecrow head", (0.55, 0.55, 0.12), (0.12, 0.11, 0.12), "CLOTH", parts["rubble"])
    return parts


def hoard():
    parts = buildings.states("Clans hoard", 2, rubble_mats=("DARK", "WOOD"))
    base, walls, top = parts["levels"]

    box("Hoard earth footing", (0, 0, 0.08), (1.90, 1.82, 0.16), "EARTH", base)
    for x in (-0.58, 0.58):
        for y in (-0.48, 0.48):
            box("Stone stilt", (x, y, 0.36), (0.16, 0.16, 0.56), "STONE_DARK", base)
            box("Stilt cap stone", (x, y, 0.66), (0.21, 0.21, 0.08), "STONE", base)
    box("Hoard plank deck", (0, 0, 0.72), (1.74, 1.58, 0.10), "WOOD", base)
    box("Hoard lower step", (0, -0.98, 0.17), (0.66, 0.26, 0.14), "WOOD", base)
    box("Hoard middle step", (0, -0.86, 0.37), (0.60, 0.22, 0.14), "WOOD", base)
    box("Hoard upper step", (0, -0.78, 0.59), (0.56, 0.16, 0.20), "WOOD_LIGHT", base)

    box("Hoard log walls", (0, 0, 1.22), (1.48, 1.28, 0.92), "WOOD", walls, 0.02)
    for z in (0.88, 1.10, 1.32, 1.54):
        box("Hoard log course", (0, -0.655, z), (1.52, 0.06, 0.075), "WOOD_LIGHT", walls)
    for x in (-0.74, 0.74):
        for y in (-0.64, 0.64):
            box("Hoard protruding log end", (x, y, 0.90), (0.14, 0.14, 0.10), "WOOD_LIGHT", walls)
    box("Hoard wall plate", (0, 0, 1.68), (1.56, 1.34, 0.08), "WOOD_LIGHT", walls)
    box("Hoard door recess", (0, -0.66, 1.04), (0.64, 0.05, 0.74), "DARK", walls)
    box("Hoard plank door", (0, -0.68, 1.02), (0.56, 0.035, 0.66), "WOOD_LIGHT", walls)
    for z in (0.86, 1.18):
        box("Hoard door iron band", (0, -0.702, z), (0.52, 0.020, 0.045), "IRON", walls)
    box("Hoard door iron latch", (0.20, -0.71, 1.02), (0.035, 0.018, 0.10), "IRON", walls)
    box("Hoard team banner", (-0.50, -0.675, 1.32), (0.34, 0.025, 0.52), "TEAM", walls)
    box("Hoard banner bone trim", (-0.50, -0.692, 1.10), (0.30, 0.012, 0.035), "BONE", walls)

    box("Banded chest", (-0.52, -0.72, 0.87), (0.38, 0.28, 0.24), "WOOD_LIGHT", walls, 0.01)
    for z in (0.79, 0.95):
        box("Chest iron band", (-0.52, -0.72, z), (0.40, 0.30, 0.035), "IRON", walls)
    box("Chest gold lock", (-0.52, -0.865, 0.88), (0.07, 0.02, 0.09), "GOLD", walls)
    ico("Gold sack", (0.48, -0.72, 0.89), (0.18, 0.16, 0.16), "CLOTH", walls)
    ico("Gold sack heap", (0.48, -0.72, 1.02), (0.13, 0.12, 0.07), "GOLD", walls)
    ico("Small gold sack", (0.20, -0.78, 0.89), (0.12, 0.11, 0.12), "CLOTH", walls)
    ico("Small gold heap", (0.20, -0.78, 0.98), (0.09, 0.08, 0.05), "GOLD", walls)
    for index, (x, y) in enumerate(((0.34, -0.72), (0.42, -0.78), (0.38, -0.66))):
        box(f"Scattered gold ingot {index}", (x, y, 0.80), (0.10, 0.06, 0.04), "GOLD", walls)

    roof("Hoard thatch roof", (0, 0, 1.72), 1.72, 1.50, 0.64, "THATCH", top)
    beam("Hoard roof ridge", (0, -0.78, 2.36), (0, 0.78, 2.36), 0.055, "WOOD_LIGHT", top)
    box("Hoard ridge smoke vent", (0, 0.12, 2.44), (0.20, 0.20, 0.05), "DARK", top)
    ico("Hoard roof weight stone", (-0.58, -0.35, 2.00), (0.15, 0.15, 0.10), "STONE", top)

    ico("Scorched stilt stone", (0.58, -0.40, 0.42), (0.20, 0.12, 0.16), "STONE_DARK", parts["damage"])
    beam("Splintered hoard plank", (-0.62, -0.68, 1.02), (-0.28, -0.82, 0.58), 0.028,
         "WOOD_LIGHT", parts["damage"])
    box("Broken chest lid", (0.28, -0.60, 0.78), (0.20, 0.16, 0.04), "WOOD", parts["damage"])
    ico("Spilled gold", (0.30, -0.56, 0.74), (0.10, 0.08, 0.04), "GOLD", parts["damage"])

    box("Collapsed hoard stilt", (0.45, 0.20, 0.12), (0.70, 0.14, 0.12), "STONE_DARK", parts["rubble"])
    beam("Fallen hoard timber", (-0.20, -0.20, 0.16), (0.65, 0.10, 0.10), 0.050, "WOOD", parts["rubble"])
    ico("Burst gold sack", (0.05, -0.25, 0.14), (0.18, 0.15, 0.08), "GOLD", parts["rubble"])
    box("Broken chest plank", (-0.42, -0.30, 0.10), (0.34, 0.08, 0.035), "WOOD_LIGHT", parts["rubble"])
    return parts


def war_shrine():
    parts = buildings.states("Clans war shrine", 2, rubble_mats=("DARK", "WOOD"))
    base, walls, top = parts["levels"]

    box("Shrine earth ring", (0, 0, 0.05), (1.90, 1.90, 0.10), "EARTH", base)
    for x in (-0.58, 0.58):
        for y in (-0.58, 0.58):
            box("Standing stone footing", (x, y, 0.09), (0.34, 0.34, 0.18), "STONE_DARK", base)
    box("Idol footing", (0, 0, 0.11), (0.58, 0.58, 0.22), "STONE", base)

    for x in (-0.58, 0.58):
        for y in (-0.58, 0.58):
            stone = box("Standing stone", (x, y, 0.70), (0.24, 0.20, 1.26), "STONE", walls)
            stone.rotation_euler.z = 0.20 if x * y > 0 else -0.16
            box("Standing stone rune", (x, y - 0.115, 0.78), (0.07, 0.020, 0.32), "DARK", walls)
    box("Carved idol pole", (0, 0, 0.96), (0.28, 0.28, 1.54), "OCHRE", walls)
    for z in (0.46, 0.82, 1.18):
        box("Idol carved band", (0, -0.155, z), (0.31, 0.025, 0.075), "DARK", walls)
    box("Idol head", (0, 0, 1.86), (0.36, 0.34, 0.34), "OCHRE", walls)
    for x in (-0.08, 0.08):
        box("Idol dark eye", (x, -0.178, 1.92), (0.06, 0.020, 0.05), "DARK", walls)
    box("Idol dark mouth", (0, -0.178, 1.79), (0.15, 0.020, 0.045), "DARK", walls)
    beam("Idol outstretched arms", (-0.52, 0, 1.45), (0.52, 0, 1.45), 0.065, "OCHRE", walls)
    for side in (-1, 1):
        box("Idol team arm banner", (side * 0.40, -0.035, 1.22), (0.22, 0.025, 0.42),
            "TEAM", walls)
        box("Idol banner bone trim", (side * 0.40, -0.052, 1.03), (0.20, 0.012, 0.035),
            "BONE", walls)

    _antlers(top, 0, -0.02, 1.94, 1.15)
    for x in (-0.05, 0.05):
        cylinder("Fire bowl support", (x, -0.62, 0.30), 0.035, 0.42, "IRON", top, 6)
    bowl = cylinder("Iron fire bowl", (0, -0.62, 0.54), 0.24, 0.14, "IRON", top, 10)
    bowl.rotation_euler.x = 0.0
    cylinder("Fire bowl dark interior", (0, -0.62, 0.62), 0.18, 0.035, "DARK", top, 10)
    ico("Ochre ember", (0, -0.62, 0.67), (0.13, 0.11, 0.08), "OCHRE", top)
    for index, (x, y) in enumerate(((-0.16, -0.80), (0.16, -0.80), (0.0, -0.46))):
        cone(f"Fire bowl support stake {index}", (x, y, 0.22), 0.035, 0.34, "WOOD", top, vertices=6)

    ico("Scorched standing stone", (-0.58, -0.62, 0.88), (0.16, 0.10, 0.18), "DARK", parts["damage"])
    box("Cracked idol face", (0.10, -0.19, 1.82), (0.05, 0.02, 0.18), "DARK", parts["damage"])
    beam("Toppled team banner", (0.20, -0.30, 0.14), (0.62, -0.12, 0.10), 0.026,
         "TEAM", parts["damage"])

    box("Fallen standing stone", (-0.28, 0.32, 0.18), (0.70, 0.24, 0.20), "STONE", parts["rubble"])
    beam("Broken idol pole", (-0.15, -0.18, 0.16), (0.48, -0.05, 0.22), 0.070,
         "OCHRE", parts["rubble"])
    ico("Cold ember ash", (0.28, -0.50, 0.12), (0.20, 0.16, 0.08), "DARK", parts["rubble"])
    box("Torn idol team cloth", (0.42, -0.30, 0.11), (0.30, 0.18, 0.02), "TEAM", parts["rubble"])
    return parts


def mead_hall():
    parts = buildings.states("Clans mead hall", 3, rubble_mats=("DARK", "WOOD"))
    base, walls, top = parts["levels"]

    box("Mead hall footing", (0, 0, 0.08), (2.86, 2.86, 0.16), "STONE_DARK", base, 0.03)
    box("Mead hall plank floor", (0, 0.12, 0.19), (2.70, 2.50, 0.06), "WOOD", base)
    box("Mead hall threshold", (0, -1.18, 0.14), (0.92, 0.34, 0.12), "STONE_LIGHT", base)

    box("Mead hall timber body", (0, 0.15, 0.93), (2.50, 2.25, 1.42), "WOOD", walls, 0.02)
    for x in (-1.26, 1.26):
        for y in (-0.96, 1.22):
            box("Mead hall corner post", (x, y, 0.98), (0.14, 0.14, 1.50), "WOOD_LIGHT", walls)
    for z in (0.44, 0.72, 1.00, 1.28):
        box("Mead hall log band", (0, -0.985, z), (2.54, 0.055, 0.070), "WOOD_LIGHT", walls)
    box("Mead hall wall plate", (0, 0.15, 1.62), (2.60, 2.36, 0.08), "WOOD_LIGHT", walls)
    box("Mead hall door recess", (0, -0.99, 0.62), (0.78, 0.05, 1.02), "DARK", walls)
    box("Mead hall plank door", (0, -1.01, 0.60), (0.70, 0.035, 0.94), "WOOD_LIGHT", walls)
    for z in (0.34, 0.78):
        box("Mead hall door iron strap", (0, -1.032, z), (0.66, 0.020, 0.045), "IRON", walls)
    box("Mead hall door handle", (0.22, -1.04, 0.62), (0.045, 0.02, 0.10), "IRON", walls)

    beam("Shield rack rail", (-1.00, -1.01, 1.38), (1.00, -1.01, 1.38), 0.040, "WOOD", walls)
    for x in (-0.94, 0.94):
        box("Shield rack upright", (x, -1.00, 1.22), (0.08, 0.08, 0.52), "WOOD", walls)
    for x in (-0.80, -0.40, 0.0, 0.40, 0.80):
        _shield_front(walls, x, -1.035, 1.12, 0.175)
        box("Shield leather strap", (x, -1.02, 1.32), (0.035, 0.020, 0.14), "LEATHER", walls)
    for x in (-0.72, 0.72):
        _barrel(walls, x, -1.21, 0.36, 0.17, 0.44)
    box("Mead hall team banner", (0, -1.00, 1.50), (0.74, 0.025, 0.16), "TEAM", walls)

    roof("Mead hall thatched roof", (0, 0.15, 1.66), 2.92, 2.62, 1.00, "THATCH", top)
    beam("Mead hall roof ridge", (0, -1.16, 2.66), (0, 1.46, 2.66), 0.060, "WOOD_LIGHT", top)
    for y in (-1.16, 1.46):
        beam("Mead hall eave rail", (-1.46, y, 1.66), (1.46, y, 1.66), 0.045, "WOOD", top)
    beam("Crossed gable board", (-0.90, -1.19, 1.80), (0.55, -1.19, 2.25), 0.045, "WOOD", top)
    beam("Crossed gable board", (0.90, -1.19, 1.80), (-0.55, -1.19, 2.25), 0.045, "WOOD", top)
    box("Mead hall gable team cloth", (0, -1.21, 2.05), (0.62, 0.020, 0.30), "TEAM", top)
    ico("Mead hall roof weight stone", (-0.92, 0.40, 2.10), (0.16, 0.16, 0.10), "STONE", top)

    ico("Scorched mead hall wall", (0.82, -1.01, 0.72), (0.18, 0.10, 0.16), "DARK", parts["damage"])
    splintered = box("Splintered mead hall plank", (1.04, -1.00, 0.88), (0.16, 0.025, 0.42),
                     "DARK", parts["damage"])
    splintered.rotation_euler.z = -0.28
    box("Broken shield", (0.30, -1.08, 0.86), (0.26, 0.020, 0.26), "TEAM", parts["damage"])
    barrel_broken = cylinder("Cracked barrel", (-0.95, -1.10, 0.24), 0.17, 0.34, "WOOD", parts["damage"], 8)
    barrel_broken.rotation_euler.z = 0.3
    ico("Spilled mead", (-0.70, -1.16, 0.16), (0.18, 0.12, 0.04), "GOLD", parts["damage"])

    beam("Fallen mead hall beam", (-0.40, -0.40, 0.18), (0.65, -0.15, 0.12), 0.055, "WOOD", parts["rubble"])
    ico("Collapsed thatch", (0.20, 0.10, 0.16), (0.38, 0.30, 0.14), "THATCH", parts["rubble"])
    box("Shattered shield", (-0.65, -0.70, 0.11), (0.34, 0.20, 0.025), "TEAM", parts["rubble"])
    cylinder("Broken barrel hoop", (0.42, -0.55, 0.12), 0.18, 0.025, "IRON", parts["rubble"], 8)
    return parts


def hunters_lodge():
    parts = buildings.states("Clans hunter's lodge", 3, rubble_mats=("DARK", "WOOD"))
    base, walls, top = parts["levels"]

    box("Lodge earth floor", (0, 0, 0.06), (2.86, 2.86, 0.12), "EARTH", base)
    box("Lodge stone hearth", (-0.85, -0.55, 0.10), (0.62, 0.50, 0.16), "STONE_DARK", base)
    for index, (x, y) in enumerate(((-1.02, -0.72), (-0.68, -0.72), (-0.85, -0.38))):
        ico(f"Hearth stone {index}", (x, y, 0.17), (0.13, 0.12, 0.10), "STONE", base)
    box("Lodge doorway sill", (0, 0.62, 0.12), (0.70, 0.26, 0.12), "STONE_LIGHT", base)

    box("Lodge rear wall", (0, 0.95, 0.84), (2.50, 0.22, 1.44), "WOOD", walls, 0.02)
    for z in (0.34, 0.62, 0.90, 1.18, 1.46):
        box("Lodge rear log band", (0, 0.82, z), (2.54, 0.055, 0.065), "WOOD_LIGHT", walls)
    for x in (-1.20, 1.20):
        box("Lodge side wall", (x, 0.55, 0.78), (0.16, 0.90, 1.34), "WOOD", walls)
    box("Lodge door recess", (0, 0.83, 0.70), (0.58, 0.05, 0.98), "DARK", walls)
    box("Lodge door leaf", (0, 0.80, 0.68), (0.50, 0.03, 0.90), "WOOD_LIGHT", walls)
    box("Lodge door iron hinge", (0, 0.785, 0.82), (0.46, 0.02, 0.045), "IRON", walls)
    for x in (-1.25, 1.20):
        box("Lodge eave post", (x, 0.25, 0.70), (0.12, 0.12, 1.36), "WOOD", walls)
        beam("Lodge side purlin", (x, 0.95, 1.66), (x, 0.25, 1.40), 0.040, "WOOD", walls)
    beam("Lodge low eave beam", (-1.31, 0.25, 1.40), (1.26, 0.25, 1.40), 0.048, "WOOD", walls)
    beam("Lodge high roof beam", (-1.31, 0.95, 1.68), (1.26, 0.95, 1.68), 0.048, "WOOD", walls)

    _drying_rack(walls, -0.78, -0.18, 0.88, 1.12)
    for index, (x, y) in enumerate(((0.92, -0.82), (0.92, -0.32))):
        beam(f"Target stand leg {index}", (x - 0.22, y, 0.08), (x, y, 0.52), 0.024, "WOOD", walls)
        beam(f"Target stand leg {index}", (x + 0.22, y, 0.08), (x, y, 0.52), 0.024, "WOOD", walls)
        beam(f"Target stand rear leg {index}", (x, y + 0.22, 0.08), (x, y, 0.52), 0.024, "WOOD", walls)
        _target_disc(walls, x, y - 0.02, 0.60, 0.23)
    box("Lodge team banner", (-0.55, 0.22, 1.14), (0.52, 0.025, 0.42), "TEAM", walls)
    box("Lodge banner bone trim", (-0.55, 0.205, 0.92), (0.46, 0.012, 0.035), "BONE", walls)
    ico("Lodge antler pile", (-0.95, -1.10, 0.18), (0.30, 0.18, 0.14), "BONE", walls)

    mesh("Lodge lean-to hide roof",
         [(-1.42, 0.25, 1.38), (1.38, 0.25, 1.38),
          (1.38, 0.95, 1.68), (-1.42, 0.95, 1.68)],
         [(0, 1, 2, 3)], "THATCH", top)
    beam("Lodge low roof edge", (-1.40, 0.25, 1.40), (1.38, 0.25, 1.40), 0.040, "WOOD", top)
    beam("Lodge high roof edge", (-1.40, 0.95, 1.68), (1.38, 0.95, 1.68), 0.040, "WOOD", top)
    _antlers(top, 0, 0.20, 1.38, 1.00)
    box("Lodge antler trophy mount", (0, 0.22, 1.30), (0.22, 0.08, 0.14), "WOOD", top)

    beam("Splintered drying rack", (-0.84, -0.24, 0.90), (-0.42, -0.38, 0.50), 0.030,
         "WOOD_LIGHT", parts["damage"])
    ico("Scorched pelt", (-0.98, -0.20, 0.48), (0.20, 0.04, 0.20), "DARK", parts["damage"])
    beam("Broken target stand", (0.96, -0.32, 0.46), (0.70, -0.14, 0.20), 0.024,
         "WOOD", parts["damage"])
    box("Torn lodge banner", (0.18, -1.305, 0.82), (0.16, 0.012, 0.24), "TEAM", parts["damage"])

    ico("Collapsed hide roof", (0.20, -0.25, 0.16), (0.46, 0.34, 0.12), "HIDE", parts["rubble"])
    beam("Fallen lodge post", (-0.40, -0.50, 0.14), (0.55, -0.30, 0.10), 0.045, "WOOD", parts["rubble"])
    box("Fallen target disc", (0.45, 0.15, 0.13), (0.36, 0.05, 0.22), "THATCH", parts["rubble"])
    _pelt(parts["rubble"], -0.30, -0.10, 0.18, 0.28, 0.18, "FUR")
    return parts


def horse_pen():
    parts = buildings.states("Clans horse pen", 3, rubble_mats=("DARK", "WOOD"))
    base, walls, top = parts["levels"]

    box("Horse pen earth yard", (0, 0, 0.05), (2.86, 2.86, 0.10), "EARTH", base)
    box("Horse pen straw bedding", (0.35, -0.55, 0.09), (1.30, 0.95, 0.035), "WHEAT", base)
    box("Horse pen stone trough footing", (0.86, -0.22, 0.08), (0.62, 0.32, 0.06), "STONE_DARK", base)

    box("Horse shed rear wall", (0, 1.35, 0.72), (2.00, 0.16, 1.32), "WOOD", walls, 0.02)
    for z in (0.34, 0.62, 0.90, 1.18):
        box("Horse shed log band", (0, 1.25, z), (2.04, 0.050, 0.065), "WOOD_LIGHT", walls)
    for x in (-0.95, 0.95):
        box("Horse shed side wall", (x, 0.80, 0.70), (0.14, 1.10, 1.28), "WOOD", walls)
        box("Horse shed front post", (x, 0.15, 0.72), (0.14, 0.14, 1.38), "WOOD_LIGHT", walls)
    box("Horse stall front wall", (0, 0.15, 0.58), (1.80, 0.10, 0.94), "WOOD", walls)
    box("Horse stall dark opening", (-0.40, 0.085, 0.76), (0.60, 0.035, 0.58), "DARK", walls)
    box("Horse stall opening lintel", (-0.40, 0.07, 1.09), (0.72, 0.06, 0.06), "WOOD_LIGHT", walls)
    box("Horse pen team stall cloth", (0.55, 0.085, 0.94), (0.30, 0.020, 0.36), "TEAM", walls)

    for x in (-1.32, 1.32):
        for y in (-1.30, -0.60, 0.10):
            box("Corral post", (x, y, 0.42), (0.09, 0.09, 0.70), "WOOD", walls)
        for z in (0.32, 0.56):
            beam("Corral side rail", (x, -1.30, z), (x, 0.10, z), 0.026, "WOOD_LIGHT", walls)
    for x in (-1.32, -0.66, 0.66, 1.32):
        box("Corral front post", (x, -1.30, 0.42), (0.09, 0.09, 0.70), "WOOD", walls)
    for x0, x1 in ((-1.30, -0.36), (0.36, 1.30)):
        for z in (0.32, 0.56):
            beam("Corral front rail", (x0, -1.30, z), (x1, -1.30, z), 0.026, "WOOD_LIGHT", walls)
    for x in (-0.30, 0.30):
        box("Corral gate post", (x, -1.31, 0.48), (0.11, 0.11, 0.84), "WOOD", walls)
    for z in (0.34, 0.58):
        beam("Open corral gate", (-0.30, -1.28, z), (-0.30, -0.74, z), 0.026, "WOOD_LIGHT", walls)
    beam("Corral gate brace", (-0.30, -1.28, 0.34), (-0.30, -0.74, 0.58), 0.020, "WOOD", walls)
    flag(walls, (0.30, -1.34, 0.66), 0.40)
    box("Horse pen water trough", (0.86, -0.22, 0.22), (0.58, 0.24, 0.20), "WOOD", walls)
    box("Horse pen trough water", (0.86, -0.22, 0.30), (0.50, 0.18, 0.035), "DARK", walls)
    _hay_pile(walls, -1.02, -0.68, 0.26, 0.38, 0.30, 0.26)

    roof("Horse pen thatched shed roof", (0, 0.78, 1.34), 2.30, 1.55, 0.58, "THATCH", top)
    beam("Horse pen roof ridge", (0, 0.02, 1.90), (0, 1.54, 1.90), 0.052, "WOOD_LIGHT", top)
    ico("Shed roof weight stone", (-0.68, 0.72, 1.63), (0.15, 0.15, 0.10), "STONE", top)
    buildings._horse_head(top, -0.40, "HORSE_DUN")

    beam("Snapped corral rail", (0.70, -1.30, 0.54), (1.10, -1.10, 0.20), 0.024,
         "WOOD_LIGHT", parts["damage"])
    ico("Scorched hay", (-0.85, -0.40, 0.20), (0.28, 0.20, 0.10), "DARK", parts["damage"])
    box("Broken trough edge", (0.86, -0.34, 0.30), (0.20, 0.06, 0.05), "WOOD", parts["damage"])

    beam("Fallen corral rail", (-0.90, -0.90, 0.10), (0.15, -0.55, 0.10), 0.050, "WOOD_LIGHT", parts["rubble"])
    box("Fallen gate leaf", (0.45, -0.65, 0.12), (0.70, 0.06, 0.06), "WOOD", parts["rubble"])
    ico("Collapsed hay pile", (-0.90, -0.60, 0.18), (0.36, 0.30, 0.16), "THATCH", parts["rubble"])
    box("Torn stall cloth", (0.30, 0.10, 0.12), (0.28, 0.20, 0.02), "TEAM", parts["rubble"])
    return parts


def ram_shed():
    parts = buildings.states("Clans ram shed", 3, rubble_mats=("DARK", "WOOD"))
    base, walls, top = parts["levels"]

    box("Ram shed earth yard", (0, 0, 0.05), (2.86, 2.86, 0.10), "EARTH", base)
    box("Ram shed skid floor", (0.15, 0.10, 0.11), (1.10, 2.20, 0.06), "WOOD", base)
    for x in (-1.20, 1.20):
        for y in (-1.05, 0.15):
            box("Ram shed post footing", (x, y, 0.12), (0.24, 0.24, 0.14), "STONE_DARK", base)

    box("Ram shed back wall", (0, 1.25, 0.80), (2.60, 0.20, 1.50), "WOOD", walls, 0.02)
    for z in (0.36, 0.66, 0.96, 1.26, 1.50):
        box("Ram shed log band", (0, 1.14, z), (2.64, 0.055, 0.065), "WOOD_LIGHT", walls)
    for x in (-1.15, 1.15):
        for y in (0.05, 0.95):
            box("Ram shed post", (x, y, 0.67), (0.14, 0.14, 1.26), "WOOD", walls)
    for y in (0.05, 0.95):
        beam("Ram shed A-frame", (-1.18, y, 0.16), (0, y, 1.94), 0.050, "WOOD_LIGHT", walls)
        beam("Ram shed A-frame", (1.18, y, 0.16), (0, y, 1.94), 0.050, "WOOD_LIGHT", walls)
        beam("Ram shed truss tie", (-0.60, y, 0.95), (0.60, y, 0.95), 0.033, "WOOD", walls)
    beam("Ram shed eave beam", (-1.18, -0.25, 1.06), (1.18, -0.25, 1.06), 0.050, "WOOD", walls)
    box("Ram shed team banner", (0.48, -0.29, 0.77), (0.50, 0.025, 0.52), "TEAM", walls)
    box("Ram shed banner bone trim", (0.48, -0.305, 0.53), (0.44, 0.012, 0.035), "BONE", walls)
    buildings._siege_logs(walls)

    beam("Ram trestle fore leg", (-0.30, -0.95, 0.08), (0, -0.95, 0.74), 0.038, "WOOD", walls)
    beam("Ram trestle fore leg", (0.30, -0.95, 0.08), (0, -0.95, 0.74), 0.038, "WOOD", walls)
    beam("Ram trestle aft leg", (-0.30, -0.15, 0.08), (0, -0.15, 0.74), 0.038, "WOOD", walls)
    beam("Ram trestle aft leg", (0.30, -0.15, 0.08), (0, -0.15, 0.74), 0.038, "WOOD", walls)
    box("Ram trestle fore saddle", (0, -0.95, 0.73), (0.24, 0.12, 0.10), "WOOD_LIGHT", walls)
    box("Ram trestle aft saddle", (0, -0.15, 0.73), (0.24, 0.12, 0.10), "WOOD_LIGHT", walls)
    ram_log = cylinder("Unfinished ram log", (0, -0.55, 0.86), 0.10, 1.42, "WOOD_LIGHT", walls, 8)
    ram_log.rotation_euler.x = math.pi / 2
    for y in (-0.95, -0.15):
        box("Ram leather cradle", (0, y, 0.80), (0.24, 0.10, 0.04), "LEATHER", walls)
    box("Ram log iron band", (0, -1.18, 0.86), (0.22, 0.06, 0.22), "IRON", walls)
    for y in (-0.78, -0.38):
        beam("Ram log binding rope", (-0.12, y, 0.96), (0.12, y, 0.96), 0.020, "LEATHER", walls)
    spare = wheel(walls, (1.16, -0.95, 0.32), 0.26)
    spare.name = "Spare ram wheel"
    spare.rotation_euler.x = 0.16
    spare_b = wheel(walls, (-1.17, -0.62, 0.30), 0.24)
    spare_b.name = "Spare ram wheel west"
    spare_b.rotation_euler.x = -0.12

    roof("Hide-covered ram shed roof", (0, 0.65, 1.06), 3.20, 1.80, 1.00, "HIDE", top)
    beam("Ram shed fur ridge", (0, -0.24, 2.07), (0, 1.54, 2.07), 0.070, "FUR_DARK", top)
    for y in (-0.10, 0.65, 1.40):
        beam("Ram shed hide seam", (-1.55, y, 1.06), (0, y, 2.06), 0.030, "FUR_DARK", top)
        beam("Ram shed hide seam", (1.55, y, 1.06), (0, y, 2.06), 0.030, "FUR_DARK", top)
    box("Ram shed roof weight stone", (-0.70, 0.58, 1.68), (0.16, 0.16, 0.10), "STONE", top)

    beam("Slashed hide roof panel", (0.72, 0.10, 1.62), (1.10, 0.65, 1.38), 0.030,
         "DARK", parts["damage"])
    beam("Splintered truss beam", (-1.18, -0.30, 1.06), (-0.80, -0.30, 0.40), 0.040,
         "WOOD_LIGHT", parts["damage"])
    ico("Scorched ram log end", (0, -0.62, 0.92), (0.14, 0.12, 0.14), "DARK", parts["damage"])

    beam("Collapsed A-frame timber", (-0.80, -1.00, 0.22), (0.50, 0.35, 0.16), 0.055,
         "WOOD", parts["rubble"])
    ico("Torn hide roof scrap", (0.35, -0.45, 0.14), (0.38, 0.26, 0.05), "HIDE", parts["rubble"])
    box("Ram log spill", (-0.20, -0.30, 0.20), (0.80, 0.18, 0.18), "WOOD_LIGHT", parts["rubble"])
    box("Torn ram team banner", (0.65, -0.30, 0.12), (0.32, 0.24, 0.02), "TEAM", parts["rubble"])
    return parts


def watchtower():
    parts = buildings.states("Clans watchtower", 1, scaffold_height=1.95,
                             rubble_mats=("DARK", "WOOD"))
    base, walls, top = parts["levels"]

    for x in (-0.32, 0.32):
        for y in (-0.32, 0.32):
            box("Watchtower stone pad", (x, y, 0.08), (0.26, 0.26, 0.16), "STONE_DARK", base)
    for y in (-0.32, 0.32):
        box("Watchtower sill beam", (0, y, 0.18), (0.86, 0.10, 0.10), "WOOD", base)
    for x in (-0.32, 0.32):
        box("Watchtower sill beam", (x, 0, 0.18), (0.10, 0.86, 0.10), "WOOD", base)

    for x in (-0.33, 0.33):
        for y in (-0.33, 0.33):
            _log(walls, "Watchtower log leg", x, y, 0.14, 1.98, 0.075)
    for y in (-0.33, 0.33):
        beam("Watchtower cross brace", (-0.33, y, 0.26), (0.33, y, 1.62), 0.035, "WOOD_LIGHT", walls)
        beam("Watchtower cross brace", (0.33, y, 0.26), (-0.33, y, 1.62), 0.035, "WOOD_LIGHT", walls)
    for x in (-0.33, 0.33):
        beam("Watchtower side brace", (x, -0.33, 0.26), (x, 0.33, 1.62), 0.035, "WOOD_LIGHT", walls)
        beam("Watchtower side brace", (x, 0.33, 0.26), (x, -0.33, 1.62), 0.035, "WOOD_LIGHT", walls)
    for z in (0.78, 1.44):
        for y in (-0.33, 0.33):
            beam("Watchtower ring beam", (-0.33, y, z), (0.33, y, z), 0.030, "WOOD", walls)
        for x in (-0.33, 0.33):
            beam("Watchtower ring beam", (x, -0.33, z), (x, 0.33, z), 0.030, "WOOD", walls)

    box("Watchtower platform", (0, 0, 1.96), (0.92, 0.92, 0.10), "WOOD", top)
    for x in (-0.28, 0.28):
        box("Watchtower platform joist", (x, 0, 1.89), (0.10, 0.86, 0.08), "WOOD_LIGHT", top)
    for y in (-0.28, 0.28):
        box("Watchtower platform joist", (0, y, 1.89), (0.86, 0.10, 0.08), "WOOD_LIGHT", top)
    for side in (-1, 1):
        for index in range(5):
            offset = -0.40 + index * 0.20
            _log(top, "Watchtower parapet stake", offset, side * 0.42, 2.01, 2.34, 0.042)
            _log(top, "Watchtower parapet stake", side * 0.42, offset, 2.01, 2.34, 0.042)
    cone("Watchtower conical thatch cap", (0, 0, 2.58), 0.66, 0.52, "THATCH", top, vertices=10)
    beam("Watchtower cap finial", (0, 0, 2.82), (0, 0, 2.96), 0.026, "BONE", top)
    box("Watchtower team banner", (0, -0.47, 1.87), (0.54, 0.025, 0.46), "TEAM", top)
    box("Watchtower banner bone trim", (0, -0.485, 1.66), (0.48, 0.012, 0.035), "BONE", top)
    for side in (-1, 1):
        beam("Watchtower ladder rail", (side * 0.18, -0.56, 0.06),
             (side * 0.18, -0.44, 1.98), 0.026, "WOOD_LIGHT", top)
        for index in range(7):
            z = 0.24 + index * 0.26
            beam("Watchtower ladder rung", (-0.18, -0.545 + index * 0.017, z),
                 (0.18, -0.545 + index * 0.017, z), 0.018, "WOOD", top)

    ico("Scorched platform timber", (0.28, -0.20, 2.02), (0.18, 0.12, 0.06), "DARK", parts["damage"])
    beam("Snapped watchtower brace", (-0.33, -0.30, 1.10), (-0.12, -0.44, 0.52), 0.030,
         "WOOD_LIGHT", parts["damage"])
    box("Cracked platform plank", (-0.26, 0.15, 2.03), (0.28, 0.06, 0.035), "DARK", parts["damage"])

    beam("Fallen watchtower leg", (-0.45, 0.25, 0.09), (0.45, 0.25, 0.09), 0.075,
         "WOOD", parts["rubble"])
    box("Fallen platform plank", (0.20, -0.10, 0.11), (0.70, 0.10, 0.05), "WOOD", parts["rubble"])
    ico("Collapsed thatch", (0.10, 0.35, 0.16), (0.34, 0.28, 0.14), "THATCH", parts["rubble"])
    box("Torn watchtower cloth", (-0.25, -0.20, 0.10), (0.28, 0.20, 0.02), "TEAM", parts["rubble"])
    return parts


def palisade():
    parts = buildings.states("Clans palisade", 1, rubble_mats=("DARK", "WOOD"))
    base, walls, top = parts["levels"]

    box("Palisade earth footing", (0, 0, 0.04), (0.94, 0.94, 0.08), "EARTH", base)
    for index, (x, y) in enumerate(((-0.36, -0.34), (0.38, 0.20), (0.22, -0.38))):
        ico(f"Palisade base stone {index}", (x, y, 0.08), (0.13, 0.11, 0.07), "STONE_DARK", base)

    heights = ((0.95, 1.05, 0.95), (1.10, 1.00, 0.90), (0.95, 1.05, 0.95))
    for row, y in enumerate((-0.30, 0.0, 0.30)):
        for column, x in enumerate((-0.30, 0.0, 0.30)):
            height = heights[row][column]
            _log(walls, "Sharpened palisade log", x, y, 0.06, height, 0.155)
            _spike(walls, "Palisade sharpened tip", x, y, height + 0.09, 0.155)
    _shield_front(walls, 0.0, -0.472, 0.78, 0.105)
    _shield_side(walls, 0.472, 0.0, 0.78, 0.105, sign=1)

    for x in (-0.40, 0.40):
        box("Palisade leather band", (x, 0, 0.62), (0.055, 0.90, 0.10), "LEATHER", top)
    for y in (-0.40, 0.40):
        box("Palisade leather band", (0, y, 0.62), (0.90, 0.055, 0.10), "LEATHER", top)
    for x in (-0.36, 0.36):
        for y in (-0.36, 0.36):
            ico("Leather band knot", (x, y, 0.62), (0.055, 0.055, 0.065), "LEATHER", top)

    box("Chopped palisade notch", (-0.30, -0.46, 0.84), (0.20, 0.04, 0.14), "DARK", parts["damage"])
    beam("Splintered log top", (0.30, -0.30, 1.08), (0.42, -0.42, 0.72), 0.045,
         "WOOD_LIGHT", parts["damage"])
    ico("Scorched palisade earth", (0.18, 0.10, 0.10), (0.18, 0.14, 0.06), "DARK", parts["damage"])

    beam("Fallen palisade log", (-0.42, -0.10, 0.16), (0.20, -0.10, 0.16), 0.155,
         "WOOD", parts["rubble"])
    box("Broken palisade tip", (0.30, 0.22, 0.12), (0.16, 0.16, 0.10), "WOOD", parts["rubble"])
    ico("Scattered palisade earth", (-0.15, 0.30, 0.14), (0.26, 0.20, 0.08), "EARTH", parts["rubble"])
    return parts


def palisade_gate():
    parts = buildings.states(
        "Clans palisade gate",
        width=3,
        depth=1,
        scaffold_height=1.35,
        extra_roots={"closed_gate": "Closed gate assembly", "open_gate": "Open gate assembly"},
        rubble_mats=("DARK", "WOOD"),
    )
    base, walls, top = parts["levels"]
    closed_gate = parts["closed_gate"]
    open_gate = parts["open_gate"]

    box("Gate threshold paving", (0, 0, 0.05), (2.80, 0.86, 0.10), "STONE_DARK", base)
    for x in (-1.36, 1.36):
        box("Gate tower footing", (x, 0, 0.11), (0.40, 0.88, 0.22), "STONE_DARK", base, 0.02)
        box("Gate tower footing course", (x, 0, 0.24), (0.34, 0.80, 0.10), "STONE", base)

    for x in (-1.36, 1.36):
        for y in (-0.23, 0.0, 0.23):
            height = 1.86 + 0.08 * (1 if y == 0 else 0)
            _log(walls, "Gate tower log", x, y, 0.22, height, 0.125, vertices=6)
            _spike(walls, "Gate tower sharpened tip", x, y, height + 0.09, 0.125)
    for y in (-0.20, 0.20):
        beam("Gate lintel beam", (-1.30, y, 1.42), (1.30, y, 1.42), 0.075, "WOOD", walls)
    beam("Gate lintel cross tie", (-0.92, 0, 1.24), (0.92, 0, 1.24), 0.038, "WOOD_LIGHT", walls)
    _antlers(walls, 0, -0.22, 1.50, 0.78)

    for x in (-1.36, 1.36):
        box("Gate tower platform", (x, 0, 1.58), (0.48, 0.86, 0.09), "WOOD", top)
        for y in (-0.34, 0.34):
            _log(top, "Gate platform stake", x - 0.14, y, 1.62, 1.84, 0.045)
            _log(top, "Gate platform stake", x + 0.14, y, 1.62, 1.84, 0.045)
        box("Gate tower team banner", (x, -0.44, 1.28), (0.28, 0.025, 0.42), "TEAM", top)
        _shield_side(top, x + (0.11 if x > 0 else -0.11), 0, 1.24, 0.155,
                     sign=1 if x > 0 else -1)
    box("Gate hanging team pennant", (0.66, -0.10, 1.18), (0.42, 0.02, 0.34), "TEAM", top)
    box("Gate pennant bone trim", (0.66, -0.115, 1.00), (0.36, 0.012, 0.030), "BONE", top)

    for side, center in ((-1, -0.62), (1, 0.62)):
        for offset in (-0.51, -0.34, -0.17, 0.0, 0.17, 0.34, 0.51):
            x = center + offset
            _log(closed_gate, "Closed gate leaf log", x, 0, 0.04, 1.18, 0.082, vertices=6)
            _spike(closed_gate, "Closed gate leaf tip", x, 0, 1.27, 0.082)
        box("Closed gate rail", (center, 0, 0.30), (1.14, 0.18, 0.09), "WOOD", closed_gate)
        box("Closed gate rail", (center, 0, 0.82), (1.14, 0.18, 0.09), "WOOD", closed_gate)
        beam("Closed gate diagonal brace", (center - 0.48, -0.10, 0.24),
             (center + 0.48, -0.10, 0.88), 0.032, "WOOD_LIGHT", closed_gate)
        beam("Closed gate diagonal brace", (center - 0.48, 0.10, 0.88),
             (center + 0.48, 0.10, 0.24), 0.032, "WOOD_LIGHT", closed_gate)
        _shield_front(closed_gate, center, -0.11, 0.62, 0.17, rim="IRON")

    for side in (-1, 1):
        x = side * 1.15
        box("Open gate swung leaf", (x, 0.45, 0.62), (0.10, 0.80, 1.16), "WOOD", open_gate)
        for y in (0.15, 0.35, 0.55, 0.75):
            _log(open_gate, "Open gate leaf log", x, y, 0.04, 1.18, 0.070, vertices=6)
        box("Open gate rail", (x, 0.45, 0.30), (0.14, 0.74, 0.08), "WOOD", open_gate)
        box("Open gate rail", (x, 0.45, 0.84), (0.14, 0.74, 0.08), "WOOD", open_gate)
        _shield_side(open_gate, x + side * 0.07, 0.45, 0.64, 0.16, sign=side)

    ico("Scorched gate tower logs", (-1.36, -0.18, 0.94), (0.18, 0.12, 0.22), "DARK", parts["damage"])
    beam("Splintered gate lintel", (0.36, -0.10, 1.42), (0.76, -0.28, 1.12), 0.045,
         "WOOD_LIGHT", parts["damage"])
    ico("Scorched threshold", (0.55, -0.22, 0.13), (0.24, 0.15, 0.08), "DARK", parts["damage"])
    box("Torn gate team cloth", (-0.95, -0.12, 1.20), (0.16, 0.015, 0.28), "TEAM", parts["damage"])

    beam("Fallen gate tower log", (-0.95, -0.12, 0.13), (-0.15, -0.12, 0.13), 0.125,
         "WOOD", parts["rubble"])
    box("Shattered gate leaf", (0.30, 0.10, 0.12), (0.76, 0.22, 0.05), "WOOD", parts["rubble"])
    beam("Twisted gate rail", (0.05, -0.30, 0.10), (0.62, -0.12, 0.14), 0.035,
         "WOOD_LIGHT", parts["rubble"])
    box("Torn gate team banner", (-0.20, -0.22, 0.13), (0.34, 0.22, 0.02), "TEAM", parts["rubble"])
    ico("Broken antler ornament", (0.42, 0.18, 0.12), (0.20, 0.12, 0.08), "BONE", parts["rubble"])

    anim.visibility(open_gate, False)
    anim.visibility(closed_gate, True)
    return parts
