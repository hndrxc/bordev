"""Crown worker and infantry share a readable, rigid-part human silhouette."""
import math
from mathutils import Vector
from lib.model import root, box, ico, cylinder, cone, beam, mesh


def head(parent, z_offset=0.0, face=True):
    cylinder("Neck", (0, 0, 0.91 + z_offset), 0.065, 0.10, "SKIN", parent)
    if face:
        ico("Head", (0, -0.018, 1.035 + z_offset), (0.135, 0.115, 0.17), "SKIN", parent, 2)
        ico("Nose", (0, -0.13, 1.035 + z_offset), (0.036, 0.047, 0.038), "SKIN", parent)
        for x in (-0.058, 0.058):
            ico("Eye", (x, -0.119, 1.08 + z_offset), (0.012, 0.012, 0.012), "DARK", parent)


def legs(parts, parent=None, upper="CLOTH", boot="LEATHER", width=0.115, name="Trouser leg"):
    body = parent if parent is not None else parts["body"]
    for side, sign in (("left", -1), ("right", 1)):
        leg = root(side + " leg", (sign * 0.09, 0, 0.51), body)
        box(name, (0, 0, -0.16), (width, 0.135, 0.29), upper, leg)
        box("Boot", (0, -0.045, -0.41), (0.135, 0.21, 0.15), boot, leg)
        parts[side + "_leg"] = leg


def rider_legs(parent, heavy=False):
    for sign in (-1, 1):
        beam("Thigh", (sign * 0.11, 0.02, -0.03), (sign * 0.25, -0.07, -0.20), 0.075,
             "STEEL" if heavy else "CLOTH", parent)
        beam("Shin", (sign * 0.25, -0.07, -0.20), (sign * 0.27, -0.05, -0.46), 0.058,
             "STEEL" if heavy else "LEATHER", parent)
        box("Boot", (sign * 0.27, -0.09, -0.50), (0.10, 0.20, 0.09), "IRON" if heavy else "LEATHER", parent)
        beam("Stirrup leather", (sign * 0.285, -0.09, -0.06), (sign * 0.285, -0.09, -0.45), 0.012, "LEATHER", parent)


def arm(parts, side, z_offset=0.0, hand=None, elbow=None, sleeve="TEAM", forearm="SKIN",
        glove="SKIN", bracer=None, rest_x=0.0, segmented=False, parent=None):
    body = parent if parent is not None else parts.get("body", parts.get("torso"))
    sign = -1 if side == "left" else 1
    pivot = root(side + " shoulder", (sign * 0.205, 0, 0.82 + z_offset), body)
    if segmented or hand is not None or elbow is not None or bracer is not None:
        hand_v = Vector(hand if hand is not None else (sign * 0.025, -0.055, -0.33))
        elbow_v = Vector(elbow if elbow is not None else (sign * 0.025, 0, -0.17))
        ico("Shoulder", (0, 0, -0.02), (0.09, 0.095, 0.095), sleeve, pivot)
        beam("Upper arm", (0, 0, -0.02), elbow_v, 0.058, sleeve, pivot)
        beam("Forearm", elbow_v, hand_v, 0.047, forearm, pivot)
        if bracer:
            beam("Bracer", elbow_v.lerp(hand_v, 0.3), elbow_v.lerp(hand_v, 0.9), 0.053, bracer, pivot)
        ico("Hand", hand_v, (0.055, 0.055, 0.065), glove, pivot)
        parts[side + "_arm"] = pivot
        parts[side + "_hand"] = root(side + " grip", hand_v, pivot)
    else:
        ico("Sleeve", (sign * 0.025, 0, -0.09), (0.085, 0.10, 0.16), sleeve, pivot)
        beam("Forearm", (sign * 0.025, 0, -0.18), (sign * 0.025, -0.055, -0.32), 0.048, forearm, pivot)
        ico("Hand", (sign * 0.025, -0.055, -0.33), (0.055, 0.055, 0.065), glove, pivot)
        parts[side + "_arm"] = pivot
    if rest_x:
        pivot.rotation_euler.x = rest_x
    return pivot


def belt(parent, z_offset=0.0, size=(0.30, 0.20, 0.075), mat="LEATHER"):
    return box("Belt", (0, 0, 0.53 + z_offset), size, mat, parent)


def tunic(parent, z_offset=0.0, r1=0.22, height=0.32, mat="TEAM", r2=0.17, vertices=6, name="Team tunic"):
    return cone(name, (0, 0, 0.69 + z_offset), r1, height, mat, parent, r2, vertices)


def tunic_collar(parent, z_offset=0.0, y=-0.115, z=0.82, size=(0.15, 0.025, 0.06), mat="IVORY"):
    return box("Tunic collar", (0, y, z + z_offset), size, mat, parent)


def build(spearman=False):
    parent = root("Crown spearman" if spearman else "Crown peasant")
    parent.rotation_euler.z = math.pi / 4
    body = root("Body motion", parent=parent)
    parts = {"root": parent, "body": body}
    belt(body)
    tunic(body)
    tunic_collar(body)
    head(body)
    if spearman:
        cone("Steel helmet", (0, 0, 1.155), 0.15, 0.17, "STEEL", body, 0.06)
        cylinder("Helmet brim", (0, 0, 1.095), 0.175, 0.038, "IRON", body)
        box("Nasal guard", (0, -0.151, 1.046), (0.027, 0.025, 0.14), "STEEL", body)
        box("Padded breastplate", (0, -0.16, 0.73), (0.25, 0.065, 0.20), "IRON", body)
    else:
        ico("Hair", (0, 0.025, 1.145), (0.143, 0.11, 0.075), "HAIR", body)
        cylinder("Straw hat brim", (0, 0, 1.155), 0.24, 0.025, "THATCH", body, 10)
        cone("Straw hat crown", (0, 0, 1.205), 0.145, 0.09, "THATCH", body, 0.10, 10)
        box("Apron", (0, -0.165, 0.565), (0.22, 0.025, 0.27), "CLOTH", body)
    legs(parts)
    for side in ("left", "right"):
        arm(parts, side)
    hand = parts["right_arm"]
    if spearman:
        beam("Spear shaft", (0.035, -0.065, -0.64), (0.035, -0.065, 0.83), 0.018, "WOOD_LIGHT", hand)
        cone("Spear head", (0.035, -0.065, 0.94), 0.055, 0.25, "STEEL", hand, vertices=4)
        shield = parts["left_arm"]
        mesh("Kite shield", [(-0.09, -0.11, -0.04), (0.15, -0.11, -0.04), (0.18, -0.11, -0.28),
                             (0.03, -0.11, -0.52), (-0.12, -0.11, -0.28)], [(0, 1, 2, 3, 4)], "TEAM", shield)
        beam("Shield cross", (-0.08, -0.122, -0.18), (0.14, -0.122, -0.18), 0.02, "IVORY", shield)
        beam("Shield cross", (0.03, -0.122, -0.07), (0.03, -0.122, -0.38), 0.02, "IVORY", shield)
    else:
        beam("Hoe shaft", (0.035, -0.065, -0.51), (0.035, -0.065, 0.49), 0.022, "WOOD_LIGHT", hand)
        box("Hoe blade", (0.035, -0.12, 0.49), (0.22, 0.17, 0.045), "IRON", hand)
    return parts
