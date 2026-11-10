"""Crown stone tower (1x1 footprint).

Defensive watchtower with stone foundation plinth, arched entrance door,
tapered stone shaft with quoins and arrow slits, corbelled battlements,
crenellations, and Crown team pennant flag.
"""
from lib import anim, buildings
from lib.model import box, flag, ico, beam


_parts = None


def stone_tower():
    parts = buildings.states("Crown stone tower", 1, scaffold_height=1.95)
    base, walls, top = parts["levels"]

    # --- Base (Foundations & Ground Entrance) ---
    box("Tower foundation plinth", (0, 0, 0.09), (0.94, 0.94, 0.18), "STONE_DARK", base, 0.03)
    box("Tower stepped footing", (0, 0, 0.22), (0.86, 0.86, 0.10), "STONE_LIGHT", base)
    box("Tower foot masonry", (0, 0, 0.38), (0.82, 0.82, 0.22), "STONE", base, 0.02)
    box("Tower entrance door recess", (0, -0.415, 0.42), (0.28, 0.025, 0.42), "DARK", base)
    box("Reinforced entrance door", (0, -0.425, 0.38), (0.22, 0.02, 0.34), "WOOD", base)
    box("Door stone lintel", (0, -0.42, 0.58), (0.32, 0.05, 0.06), "STONE_LIGHT", base)

    # --- Walls (Tower shaft, arrow slits & corbels) ---
    box("Tower lower shaft", (0, 0, 1.02), (0.76, 0.76, 1.06), "STONE", walls, 0.025)
    for x in (-0.36, 0.36):
        for y in (-0.36, 0.36):
            box("Shaft quoin", (x, y, 1.02), (0.09, 0.09, 1.08), "STONE_LIGHT", walls)
    box("Mid stringcourse", (0, 0, 1.58), (0.80, 0.80, 0.08), "STONE_LIGHT", walls)
    box("Tower upper shaft", (0, 0, 1.88), (0.74, 0.74, 0.54), "STONE", walls, 0.02)

    # Arrow slits on south and east faces (lower shaft)
    box("Arrow slit south lower", (0, -0.385, 1.05), (0.07, 0.02, 0.34), "DARK", walls)
    box("Slit lintel south lower", (0, -0.395, 1.24), (0.13, 0.04, 0.05), "STONE_LIGHT", walls)
    box("Arrow slit east lower", (0.385, 0, 1.05), (0.02, 0.07, 0.34), "DARK", walls)
    box("Slit lintel east lower", (0.395, 0, 1.24), (0.04, 0.13, 0.05), "STONE_LIGHT", walls)

    # Corbel brackets widening to the battlement platform
    box("Corbel base band", (0, 0, 2.18), (0.86, 0.86, 0.08), "STONE_LIGHT", walls)
    for offset in (-0.28, -0.09, 0.09, 0.28):
        box("Corbel bracket S", (offset, -0.40, 2.14), (0.07, 0.07, 0.09), "STONE_LIGHT", walls)
        box("Corbel bracket N", (offset, 0.40, 2.14), (0.07, 0.07, 0.09), "STONE_LIGHT", walls)
        box("Corbel bracket W", (-0.40, offset, 2.14), (0.07, 0.07, 0.09), "STONE_LIGHT", walls)
        box("Corbel bracket E", (0.40, offset, 2.14), (0.07, 0.07, 0.09), "STONE_LIGHT", walls)

    # Team banners on south and east faces (upper shaft, clear of stringcourse and corbels)
    box("Tower team banner south", (0, -0.385, 1.88), (0.26, 0.02, 0.44), "TEAM", walls)
    box("Banner gold chevron south", (0, -0.398, 1.94), (0.18, 0.012, 0.04), "GOLD", walls)
    box("Tower team banner east", (0.385, 0, 1.88), (0.02, 0.26, 0.44), "TEAM", walls)
    box("Banner gold chevron east", (0.398, 0, 1.94), (0.012, 0.18, 0.04), "GOLD", walls)

    # --- Top (Battlement platform, Parapets & Merlons) ---
    box("Tower floor", (0, 0, 2.24), (0.90, 0.90, 0.05), "STONE_DARK", top)
    box("Tower parapet S", (0, -0.43, 2.38), (0.92, 0.08, 0.24), "STONE_LIGHT", top)
    box("Tower parapet N", (0, 0.43, 2.38), (0.92, 0.08, 0.24), "STONE_LIGHT", top)
    box("Tower parapet W", (-0.43, 0, 2.38), (0.08, 0.92, 0.24), "STONE_LIGHT", top)
    box("Tower parapet E", (0.43, 0, 2.38), (0.08, 0.92, 0.24), "STONE_LIGHT", top)

    for x in (-0.40, 0.40):
        for y in (-0.40, 0.40):
            box("Tower corner merlon", (x, y, 2.56), (0.17, 0.17, 0.18), "STONE_LIGHT", top)
    box("Tower merlon S", (0, -0.43, 2.55), (0.22, 0.09, 0.16), "STONE_LIGHT", top)
    box("Tower merlon N", (0, 0.43, 2.55), (0.22, 0.09, 0.16), "STONE_LIGHT", top)
    box("Tower merlon W", (-0.43, 0, 2.55), (0.09, 0.22, 0.16), "STONE_LIGHT", top)
    box("Tower merlon E", (0.43, 0, 2.55), (0.09, 0.22, 0.16), "STONE_LIGHT", top)

    # Top Crown team pennant flag
    flag(top, (0, 0, 2.26), 0.42)

    # --- Damage ---
    buildings.cracks(parts["damage"], -0.39, 1.2, 0.8)
    ico("Scorched tower breach", (0.26, -0.38, 2.10), (0.16, 0.12, 0.14), "STONE_DARK", parts["damage"])
    ico("Scorched mid shaft", (-0.22, -0.39, 1.40), (0.14, 0.10, 0.12), "STONE_DARK", parts["damage"])

    # --- Rubble ---
    box("Torn tower team banner", (-0.16, -0.22, 0.12), (0.26, 0.22, 0.02), "TEAM", parts["rubble"])
    box("Fallen corbel stone", (0.20, 0.16, 0.15), (0.26, 0.22, 0.16), "STONE_LIGHT", parts["rubble"])
    box("Broken tower timber", (0.05, -0.10, 0.11), (0.55, 0.05, 0.05), "WOOD", parts["rubble"])

    return parts


def build():
    global _parts
    _parts = stone_tower()
    return _parts["root"]


def anims():
    return anim.building_clips(_parts)
