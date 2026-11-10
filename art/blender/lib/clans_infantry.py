"""Clans infantry: thrall, axeman, shield-bearer, berserker, javelineer and hunter.

Timber-and-fur northmen share the Crown human proportions and rigid-part rig (feet at the
origin, front to -Y, turned a quarter turn toward the isometric camera). The professional four
reuse the Crown pose functions and clip tables directly; the thrall and shield-bearer use the
shared character clips.
"""
import math

from lib import anim, characters
from lib.crown_infantry import (
    _blade,
    _figure,
    _halberdier_pose,
    _longbowman_pose,
    _man_at_arms_pose,
    _plate,
    _step,
    _topple,
)
from lib.model import beam, box, cone, cylinder, ico, root


# --- modelling helpers -------------------------------------------------------------------------

def _round_shield(parent, radius, ring=None, boss_mat="IVORY", forward=0.0):
    """Round centre-grip shield carried on an arm, built like the Crown sergeant buckler."""
    rim = cylinder("Iron shield rim", (0, -0.107 - forward, -0.22), radius + 0.018, 0.03, "IRON", parent, 12)
    rim.rotation_euler.x = math.pi / 2
    face = cylinder("Team round shield", (0, -0.125 - forward, -0.22), radius, 0.035, "TEAM", parent, 12)
    face.rotation_euler.x = math.pi / 2
    if ring is not None:
        band = cylinder("Painted shield ring", (0, -0.146 - forward, -0.22), radius * 0.78, 0.022,
                        ring, parent, 12)
        band.rotation_euler.x = math.pi / 2
        centre = cylinder("Team shield centre", (0, -0.160 - forward, -0.22), radius * 0.62, 0.014,
                          "TEAM", parent, 12)
        centre.rotation_euler.x = math.pi / 2
    boss_size = 0.06 if radius > 0.2 else 0.045
    boss_y = -0.171 if ring is not None else -0.148
    ico("Shield boss", (0, boss_y - forward, -0.22), (boss_size, 0.03, boss_size), boss_mat, parent)
    return face


# --- builders ----------------------------------------------------------------------------------

def thrall():
    p = _figure("Clans thrall", "thrall")
    body = p["body"]
    characters.belt(body)
    characters.tunic(body)
    characters.tunic_collar(body, mat="FUR")
    characters.head(body)
    ico("Shaggy hair", (0, 0.03, 1.15), (0.15, 0.125, 0.085), "HAIR", body, 2)
    for sign in (-1, 1):
        ico("Shaggy hair lock", (sign * 0.115, 0.045, 1.08), (0.05, 0.06, 0.09), "HAIR", body)
    ico("Beard", (0, -0.10, 0.965), (0.09, 0.06, 0.075), "HAIR", body)
    cone("Fur shoulder cape", (0, 0, 0.86), 0.255, 0.15, "FUR", body, 0.19, 8)
    for sign in (-1, 1):
        ico("Fur cape tuft", (sign * 0.20, 0.02, 0.80), (0.07, 0.075, 0.09), "FUR", body)
    characters.legs(p, upper="HIDE", boot="LEATHER", name="Hide leg wrap")
    for side in ("left", "right"):
        leg = p[side + "_leg"]
        for z in (-0.20, -0.33):
            beam("Leather leg wrap", (-0.07, -0.075, z), (0.07, -0.075, z), 0.016, "LEATHER", leg)
    characters.arm(p, "left")
    right = characters.arm(p, "right")
    beam("Mattock shaft", (0.035, -0.065, -0.51), (0.035, -0.065, 0.49), 0.022, "WOOD_LIGHT", right)
    box("Mattock socket", (0.035, -0.075, 0.43), (0.06, 0.07, 0.11), "IRON", right)
    _blade("Mattock pick", (-0.06, 0.43), (-0.27, 0.47), 0.075, 0.035, "IRON", right)
    _blade("Mattock peen", (-0.06, 0.43), (0.09, 0.45), 0.06, 0.035, "IRON", right)
    return p


def axeman():
    p = _figure("Clans axeman", "axeman")
    body = p["body"]
    characters.belt(body, size=(0.32, 0.22, 0.08))
    characters.tunic(body, r1=0.225, height=0.34, r2=0.17)
    characters.tunic_collar(body, mat="FUR")
    cloak = [(-0.18, 0.86), (0.18, 0.86), (0.22, 0.30), (0.0, 0.18), (-0.22, 0.30)]
    _plate("Fur back cloak", cloak, "y", 0.23, 0.035, "FUR_DARK", body)
    ico("Fur cloak clasp", (0, -0.125, 0.83), (0.07, 0.035, 0.05), "FUR", body)
    characters.head(body)
    ico("Beard", (0, -0.10, 0.965), (0.10, 0.06, 0.08), "HAIR", body)
    cylinder("Helm brow band", (0, 0, 1.10), 0.157, 0.04, "IRON", body, 10)
    cone("Iron conical helm", (0, 0, 1.20), 0.157, 0.18, "IRON", body, 0.025, 8)
    box("Helm nasal", (0, -0.155, 1.035), (0.03, 0.025, 0.13), "IRON", body)
    characters.legs(p, upper="HIDE", boot="LEATHER", name="Leg")
    characters.arm(p, "left", glove="LEATHER")
    right = characters.arm(p, "right", glove="LEATHER")
    beam("Axe haft", (0.025, -0.06, -0.62), (0.025, -0.06, 0.40), 0.022, "WOOD_LIGHT", right)
    box("Axe socket", (0.025, -0.06, 0.30), (0.055, 0.075, 0.10), "IRON", right)
    beard_axe = [(-0.06, 0.38), (-0.22, 0.35), (-0.34, 0.23), (-0.30, 0.10), (-0.16, 0.16), (-0.06, 0.20)]
    _plate("Bearded axe head", beard_axe, "x", 0.025, 0.034, "STEEL", right)
    cone("Axe top spike", (0.025, -0.06, 0.46), 0.03, 0.13, "STEEL", right, 0.0, 4)
    _round_shield(p["left_arm"], 0.17)
    return p


def shield_bearer():
    p = _figure("Clans shield-bearer", "shield_bearer")
    body = p["body"]
    characters.belt(body, size=(0.32, 0.22, 0.08))
    characters.tunic(body, r1=0.23, height=0.34, r2=0.175)
    characters.tunic_collar(body, mat="FUR")
    for z, x_shift in ((0.79, 0.0), (0.69, 0.025)):
        for x in (-0.16, 0.0, 0.16):
            box("Iron lamellar plate", (x + x_shift, -0.235, z), (0.13, 0.028, 0.082), "IRON", body)
            box("Iron lamellar plate", (x + x_shift, 0.235, z), (0.13, 0.028, 0.082), "IRON", body)
        for y in (-0.08, 0.08):
            for sign in (-1, 1):
                box("Iron lamellar side plate", (sign * 0.235, y, z), (0.028, 0.13, 0.082), "IRON", body)
    characters.head(body)
    ico("Beard", (0, -0.10, 0.965), (0.09, 0.06, 0.075), "HAIR", body)
    cylinder("Helm brow band", (0, 0, 1.10), 0.16, 0.04, "IRON", body, 10)
    cone("Iron conical helm", (0, 0, 1.21), 0.16, 0.19, "IRON", body, 0.025, 8)
    for sign in (-1, 1):
        beam("Bone helm horn", (sign * 0.13, 0.01, 1.15), (sign * 0.27, 0.03, 1.24), 0.032, "BONE", body)
        beam("Bone helm horn", (sign * 0.27, 0.03, 1.24), (sign * 0.31, 0.0, 1.35), 0.02, "BONE", body)
    characters.legs(p, upper="HIDE", boot="LEATHER", name="Leg")
    right = characters.arm(p, "right", glove="LEATHER")
    beam("Spear shaft", (0.035, -0.065, -0.70), (0.035, -0.065, 0.82), 0.02, "WOOD_LIGHT", right)
    cone("Spear head", (0.035, -0.065, 0.95), 0.055, 0.26, "STEEL", right, 0.0, 4)
    characters.arm(p, "left", glove="LEATHER")
    _round_shield(p["left_arm"], 0.26, ring="OCHRE", boss_mat="IRON", forward=0.075)
    return p


def berserker():
    p = _figure("Clans berserker", "berserker")
    body = p["body"]
    characters.belt(body)
    cone("Bare torso", (0, 0, 0.72), 0.245, 0.34, "SKIN", body, 0.205, 8)
    cone("Team kilt", (0, 0, 0.43), 0.25, 0.22, "TEAM", body, 0.21, 8)
    characters.head(body)
    ico("Wolf pelt cap", (0, 0.045, 1.18), (0.17, 0.15, 0.085), "FUR_DARK", body, 2)
    for sign in (-1, 1):
        ear = cone("Wolf ear", (sign * 0.09, 0.035, 1.29), 0.045, 0.14, "FUR_DARK", body, 0.0, 4)
        ear.rotation_euler.y = sign * 0.35
    cone("Fur shoulder mantle", (0, 0, 0.86), 0.30, 0.14, "FUR", body, 0.21, 8)
    for sign in (-1, 1):
        ico("Fur mantle tuft", (sign * 0.24, 0.02, 0.82), (0.075, 0.08, 0.10), "FUR", body)
    for z, tilt in ((0.76, 0.35), (0.69, -0.35), (0.62, 0.15)):
        torso_radius = 0.245 + (0.205 - 0.245) * ((z - 0.55) / 0.34)
        stripe = box("Ochre war paint", (0, -torso_radius - 0.004, z), (0.20, 0.012, 0.03), "OCHRE", body)
        stripe.rotation_euler.y = tilt
    characters.legs(p, upper="HIDE", boot="LEATHER", name="Leg")
    characters.arm(p, "right", hand=(-0.105, -0.20, -0.22), elbow=(-0.03, 0.04, -0.17),
                   sleeve="SKIN", forearm="SKIN", glove="LEATHER")
    characters.arm(p, "left", hand=(0.305, -0.20, 0.11), elbow=(0.12, -0.20, -0.10),
                   sleeve="SKIN", forearm="SKIN", glove="LEATHER")
    weapon = root("Great axe", (0, 0, 0.82), body)
    p["weapon"] = weapon
    x, y0 = 0.10, -0.20
    beam("Great axe haft", (x, y0, -0.74), (x, y0, 0.62), 0.026, "WOOD", weapon)
    for z in (0.28, 0.56):
        box("Great axe collar", (x, y0, z), (0.07, 0.09, 0.07), "IRON", weapon)
    front = [(y0, 0.58), (y0 - 0.20, 0.55), (y0 - 0.31, 0.43), (y0 - 0.22, 0.29), (y0, 0.27)]
    back = [(y0, 0.58), (y0 + 0.20, 0.55), (y0 + 0.31, 0.43), (y0 + 0.22, 0.29), (y0, 0.27)]
    _plate("Great axe blade", front, "x", x, 0.038, "STEEL", weapon)
    _plate("Great axe blade", back, "x", x, 0.038, "STEEL", weapon)
    cone("Great axe spike", (x, y0, 0.71), 0.035, 0.18, "STEEL", weapon, 0.0, 4)
    cone("Great axe butt spike", (x, y0, -0.81), 0.03, 0.12, "IRON", weapon, 0.0, 6).rotation_euler.x = math.pi
    return p


def javelineer():
    p = _figure("Clans javelineer", "javelineer")
    body = p["body"]
    characters.belt(body, size=(0.30, 0.20, 0.07))
    characters.tunic(body, r1=0.215, height=0.32, r2=0.165)
    characters.tunic_collar(body, mat="FUR")
    characters.head(body)
    ico("Fur hood", (0, 0.055, 1.14), (0.16, 0.13, 0.10), "FUR", body, 2)
    cylinder("Fur hood band", (0, 0.0, 1.115), 0.158, 0.03, "FUR_DARK", body, 10)
    cone("Hood tail", (0, 0.19, 1.12), 0.07, 0.22, "FUR", body, 0.0, 6).rotation_euler.x = -0.8
    characters.legs(p, upper="HIDE", boot="LEATHER", name="Hide leggings")
    cylinder("Hide quiver", (0.12, 0.24, 0.76), 0.058, 0.42, "HIDE", body, 8)
    for dx, dz in ((-0.028, 0.0), (0.02, 0.04), (0.0, -0.03)):
        beam("Quiver javelin", (0.12 + dx, 0.24, 0.95), (0.12 + dx * 2, 0.255, 1.14 + dz),
             0.011, "WOOD_LIGHT", body)
        cone("Quiver javelin head", (0.12 + dx * 2, 0.255, 1.20 + dz), 0.03, 0.12, "STEEL", body, 0.0, 4)
    characters.arm(p, "right", hand=(0.025, -0.07, -0.36), elbow=(0.03, 0.0, -0.18),
                   glove="LEATHER")
    javelin = root("Javelin", (0, 0, 0), p["right_hand"])
    p["javelin"] = javelin
    beam("Javelin shaft", (0, 0, -0.45), (0, 0, 0.55), 0.019, "WOOD_LIGHT", javelin)
    cone("Javelin head", (0, 0, 0.64), 0.032, 0.15, "STEEL", javelin, 0.0, 4)
    for angle in (0.0, math.pi / 3, -math.pi / 3):
        fin = box("Javelin fletching", (0, 0, -0.40), (0.055, 0.008, 0.09), "BONE", javelin)
        fin.rotation_euler.z = angle
    characters.arm(p, "left", glove="LEATHER")
    _round_shield(p["left_arm"], 0.135)
    return p


def hunter():
    p = _figure("Clans hunter", "hunter")
    body = p["body"]
    characters.belt(body, size=(0.28, 0.19, 0.07))
    characters.tunic(body, r1=0.215, height=0.32, r2=0.165)
    characters.tunic_collar(body, mat="FUR")
    cloak = [(-0.18, 0.86), (0.18, 0.86), (0.23, 0.36), (0.0, 0.27), (-0.23, 0.36)]
    _plate("Team short cloak", cloak, "y", 0.225, 0.03, "TEAM", body)
    beam("Quiver strap", (-0.14, -0.13, 0.87), (0.16, -0.12, 0.56), 0.02, "LEATHER", body)
    characters.head(body)
    ico("Fur hood", (0, 0.055, 1.14), (0.165, 0.135, 0.105), "FUR_DARK", body, 2)
    cylinder("Fur hood band", (0, 0.0, 1.115), 0.16, 0.03, "FUR_DARK", body, 10)
    cone("Hood tail", (0, 0.20, 1.12), 0.07, 0.22, "FUR_DARK", body, 0.0, 6).rotation_euler.x = -0.8
    cylinder("Hide quiver", (0.12, 0.30, 0.76), 0.058, 0.42, "HIDE", body, 8)
    for dx, dz in ((-0.025, 0.0), (0.02, 0.04), (0.0, -0.03)):
        beam("Quiver arrow", (0.12 + dx, 0.30, 0.95), (0.12 + dx * 2, 0.315, 1.12 + dz),
             0.01, "WOOD_LIGHT", body)
        ico("Quiver fletching", (0.12 + dx * 2, 0.315, 1.12 + dz), (0.028, 0.028, 0.04), "BONE", body)
    characters.legs(p, upper="HIDE", boot="LEATHER", name="Leg")
    for side, sign in (("left", -1), ("right", 1)):
        characters.arm(p, side, hand=(sign * 0.03, -0.07, -0.37), elbow=(sign * 0.03, 0.0, -0.19),
                       sleeve="HIDE", forearm="SKIN", bracer="LEATHER", glove="LEATHER")
    bow = root("Recurve bow", (-0.23, -0.22, 0.52), body)
    p["bow"] = bow
    box("Bow grip", (0, 0, 0), (0.05, 0.07, 0.17), "LEATHER", bow)
    upper = [(0.0, 0.0), (0.18, 0.012), (0.34, 0.05), (0.46, 0.12), (0.53, 0.20), (0.55, 0.17)]
    for sign in (1, -1):
        for (z1, y1), (z2, y2) in zip(upper, upper[1:]):
            beam("Recurve limb", (0, y1, sign * z1), (0, y2, sign * z2), 0.022, "WOOD_LIGHT", bow)
        ico("Bone bow tip", (0, 0.17, sign * 0.55), (0.03, 0.03, 0.03), "BONE", bow)
    p["string_rest"] = beam("Bow string", (0, 0.17, 0.55), (0, 0.17, -0.55), 0.01, "BONE", bow)
    for key, label in (("string_up", "Drawn string upper"), ("string_dn", "Drawn string lower")):
        p[key] = cylinder(label, (0, 0, 0), 0.01, 1.0, "BONE", bow, 6)
        p[key].hide_render = True
    arrow = root("Nocked arrow", (0, 0.17, 0), bow)
    p["arrow"] = arrow
    box("Arrow shaft", (0, -0.25, 0), (0.018, 0.50, 0.018), "WOOD_LIGHT", arrow)
    cone("Arrow head", (0, -0.535, 0), 0.03, 0.07, "STEEL", arrow, 0.0, 4).rotation_euler.x = math.pi / 2
    box("Arrow fletching", (0, -0.04, 0), (0.07, 0.08, 0.004), "BONE", arrow)
    box("Arrow fletching", (0, -0.04, 0), (0.004, 0.08, 0.07), "BONE", arrow)
    anim.visibility(arrow, False)
    return p


# --- clips -------------------------------------------------------------------------------------

def _javelineer_pose(p, name, frame, count):
    if name in ("idle", "walk"):
        _man_at_arms_pose(p, name, frame, count)
        return
    body = p["body"]
    if name == "attack":
        p["right_arm"].rotation_euler.x = (-0.2, -0.9, -1.8, -2.5, -2.7, 0.7, 0.4, 0.0)[frame]
        anim.lean(body, (0.0, -0.04, -0.1, -0.16, -0.18, 0.24, 0.12, 0.04)[frame])
        _step(p, frame, (0, 0, 0.05, 0.1, 0.1, -0.35, -0.2, -0.05))
        anim.visibility(p["javelin"], frame < 5)
    else:
        t = frame / (count - 1)
        _topple(body, t, -1, dip=0.06, twist=-0.25)


_POSES = {
    "axeman": _man_at_arms_pose,
    "berserker": _halberdier_pose,
    "javelineer": _javelineer_pose,
    "hunter": _longbowman_pose,
}


def clips(parts):
    pose = _POSES[parts["kind"]]
    return anim.clip_set(parts["root"], anim.UNIT_ANIMS,
                         lambda name, frame, count: pose(parts, name, frame, count))
