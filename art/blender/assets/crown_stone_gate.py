"""Crown stone gate (3x1 or 1x3 footprint).

Defensive fortified gatehouse with an arched portal spanning all three tiles,
slim end piers at the footprint edges, curtain wall walkway gallery, battlements,
team banners, and swappable closed / open portcullis and oak door assemblies.
Passage is fully open across all 3 tiles for passability.
"""
import math
from lib import anim, buildings
from lib.model import box, cylinder, flag, ico, beam, mesh


_parts = None

GATE_ANIMS = {
    **anim.BUILDING_ANIMS,
    "open": {"frames": 1, "loop": True},
    "damaged_open": {"frames": 1, "loop": False},
}


def stone_gate():
    parts = buildings.states(
        "Crown stone gate",
        width=3,
        depth=1,
        scaffold_height=1.35,
        extra_roots={"closed_gate": "Closed gate assembly", "open_gate": "Open gate assembly"},
    )
    base, walls, top = parts["levels"]
    closed_gate = parts["closed_gate"]
    open_gate = parts["open_gate"]

    # --- Base (Foundations & Portal Threshold) ---
    # Continuous threshold paving spanning the 3-tile passage
    box("Portal threshold paving", (0, 0, 0.05), (2.80, 0.88, 0.10), "STONE_DARK", base)

    # Slim end piers foundations at the footprint ends (outside the passable tiles)
    box("Left pier foundation", (-1.38, 0, 0.08), (0.22, 0.92, 0.16), "STONE_DARK", base, 0.02)
    box("Left pier stepped footing", (-1.38, 0, 0.18), (0.18, 0.88, 0.06), "STONE_LIGHT", base)
    box("Right pier foundation", (1.38, 0, 0.08), (0.22, 0.92, 0.16), "STONE_DARK", base, 0.02)
    box("Right pier stepped footing", (1.38, 0, 0.18), (0.18, 0.88, 0.06), "STONE_LIGHT", base)

    # --- Walls (End Piers, Arch Lintel & Gallery Wall) ---
    # Slim end piers shafts
    box("Left pier shaft", (-1.38, 0, 0.72), (0.16, 0.84, 1.04), "STONE", walls, 0.02)
    box("Right pier shaft", (1.38, 0, 0.72), (0.16, 0.84, 1.04), "STONE", walls, 0.02)

    # Exterior corner quoins on piers
    for x in (-1.45, -1.31):
        for y in (-0.41, 0.41):
            box("Left pier quoin", (x, y, 0.72), (0.05, 0.05, 1.04), "STONE_LIGHT", walls)
    for x in (1.31, 1.45):
        for y in (-0.41, 0.41):
            box("Right pier quoin", (x, y, 0.72), (0.05, 0.05, 1.04), "STONE_LIGHT", walls)

    # Pier mid stringcourses
    box("Left pier mid band", (-1.38, 0, 1.25), (0.18, 0.86, 0.06), "STONE_LIGHT", walls)
    box("Right pier mid band", (1.38, 0, 1.25), (0.18, 0.86, 0.06), "STONE_LIGHT", walls)

    # Portal arch lintel spanning the full 3 tiles between piers
    box("Portal arch lintel", (0, 0, 1.15), (2.88, 0.64, 0.16), "STONE_LIGHT", walls)

    # Gallery curtain wall over portal
    box("Gate gallery wall", (0, 0, 1.36), (2.88, 0.58, 0.26), "STONE", walls, 0.02)
    box("Gallery stringcourse", (0, 0, 1.51), (2.92, 0.64, 0.06), "STONE_LIGHT", walls)

    # South face (-Y) team banners on the gallery wall (clear of stringcourse and lintel)
    for x in (-0.90, 0.00, 0.90):
        box(f"Gallery banner {x}", (x, -0.305, 1.35), (0.28, 0.02, 0.28), "TEAM", walls)
        box(f"Gallery gold chevron {x}", (x, -0.318, 1.39), (0.18, 0.012, 0.04), "GOLD", walls)

    # Arrow slits on gallery wall between banners
    box("Gallery slit left", (-0.45, -0.298, 1.35), (0.06, 0.02, 0.20), "DARK", walls)
    box("Gallery slit right", (0.45, -0.298, 1.35), (0.06, 0.02, 0.20), "DARK", walls)

    # East face (+X) team decorations on right pier (visible in dir 0)
    box("East pier team banner", (1.465, 0, 1.35), (0.02, 0.26, 0.28), "TEAM", walls)
    box("East banner gold chevron", (1.478, 0, 1.39), (0.012, 0.16, 0.04), "GOLD", walls)
    shield_e = cylinder("East pier team shield", (1.465, 0, 0.82), 0.11, 0.022, "TEAM", walls, 8)
    shield_e.rotation_euler.y = math.pi / 2
    boss_e = cylinder("East pier shield boss", (1.478, 0, 0.82), 0.035, 0.015, "GOLD", walls, 6)
    boss_e.rotation_euler.y = math.pi / 2
    box("East pier arrow slit", (1.465, -0.22, 0.82), (0.02, 0.06, 0.24), "DARK", walls)

    # West face (-X) team decorations on left pier (visible in dir 6)
    box("West pier team banner", (-1.465, 0, 1.35), (0.02, 0.26, 0.28), "TEAM", walls)
    box("West banner gold chevron", (-1.478, 0, 1.39), (0.012, 0.16, 0.04), "GOLD", walls)
    shield_w = cylinder("West pier team shield", (-1.465, 0, 0.82), 0.11, 0.022, "TEAM", walls, 8)
    shield_w.rotation_euler.y = -math.pi / 2
    boss_w = cylinder("West pier shield boss", (-1.478, 0, 0.82), 0.035, 0.015, "GOLD", walls, 6)
    boss_w.rotation_euler.y = -math.pi / 2
    box("West pier arrow slit", (-1.465, -0.22, 0.82), (0.02, 0.06, 0.24), "DARK", walls)

    # --- Top (Walkway, Parapets, Merlons & Pennants) ---
    box("Walkway deck", (0, 0, 1.55), (2.90, 0.62, 0.04), "STONE_DARK", top)
    box("Parapet S", (0, -0.32, 1.67), (2.92, 0.08, 0.20), "STONE_LIGHT", top)
    box("Parapet N", (0, 0.32, 1.67), (2.92, 0.08, 0.20), "STONE_LIGHT", top)
    box("Parapet W", (-1.44, 0, 1.67), (0.08, 0.62, 0.20), "STONE_LIGHT", top)
    box("Parapet E", (1.44, 0, 1.67), (0.08, 0.62, 0.20), "STONE_LIGHT", top)

    for x in (-1.35, -0.90, -0.45, 0, 0.45, 0.90, 1.35):
        box(f"Merlon S {x}", (x, -0.32, 1.81), (0.22, 0.09, 0.14), "STONE_LIGHT", top)
        box(f"Merlon N {x}", (x, 0.32, 1.81), (0.22, 0.09, 0.14), "STONE_LIGHT", top)
    box("Merlon W", (-1.44, 0, 1.81), (0.09, 0.22, 0.14), "STONE_LIGHT", top)
    box("Merlon E", (1.44, 0, 1.81), (0.09, 0.22, 0.14), "STONE_LIGHT", top)

    flag(top, (-1.38, 0, 1.58), 0.36)
    flag(top, (1.38, 0, 1.58), 0.36)

    # --- Closed Gate Assembly (Lowered Portcullis & Closed Oak Doors) ---
    for x in (-1.20, -1.05, -0.90, -0.75, -0.60, -0.45, -0.30, -0.15, 0, 0.15, 0.30, 0.45, 0.60, 0.75, 0.90, 1.05, 1.20):
        box(f"Portcullis bar {x}", (x, 0, 0.54), (0.035, 0.035, 1.00), "IRON", closed_gate)
    for z in (0.16, 0.46, 0.76, 0.98):
        box(f"Portcullis rail {z}", (0, 0, z), (2.56, 0.04, 0.045), "IRON", closed_gate)

    box("Closed door L1", (-1.10, 0.05, 0.54), (0.38, 0.03, 0.96), "WOOD", closed_gate)
    box("Closed door R1", (-0.70, 0.05, 0.54), (0.38, 0.03, 0.96), "WOOD", closed_gate)
    box("Closed door L2", (-0.20, 0.05, 0.54), (0.38, 0.03, 0.96), "WOOD", closed_gate)
    box("Closed door R2", (0.20, 0.05, 0.54), (0.38, 0.03, 0.96), "WOOD", closed_gate)
    box("Closed door L3", (0.70, 0.05, 0.54), (0.38, 0.03, 0.96), "WOOD", closed_gate)
    box("Closed door R3", (1.10, 0.05, 0.54), (0.38, 0.03, 0.96), "WOOD", closed_gate)
    for z in (0.24, 0.60, 0.84):
        box(f"Door iron strap {z}", (0, 0.065, z), (2.54, 0.015, 0.04), "IRON", closed_gate)

    crest = cylinder("Closed gate team crest", (0, -0.025, 0.60), 0.14, 0.02, "TEAM", closed_gate, 8)
    crest.rotation_euler.x = math.pi / 2
    boss = cylinder("Crest gold boss", (0, -0.038, 0.60), 0.045, 0.015, "GOLD", closed_gate, 6)
    boss.rotation_euler.x = math.pi / 2

    # --- Open Gate Assembly (Raised Portcullis & Swung Open Doors) ---
    for x in (-1.20, -0.90, -0.60, -0.30, 0, 0.30, 0.60, 0.90, 1.20):
        box(f"Raised portcullis spike {x}", (x, 0, 1.10), (0.03, 0.03, 0.12), "IRON", open_gate)
    box("Raised portcullis rail", (0, 0, 1.14), (2.56, 0.04, 0.045), "IRON", open_gate)

    for x in (-1.28, -0.52, 0.52, 1.28):
        box(f"Swung door {x}", (x, 0, 0.54), (0.04, 0.38, 0.96), "WOOD", open_gate)

    # --- Damage ---
    # Scorch marks located only on stone piers and gallery wall
    ico("Scorched left pier", (-1.36, -0.30, 0.75), (0.18, 0.12, 0.18), "STONE_DARK", parts["damage"])
    ico("Scorched right pier", (1.36, -0.30, 0.75), (0.18, 0.12, 0.18), "STONE_DARK", parts["damage"])
    ico("Scorched gallery", (0.35, -0.30, 1.36), (0.22, 0.12, 0.16), "STONE_DARK", parts["damage"])

    # Cracks located only on gallery wall masonry
    for cx in (-0.85, 0.85):
        mesh("Gallery crack",
             [(cx, -0.315, 1.32), (cx + 0.04, -0.315, 1.40), (cx + 0.02, -0.315, 1.48),
              (cx + 0.03, -0.30, 1.48), (cx + 0.05, -0.30, 1.40), (cx + 0.01, -0.30, 1.32)],
             [(0, 1, 2, 3, 4, 5)], "DARK", parts["damage"])
    beam("Shattered portcullis bar", (-0.10, -0.15, 0.35), (0.15, -0.25, 0.10), 0.025, "IRON", parts["damage"])

    # --- Rubble ---
    box("Fallen lintel stone", (0.15, -0.10, 0.18), (0.65, 0.28, 0.20), "STONE_LIGHT", parts["rubble"])
    box("Shattered gate door", (-0.40, 0.12, 0.12), (0.75, 0.25, 0.06), "WOOD", parts["rubble"])
    beam("Twisted iron portcullis", (-0.10, -0.18, 0.10), (0.45, -0.12, 0.14), 0.035, "IRON", parts["rubble"])
    box("Torn gate team banner", (0.85, -0.15, 0.13), (0.35, 0.24, 0.02), "TEAM", parts["rubble"])
    crest_r = cylinder("Shattered gate team crest", (-0.90, 0.10, 0.12), 0.14, 0.02, "TEAM", parts["rubble"], 8)
    crest_r.rotation_euler.x = math.radians(25)

    anim.visibility(open_gate, False)
    anim.visibility(closed_gate, True)

    return parts


def build():
    global _parts
    _parts = stone_gate()
    return _parts["root"]


def anims():
    def gate_pose(name, frame, count):
        is_open = name in ("open", "damaged_open")
        anim.visibility(_parts["open_gate"], is_open)
        anim.visibility(
            _parts["closed_gate"],
            not is_open and (name in ("idle", "damaged") or (name == "construct" and frame >= 2)),
        )

    return anim.building_clips(_parts, extra_anims=GATE_ANIMS, on_pose=gate_pose)
