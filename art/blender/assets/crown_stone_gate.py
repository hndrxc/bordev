"""Crown stone gate (3x1 or 1x3 footprint).

Defensive fortified gatehouse flanked by two square stone towers, an arched
central portal, curtain wall walkway gallery, battlements, team banners, and
swappable closed / open portcullis assemblies.
"""
import math
import random
from lib import anim, buildings
from lib.model import root, box, cylinder, flag, ico, beam


_parts = None

GATE_ANIMS = {
    "construct": {"frames": 3, "loop": False},
    "idle": {"frames": 1, "loop": True},
    "damaged": {"frames": 1, "loop": False},
    "rubble": {"frames": 1, "loop": False},
    "open": {"frames": 1, "loop": True},
}


def states_3x1(name):
    """Custom 3x1 building state hierarchy (scaffold, rubble, damage sized to 3x1 footprint)."""
    parent = root(name)
    levels = [root(label, parent=parent) for label in ("Foundations", "Walls", "Roof and fittings")]
    scaffold = root("Construction scaffold", parent=parent)
    rubble = root("Collapsed rubble", parent=parent)
    damage = root("Damage cracks and scorch", parent=parent)
    closed_gate = root("Closed gate assembly", parent=parent)
    open_gate = root("Open gate assembly", parent=parent)

    # 3x1 scaffolding wrapping both flanking towers and central portal
    for x in (-1.42, -0.58, 0.58, 1.42):
        for y in (-0.44, 0.44):
            beam("Scaffold upright", (x, y, 0.02), (x, y, 1.72), 0.034, "WOOD_LIGHT", scaffold)
        for z in (0.55, 1.15):
            beam("Scaffold crossbar", (x, -0.44, z), (x, 0.44, z), 0.028, "WOOD_LIGHT", scaffold)
    for z in (0.55, 1.15):
        for y in (-0.44, 0.44):
            beam("Scaffold long rail", (-1.42, y, z), (1.42, y, z), 0.028, "WOOD_LIGHT", scaffold)
            box("Scaffold platform", (0, y, z), (2.84, 0.18, 0.035), "WOOD", scaffold)

    # 3x1 rubble scatter
    rng = random.Random(name)
    for index in range(20):
        rx = rng.uniform(-1.30, 1.30)
        ry = rng.uniform(-0.38, 0.38)
        chunk = ico("Rubble masonry", (rx, ry, 0.10 + rng.random() * 0.10),
                    (0.24, 0.18, 0.14 + rng.random() * 0.12),
                    "STONE_DARK" if index % 3 == 0 else "STONE", rubble)
        chunk.rotation_euler.z = rng.random() * math.tau
    for index in range(5):
        plank = box("Broken gate timber", (rng.uniform(-1.20, 1.20), rng.uniform(-0.35, 0.35), 0.18),
                    (0.65, 0.08, 0.06), "WOOD", rubble)
        plank.rotation_euler.z = rng.random() * math.pi

    anim.visibility(scaffold, False)
    anim.visibility(rubble, False)
    anim.visibility(damage, False)
    anim.visibility(open_gate, False)
    anim.visibility(closed_gate, True)

    return {
        "root": parent,
        "levels": levels,
        "scaffold": scaffold,
        "rubble": rubble,
        "damage": damage,
        "closed_gate": closed_gate,
        "open_gate": open_gate,
    }


def stone_gate():
    parts = states_3x1("Crown stone gate")
    base, walls, top = parts["levels"]
    closed_gate = parts["closed_gate"]
    open_gate = parts["open_gate"]

    # --- Base (Foundations & Portal Threshold) ---
    box("Left tower foundation", (-1.0, 0, 0.09), (0.94, 0.94, 0.18), "STONE_DARK", base, 0.03)
    box("Right tower foundation", (1.0, 0, 0.09), (0.94, 0.94, 0.18), "STONE_DARK", base, 0.03)
    box("Left tower stepped footing", (-1.0, 0, 0.20), (0.88, 0.88, 0.08), "STONE_LIGHT", base)
    box("Right tower stepped footing", (1.0, 0, 0.20), (0.88, 0.88, 0.08), "STONE_LIGHT", base)
    box("Portal threshold paving", (0, 0, 0.05), (1.08, 0.88, 0.10), "STONE_DARK", base)

    # --- Walls (Flanking Towers, Portal Frame & Curtain Gallery) ---
    box("Left tower shaft", (-1.0, 0, 0.82), (0.84, 0.84, 1.20), "STONE", walls, 0.025)
    box("Right tower shaft", (1.0, 0, 0.82), (0.84, 0.84, 1.20), "STONE", walls, 0.025)

    # Tower quoins at exterior corners
    for x in (-1.38, -0.62):
        for y in (-0.38, 0.38):
            box("Left tower quoin", (x, y, 0.82), (0.08, 0.08, 1.22), "STONE_LIGHT", walls)
    for x in (0.62, 1.38):
        for y in (-0.38, 0.38):
            box("Right tower quoin", (x, y, 0.82), (0.08, 0.08, 1.22), "STONE_LIGHT", walls)

    # Stringcourses
    box("Left tower mid band", (-1.0, 0, 1.42), (0.88, 0.88, 0.08), "STONE_LIGHT", walls)
    box("Right tower mid band", (1.0, 0, 1.42), (0.88, 0.88, 0.08), "STONE_LIGHT", walls)

    # Portal stone jambs and arched lintel
    box("Portal jamb left", (-0.48, 0, 0.58), (0.12, 0.62, 1.05), "STONE_LIGHT", walls)
    box("Portal jamb right", (0.48, 0, 0.58), (0.12, 0.62, 1.05), "STONE_LIGHT", walls)
    box("Portal arch lintel", (0, 0, 1.12), (1.08, 0.64, 0.18), "STONE_LIGHT", walls)

    # Gallery curtain wall over portal
    box("Gate gallery wall", (0, 0, 1.34), (0.92, 0.54, 0.36), "STONE", walls, 0.02)

    # Arrow slits on south face of flanking towers
    box("Left tower arrow slit", (-1.0, -0.425, 0.78), (0.07, 0.02, 0.34), "DARK", walls)
    box("Left slit lintel", (-1.0, -0.435, 0.97), (0.14, 0.04, 0.05), "STONE_LIGHT", walls)
    box("Right tower arrow slit", (1.0, -0.425, 0.78), (0.07, 0.02, 0.34), "DARK", walls)
    box("Right slit lintel", (1.0, -0.435, 0.97), (0.14, 0.04, 0.05), "STONE_LIGHT", walls)

    # Team banners on south faces of flanking towers
    box("Left tower team banner", (-1.0, -0.43, 0.96), (0.32, 0.02, 0.62), "TEAM", walls)
    box("Left banner gold chevron", (-1.0, -0.442, 1.05), (0.22, 0.012, 0.045), "GOLD", walls)
    box("Right tower team banner", (1.0, -0.43, 0.96), (0.32, 0.02, 0.62), "TEAM", walls)
    box("Right banner gold chevron", (1.0, -0.442, 1.05), (0.22, 0.012, 0.045), "GOLD", walls)

    # --- Top (Tower Battlements, Gallery Walkway & Flags) ---
    # Left tower battlement
    box("Left tower floor", (-1.0, 0, 1.48), (0.88, 0.88, 0.06), "STONE_DARK", top)
    box("Left parapet S", (-1.0, -0.42, 1.62), (0.88, 0.08, 0.22), "STONE_LIGHT", top)
    box("Left parapet N", (-1.0, 0.42, 1.62), (0.88, 0.08, 0.22), "STONE_LIGHT", top)
    box("Left parapet W", (-1.42, 0, 1.62), (0.08, 0.88, 0.22), "STONE_LIGHT", top)
    box("Left merlon SW", (-1.38, -0.38, 1.76), (0.16, 0.16, 0.16), "STONE_LIGHT", top)
    box("Left merlon NW", (-1.38, 0.38, 1.76), (0.16, 0.16, 0.16), "STONE_LIGHT", top)
    box("Left merlon S", (-1.0, -0.42, 1.75), (0.22, 0.09, 0.15), "STONE_LIGHT", top)
    flag(top, (-1.0, 0, 1.52), 0.36)

    # Right tower battlement
    box("Right tower floor", (1.0, 0, 1.48), (0.88, 0.88, 0.06), "STONE_DARK", top)
    box("Right parapet S", (1.0, -0.42, 1.62), (0.88, 0.08, 0.22), "STONE_LIGHT", top)
    box("Right parapet N", (1.0, 0.42, 1.62), (0.88, 0.08, 0.22), "STONE_LIGHT", top)
    box("Right parapet E", (1.42, 0, 1.62), (0.08, 0.88, 0.22), "STONE_LIGHT", top)
    box("Right merlon SE", (1.38, -0.38, 1.76), (0.16, 0.16, 0.16), "STONE_LIGHT", top)
    box("Right merlon NE", (1.38, 0.38, 1.76), (0.16, 0.16, 0.16), "STONE_LIGHT", top)
    box("Right merlon S", (1.0, -0.42, 1.75), (0.22, 0.09, 0.15), "STONE_LIGHT", top)
    flag(top, (1.0, 0, 1.52), 0.36)

    # Gallery walkway connecting towers
    box("Gallery walkway deck", (0, 0, 1.52), (0.94, 0.54, 0.05), "STONE_DARK", top)
    box("Gallery parapet S", (0, -0.27, 1.64), (0.94, 0.08, 0.20), "STONE_LIGHT", top)
    box("Gallery parapet N", (0, 0.27, 1.64), (0.94, 0.08, 0.20), "STONE_LIGHT", top)
    box("Gallery merlon S1", (-0.24, -0.27, 1.78), (0.18, 0.09, 0.14), "STONE_LIGHT", top)
    box("Gallery merlon S2", (0.24, -0.27, 1.78), (0.18, 0.09, 0.14), "STONE_LIGHT", top)

    # --- Closed Gate Assembly (Lowered Portcullis & Closed Oak Doors) ---
    for x in (-0.36, -0.24, -0.12, 0, 0.12, 0.24, 0.36):
        box(f"Portcullis bar {x}", (x, 0, 0.52), (0.035, 0.035, 0.95), "IRON", closed_gate)
    for z in (0.15, 0.45, 0.75, 0.95):
        box(f"Portcullis rail {z}", (0, 0, z), (0.84, 0.04, 0.045), "IRON", closed_gate)
    box("Closed gate door left", (-0.21, 0.05, 0.52), (0.42, 0.03, 0.92), "WOOD", closed_gate)
    box("Closed gate door right", (0.21, 0.05, 0.52), (0.42, 0.03, 0.92), "WOOD", closed_gate)
    for z in (0.25, 0.65, 0.85):
        box(f"Door iron strap {z}", (0, 0.065, z), (0.82, 0.015, 0.04), "IRON", closed_gate)

    crest = cylinder("Closed gate team crest", (0, -0.025, 0.60), 0.14, 0.02, "TEAM", closed_gate, 8)
    crest.rotation_euler.x = math.pi / 2
    boss = cylinder("Crest gold boss", (0, -0.038, 0.60), 0.045, 0.015, "GOLD", closed_gate, 6)
    boss.rotation_euler.x = math.pi / 2

    # --- Open Gate Assembly (Raised Portcullis & Swung Open Doors) ---
    # Clear dark shadow along the passage floor showing open aperture
    box("Open passage shadow floor", (0, 0, 0.05), (0.82, 0.74, 0.02), "DARK", open_gate)
    # Raised portcullis head visible in upper archway slot
    box("Raised portcullis head", (0, 0, 1.25), (0.82, 0.05, 0.30), "IRON", open_gate)
    for x in (-0.36, -0.24, -0.12, 0, 0.12, 0.24, 0.36):
        box(f"Raised portcullis spike {x}", (x, 0, 1.05), (0.03, 0.03, 0.12), "IRON", open_gate)
    # Oak doors swung wide open 90 degrees against interior stone jambs
    box("Swung door left", (-0.42, 0, 0.52), (0.04, 0.42, 0.92), "WOOD", open_gate)
    box("Swung door right", (0.42, 0, 0.52), (0.04, 0.42, 0.92), "WOOD", open_gate)
    for z in (0.25, 0.65, 0.85):
        box(f"Swung strap left {z}", (-0.445, 0, z), (0.015, 0.40, 0.04), "IRON", open_gate)
        box(f"Swung strap right {z}", (0.445, 0, z), (0.015, 0.40, 0.04), "IRON", open_gate)

    shield_l = cylinder("Open doorway team shield L", (-0.48, -0.32, 0.95), 0.10, 0.02, "TEAM", open_gate, 8)
    shield_l.rotation_euler.x = math.pi / 2
    shield_r = cylinder("Open doorway team shield R", (0.48, -0.32, 0.95), 0.10, 0.02, "TEAM", open_gate, 8)
    shield_r.rotation_euler.x = math.pi / 2

    # --- Damage ---
    buildings.cracks(parts["damage"], -0.44, 0.95, 2.2)
    ico("Scorched left tower", (-0.85, -0.43, 0.85), (0.22, 0.14, 0.18), "STONE_DARK", parts["damage"])
    ico("Scorched archway", (0.20, -0.32, 1.12), (0.20, 0.12, 0.15), "STONE_DARK", parts["damage"])
    beam("Shattered portcullis bar", (-0.10, -0.15, 0.35), (0.15, -0.25, 0.10), 0.025, "IRON", parts["damage"])

    # --- Rubble ---
    box("Fallen lintel stone", (0.15, -0.10, 0.18), (0.65, 0.28, 0.20), "STONE_LIGHT", parts["rubble"])
    box("Shattered gate door", (-0.40, 0.12, 0.12), (0.75, 0.25, 0.06), "WOOD", parts["rubble"])
    beam("Twisted iron portcullis", (-0.10, -0.18, 0.10), (0.45, -0.12, 0.14), 0.035, "IRON", parts["rubble"])
    box("Torn gate team banner", (0.85, -0.15, 0.13), (0.35, 0.24, 0.02), "TEAM", parts["rubble"])
    crest_r = cylinder("Shattered tower team crest", (-0.90, 0.10, 0.12), 0.14, 0.02, "TEAM", parts["rubble"], 8)
    crest_r.rotation_euler.x = math.radians(25)

    return parts


def build():
    global _parts
    _parts = stone_gate()
    return _parts["root"]


def anims():
    levels = _parts["levels"]
    scaffold = _parts["scaffold"]
    rubble = _parts["rubble"]
    damage = _parts["damage"]
    closed_gate = _parts["closed_gate"]
    open_gate = _parts["open_gate"]

    def pose(name, frame, count):
        anim.visibility(scaffold, name == "construct")
        anim.visibility(rubble, name == "rubble")
        anim.visibility(damage, name == "damaged")
        anim.visibility(closed_gate, name in ("idle", "damaged") or (name == "construct" and frame >= 2))
        anim.visibility(open_gate, name == "open")

        for index, level in enumerate(levels):
            visible = name != "rubble"
            if name == "construct":
                visible = index <= frame
            if name == "damaged" and index == len(levels) - 1:
                level.rotation_euler.y = 0.055
                level.location.z -= 0.045
            anim.visibility(level, visible)

    return anim.clip_set(_parts["root"], GATE_ANIMS, pose)
