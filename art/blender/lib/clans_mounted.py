"""Clans cavalry: a dun light horse raider and a bay-armoured war rider share the Crown mount rig.

Both riders keep the Crown mounted part contract (`root`, `mount`, `horse`, `heavy`, `rider`,
`torso`, `left_arm`, `right_arm`, `rider_legs`) so `crown_mounted.clips` poses them directly.
Clans identity comes from fur, hide and bone over the Crown saddle furniture: the raider is a
fur-capped skirmisher with a light spear and buckler, the war rider an iron-clad boar-spear
lancer on a fur-blanketed destrier.
"""
import math
from mathutils import Vector
from lib import characters, crown_mounted
from lib.model import root, box, ico, cylinder, cone, beam


def _round_shield(arm, radius, depth, boss_scale):
    """Round shield facing -Y on a resting left arm; the iron rim stays visible past the team face."""
    crown_mounted._tilt(cylinder("Shield rim", (0.0, -0.107, -0.22), radius, depth, "IRON", arm, 14),
                        math.pi / 2)
    crown_mounted._tilt(cylinder("Team round shield", (0.0, -0.107 - depth * 0.6, -0.22),
                                 radius * 0.92, depth * 0.9, "TEAM", arm, 14), math.pi / 2)
    ico("Bone shield boss", (0.0, -0.107 - depth * 1.2, -0.22),
        (boss_scale, 0.03, boss_scale), "BONE", arm)


def _rider(parts, heavy):
    rider = root("Rider", (0, 0.02, 0.955), parts["mount"])
    rider.scale = (0.92, 0.92, 0.92)
    torso = root("Rider torso", parent=rider)
    rider_legs = root("Rider legs", parent=rider)
    parts.update(rider=rider, torso=torso)
    characters.belt(torso, z_offset=-0.53)
    characters.tunic(torso, z_offset=-0.53)
    characters.head(torso, z_offset=-0.53, face=True)
    characters.tunic_collar(torso, z_offset=-0.53, mat="FUR")
    if heavy:
        # Iron lamellar over the team tunic: three laced rows front and a solid back plate.
        for z in (0.265, 0.175, 0.085):
            box("Iron lamellar row", (0, -0.195, z), (0.27, 0.05, 0.078), "IRON", torso)
            for x in (-0.09, 0.0, 0.09):
                box("Lamellar stud", (x, -0.223, z), (0.018, 0.012, 0.018), "STEEL", torso)
        box("Iron lamellar back", (0, 0.15, 0.18), (0.25, 0.05, 0.22), "IRON", torso)
        ico("Fur shoulder mantle", (0, 0.01, 0.325), (0.195, 0.145, 0.055), "FUR", torso)
        cone("Iron conical helm", (0, 0, 0.655), 0.16, 0.17, "IRON", torso, 0.045, 10)
        cylinder("Helm brow band", (0, 0, 0.575), 0.165, 0.032, "LEATHER", torso, 12)
        for sign in (-1, 1):
            crown_mounted._pointed("Bone helm horn", (sign * 0.13, 0.0, 0.63),
                                   (sign * 0.30, -0.04, 0.80), 0.038, "BONE", torso, 5)
        beam("Helm chin strap", (-0.12, -0.095, 0.545), (0.12, -0.095, 0.545), 0.014, "LEATHER", torso)
        ico("Beard", (0, -0.105, 0.435), (0.09, 0.06, 0.07), "HAIR", torso)
        crown_mounted._tilt(box("Team war cloak", (0, 0.185, 0.11), (0.32, 0.035, 0.48), "TEAM", torso),
                            0.12)
    else:
        cone("Fur cap crown", (0, 0.01, 0.64), 0.155, 0.15, "FUR", torso, 0.045, 8)
        cylinder("Fur cap band", (0, 0.0, 0.585), 0.16, 0.04, "FUR_DARK", torso, 10)
        crown_mounted._tilt(cone("Fur cap tail", (0, 0.15, 0.60), 0.07, 0.22, "FUR_DARK", torso, 0.0, 6),
                            -0.9)
        ico("Beard", (0, -0.105, 0.435), (0.095, 0.06, 0.075), "HAIR", torso)
        box("Hide vest front", (0, -0.185, 0.185), (0.25, 0.05, 0.25), "HIDE", torso)
        box("Hide vest back", (0, 0.165, 0.185), (0.24, 0.04, 0.23), "HIDE", torso)
        beam("Vest lacing", (-0.09, -0.213, 0.29), (0.09, -0.213, 0.08), 0.012, "FUR_DARK", torso)
        beam("Vest lacing", (0.09, -0.214, 0.29), (-0.09, -0.214, 0.08), 0.012, "FUR_DARK", torso)
        cylinder("Team scarf", (0, 0, 0.355), 0.11, 0.06, "TEAM", torso)
    for side in ("left", "right"):
        characters.arm(parts, side, z_offset=-0.53,
                       sleeve="IRON" if heavy else "TEAM",
                       forearm="IRON" if heavy else "SKIN",
                       glove="IRON" if heavy else "LEATHER",
                       rest_x=crown_mounted.REST[side], parent=torso)
    characters.rider_legs(rider_legs, heavy=heavy)
    right, left = parts["right_arm"], parts["left_arm"]
    if heavy:
        hand, direction, tip = crown_mounted._haft(
            right, "right", (0, -0.985, -0.17), 0.5, 1.0, 0.028, "WOOD")
        crown_mounted._pointed("Iron boar spear head", tip - direction * 0.32, tip + direction * 0.06,
                               0.055, "IRON", right, 6)
        crossbar = tip - direction * 0.34
        beam("Bone boar spear crossbar", crossbar + Vector((0.17, 0, 0)),
             crossbar - Vector((0.17, 0, 0)), 0.022, "BONE", right)
        _round_shield(left, 0.26, 0.032, 0.06)
    else:
        hand, direction, tip = crown_mounted._haft(
            right, "right", (0, -0.96, 0.28), 0.45, 0.8, 0.02, "WOOD_LIGHT")
        crown_mounted._pointed("Iron spear head", tip - direction * 0.24, tip + direction * 0.05,
                               0.05, "IRON", right, 4)
        crown_mounted._pointed("Team spear pennon", tip - direction * 0.22, tip - direction * 0.60,
                               0.055, "TEAM", right, 4)
        _round_shield(left, 0.18, 0.03, 0.045)
    parts["rider_legs"] = rider_legs


def build(kind):
    if kind not in ("horse_raider", "war_rider"):
        raise ValueError(f"Unknown Clans mounted unit {kind!r}")
    heavy = kind == "war_rider"
    parent = root("Clans war rider" if heavy else "Clans horse raider")
    parent.rotation_euler.z = math.pi / 4
    mount = root("Mount motion", parent=parent)
    horse = root("Horse body", parent=mount)
    parts = {"root": parent, "mount": mount, "horse": horse, "heavy": heavy}
    crown_mounted._horse(parts, heavy, "HORSE_BAY" if heavy else "HORSE_DUN")
    if heavy:
        box("Fur barding blanket", (0, 0.0, 0.885), (0.47, 0.76, 0.055), "FUR_DARK", horse)
    _rider(parts, heavy)
    return parts


def clips(parts):
    return crown_mounted.clips(parts)
