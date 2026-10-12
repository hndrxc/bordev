"""Crown stone wall (1x1 footprint).

Defensive curtain wall with stone plinth foundation, cut-stone masonry core,
pilaster buttresses on each face, corbelled walkway coping, crenellated merlons,
and heraldic team shields.
"""
import math
from lib import anim, buildings
from lib.model import box, cylinder, flag, ico, beam


_parts = None


def stone_wall():
    parts = buildings.states("Crown stone wall", 1)
    base, walls, top = parts["levels"]

    # --- Base (Foundations) ---
    box("Wall foundation plinth", (0, 0, 0.08), (0.94, 0.94, 0.16), "STONE_DARK", base, 0.02)
    box("Wall footing course", (0, 0, 0.18), (0.88, 0.88, 0.08), "STONE_LIGHT", base)

    # --- Walls (Core masonry & pilasters) ---
    box("Curtain wall core", (0, 0, 0.52), (0.82, 0.82, 0.60), "STONE", walls, 0.02)
    box("South pilaster", (0, -0.42, 0.50), (0.34, 0.06, 0.58), "STONE_LIGHT", walls)
    box("North pilaster", (0, 0.42, 0.50), (0.34, 0.06, 0.58), "STONE_LIGHT", walls)
    box("West pilaster", (-0.42, 0, 0.50), (0.06, 0.34, 0.58), "STONE_LIGHT", walls)
    box("East pilaster", (0.42, 0, 0.50), (0.06, 0.34, 0.58), "STONE_LIGHT", walls)
    box("Wall corbel band", (0, 0, 0.83), (0.90, 0.90, 0.06), "STONE_LIGHT", walls)

    # Team coverage: heraldic team shields on camera-facing sides
    shield_s = cylinder("South team shield", (0, -0.445, 0.54), 0.11, 0.022, "TEAM", walls, 8)
    shield_s.rotation_euler.x = math.pi / 2
    boss_s = cylinder("South shield boss", (0, -0.458, 0.54), 0.035, 0.015, "IRON", walls, 6)
    boss_s.rotation_euler.x = math.pi / 2

    shield_w = cylinder("West team shield", (-0.445, 0, 0.54), 0.11, 0.022, "TEAM", walls, 8)
    shield_w.rotation_euler.y = math.pi / 2
    boss_w = cylinder("West shield boss", (-0.458, 0, 0.54), 0.035, 0.015, "IRON", walls, 6)
    boss_w.rotation_euler.y = math.pi / 2

    # --- Top (Walkway, Parapets & Merlons) ---
    box("Wall walkway", (0, 0, 0.86), (0.80, 0.80, 0.04), "STONE_DARK", top)
    box("Parapet coping south", (0, -0.41, 0.98), (0.86, 0.09, 0.20), "STONE_LIGHT", top)
    box("Parapet coping north", (0, 0.41, 0.98), (0.86, 0.09, 0.20), "STONE_LIGHT", top)
    box("Parapet coping west", (-0.41, 0, 0.98), (0.09, 0.86, 0.20), "STONE_LIGHT", top)
    box("Parapet coping east", (0.41, 0, 0.98), (0.09, 0.86, 0.20), "STONE_LIGHT", top)

    for x in (-0.37, 0.37):
        for y in (-0.37, 0.37):
            box("Corner merlon", (x, y, 1.14), (0.17, 0.17, 0.16), "STONE_LIGHT", top)
    box("South center merlon", (0, -0.41, 1.13), (0.24, 0.10, 0.14), "STONE_LIGHT", top)
    box("North center merlon", (0, 0.41, 1.13), (0.24, 0.10, 0.14), "STONE_LIGHT", top)
    box("West center merlon", (-0.41, 0, 1.13), (0.10, 0.24, 0.14), "STONE_LIGHT", top)
    box("East center merlon", (0.41, 0, 1.13), (0.10, 0.24, 0.14), "STONE_LIGHT", top)

    flag(top, (0.22, 0.22, 1.05), 0.26)

    # --- Damage ---
    buildings.cracks(parts["damage"], -0.42, 0.55, 0.8)
    ico("Scorched wall breach", (0.12, -0.43, 0.42), (0.14, 0.08, 0.12), "STONE_DARK", parts["damage"])
    beam("Embedded arrow", (-0.16, -0.42, 0.52), (-0.10, -0.52, 0.58), 0.012, "WOOD_LIGHT", parts["damage"])

    # --- Rubble ---
    shield_r = cylinder("Shattered team shield", (0.18, -0.16, 0.09), 0.11, 0.02, "TEAM", parts["rubble"], 8)
    shield_r.rotation_euler.x = math.radians(20)
    box("Fallen parapet block", (-0.18, 0.20, 0.12), (0.22, 0.15, 0.12), "STONE_LIGHT", parts["rubble"])

    return parts


def build():
    global _parts
    _parts = stone_wall()
    return _parts["root"]


def anims():
    return anim.building_clips(_parts)
