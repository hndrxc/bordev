"""Crown professional infantry: man-at-arms, halberdier, longbowman, crossbowman.

All four share the peasant/spearman human proportions (feet at the origin, head near z 1.1), a
rigid-part rig (`body`, `left_arm`/`right_arm`, `left_leg`/`right_leg`) and the standard unit clips
(idle 4 loop, walk 8 loop, attack 8 once with the strike or release on frame 5, die 8 once).
Pole and crossbow weapons are rigid with both arms; the longbow follows the left hand and the
drawing hand is aimed at the string each frame.
"""
import math
import bpy
from mathutils import Euler, Vector
from lib import anim
from lib.model import root, box, ico, cylinder, cone, beam, mesh



# --- modelling helpers -------------------------------------------------------------------------

def _plate(name, outline, axis, at, thickness, mat, parent):
    """Flat prism. `outline` is (a, z) in the plane normal to `axis`: 'x' -> (y, z), 'y' -> (x, z)."""
    n = len(outline)
    h = thickness / 2

    def point(a, z, side):
        return (at + side, a, z) if axis == "x" else (a, at + side, z)
    verts = [point(a, z, -h) for a, z in outline] + [point(a, z, h) for a, z in outline]
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return mesh(name, verts, faces, mat, parent)


def _blade(name, base, tip, width, x, mat, parent, thickness=0.022):
    """Pointed blade lying in the plane x = const; `base` and `tip` are (y, z)."""
    (by, bz), (ty, tz) = base, tip
    dy, dz = ty - by, tz - bz
    length = math.hypot(dy, dz)
    py, pz = -dz / length * width / 2, dy / length * width / 2
    sy, sz = by + dy * 0.8, bz + dz * 0.8
    outline = [(by + py, bz + pz), (by - py, bz - pz), (sy - py * 0.8, sz - pz * 0.8),
               (ty, tz), (sy + py * 0.8, sz + pz * 0.8)]
    return _plate(name, outline, "x", x, thickness, mat, parent)


def _figure(title, kind):
    parent = root(title)
    parent.rotation_euler.z = math.pi / 4
    body = root("Body motion", parent=parent)
    return {"root": parent, "body": body, "kind": kind}


def _head(body, face=True):
    cylinder("Neck", (0, 0, 0.91), 0.065, 0.10, "SKIN", body)
    if face:
        ico("Head", (0, -0.018, 1.035), (0.135, 0.115, 0.17), "SKIN", body, 2)
        ico("Nose", (0, -0.13, 1.035), (0.036, 0.047, 0.038), "SKIN", body)
        for x in (-0.058, 0.058):
            ico("Eye", (x, -0.119, 1.08), (0.012, 0.012, 0.012), "DARK", body)


def _legs(parts, upper="CLOTH", boot="LEATHER", width=0.115):
    for side, sign in (("left", -1), ("right", 1)):
        leg = root(side + " leg", (sign * 0.09, 0, 0.51), parts["body"])
        box("Leg", (0, 0, -0.16), (width, 0.135, 0.29), upper, leg)
        box("Boot", (0, -0.045, -0.41), (0.135, 0.21, 0.15), boot, leg)
        parts[side + "_leg"] = leg


def _arm(parts, side, hand=None, elbow=None, sleeve="TEAM", forearm="SKIN", glove="SKIN", bracer=None):
    """Two-segment rigid arm; `hand`/`elbow` are offsets from the shoulder pivot."""
    sign = -1 if side == "left" else 1
    pivot = root(side + " shoulder", (sign * 0.205, 0, 0.82), parts["body"])
    hand = Vector(hand if hand is not None else (sign * 0.025, -0.055, -0.33))
    elbow = Vector(elbow if elbow is not None else (sign * 0.025, 0, -0.17))
    ico("Shoulder", (0, 0, -0.02), (0.09, 0.095, 0.095), sleeve, pivot)
    beam("Upper arm", (0, 0, -0.02), elbow, 0.058, sleeve, pivot)
    beam("Forearm", elbow, hand, 0.047, forearm, pivot)
    if bracer:
        beam("Bracer", elbow.lerp(hand, 0.3), elbow.lerp(hand, 0.9), 0.053, bracer, pivot)
    ico("Hand", hand, (0.055, 0.055, 0.065), glove, pivot)
    parts[side + "_arm"] = pivot
    parts[side + "_hand"] = root(side + " grip", hand, pivot)
    return pivot


def _segment(obj, a, b):
    """Stretch a unit-length cylinder between two parent-space points."""
    a, b = Vector(a), Vector(b)
    obj.location = (a + b) / 2
    obj.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    obj.scale = (1, 1, (b - a).length)


# --- builders ----------------------------------------------------------------------------------

def man_at_arms():
    p = _figure("Crown man-at-arms", "man_at_arms")
    body = p["body"]
    box("Belt", (0, 0, 0.53), (0.34, 0.23, 0.08), "LEATHER", body)
    box("Belt buckle", (0, -0.122, 0.53), (0.06, 0.02, 0.06), "GOLD", body)
    cone("Plate cuirass", (0, 0, 0.72), 0.26, 0.30, "STEEL", body, 0.20, 8)
    box("Cuirass ridge", (0, -0.235, 0.78), (0.04, 0.035, 0.20), "IRON", body)
    cone("Mail skirt", (0, 0, 0.45), 0.275, 0.16, "IRON", body, 0.27, 8)
    for y in (-1, 1):
        box("Team tabard", (0, y * 0.26, 0.60), (0.22, 0.03, 0.18), "TEAM", body)
        box("Team tabard skirt", (0, y * 0.29, 0.38), (0.22, 0.03, 0.26), "TEAM", body)
    cylinder("Mail gorget", (0, 0, 0.90), 0.14, 0.07, "IRON", body)
    _head(body, face=False)
    cylinder("Great helm", (0, 0, 1.05), 0.145, 0.26, "STEEL", body, 10)
    cone("Helm crown", (0, 0, 1.23), 0.145, 0.10, "STEEL", body, 0.06, 10)
    box("Visor slit", (0, -0.146, 1.07), (0.17, 0.02, 0.03), "DARK", body)
    box("Visor breaths", (0, -0.15, 0.99), (0.035, 0.02, 0.14), "IRON", body)
    box("Team plume", (0, 0.0, 1.30), (0.05, 0.26, 0.10), "TEAM", body)
    box("Team plume tail", (0, 0.15, 1.23), (0.045, 0.09, 0.17), "TEAM", body)
    _legs(p, upper="IRON", boot="STEEL")
    for side in ("left", "right"):
        ico("Knee cop", (0, -0.075, -0.27), (0.07, 0.05, 0.06), "STEEL", p[side + "_leg"])
    for side, sign in (("left", -1), ("right", 1)):
        arm = _arm(p, side, forearm="STEEL", glove="STEEL")
        ico("Pauldron", (sign * 0.03, 0, 0.03), (0.125, 0.12, 0.085), "STEEL", arm, 1)
        ico("Pauldron lame", (sign * 0.03, 0, -0.03), (0.11, 0.105, 0.05), "IRON", arm, 1)
    sword = p["right_arm"]
    ico("Sword pommel", (0.025, -0.05, -0.27), (0.03, 0.03, 0.03), "GOLD", sword)
    beam("Sword grip", (0.025, -0.06, -0.30), (0.025, -0.075, -0.42), 0.02, "LEATHER", sword)
    box("Sword crossguard", (0.025, -0.078, -0.44), (0.17, 0.035, 0.032), "IRON", sword)
    _blade("Sword blade", (-0.08, -0.46), (-0.19, -0.92), 0.075, 0.025, "STEEL", sword)
    shield = p["left_arm"]
    heater = [(-0.14, 0.0), (0.16, 0.0), (0.16, -0.26), (0.01, -0.62), (-0.14, -0.26)]
    _plate("Team heater shield", heater, "y", -0.125, 0.035, "TEAM", shield)
    _plate("Shield chief", [(-0.14, 0.0), (0.16, 0.0), (0.16, -0.08), (-0.14, -0.08)],
           "y", -0.148, 0.012, "IVORY", shield)
    for a, b in zip(heater, heater[1:] + heater[:1]):
        beam("Shield rim", (a[0], -0.15, a[1]), (b[0], -0.15, b[1]), 0.013, "IRON", shield)
    ico("Shield boss", (0.01, -0.158, -0.24), (0.05, 0.03, 0.05), "STEEL", shield)
    return p


def halberdier():
    p = _figure("Crown halberdier", "halberdier")
    body = p["body"]
    box("Belt", (0, 0, 0.53), (0.30, 0.20, 0.075), "LEATHER", body)
    cone("Team tunic", (0, 0, 0.69), 0.22, 0.32, "TEAM", body, 0.17, 6)
    box("Tunic collar", (0, -0.115, 0.82), (0.15, 0.025, 0.06), "IVORY", body)
    for z in (0.78, 0.65):
        box("Brigandine plate", (0, -0.195, z), (0.23, 0.03, 0.10), "IRON", body)
    cylinder("Steel gorget", (0, 0, 0.90), 0.12, 0.06, "STEEL", body)
    _head(body)
    ico("Beard", (0, -0.095, 0.965), (0.095, 0.06, 0.075), "HAIR", body)
    cylinder("Kettle hat brim", (0, 0, 1.12), 0.25, 0.028, "IRON", body, 10)
    cone("Kettle hat crown", (0, 0, 1.19), 0.15, 0.13, "STEEL", body, 0.07, 10)
    _legs(p)
    _arm(p, "right", hand=(-0.105, -0.20, -0.22), elbow=(-0.03, 0.04, -0.17), glove="LEATHER")
    _arm(p, "left", hand=(0.305, -0.20, 0.11), elbow=(0.12, -0.20, -0.10), glove="LEATHER")
    weapon = root("Halberd", (0, 0, 0.82), body)
    p["weapon"] = weapon
    x, y0 = 0.10, -0.20
    beam("Halberd shaft", (x, y0, -0.82), (x, y0, 0.62), 0.02, "WOOD_LIGHT", weapon)
    beam("Halberd grip wrap", (x, y0, -0.32), (x, y0, 0.18), 0.025, "LEATHER", weapon)
    beam("Halberd langets", (x, y0, 0.30), (x, y0, 0.62), 0.027, "IRON", weapon)
    cone("Halberd butt spike", (x, y0, -0.84), 0.022, 0.07, "IRON", weapon, 0.0, 6).rotation_euler.x = math.pi
    cone("Halberd spike", (x, y0, 0.74), 0.035, 0.24, "STEEL", weapon, 0.0, 4)
    _plate("Halberd axe blade", [(y0, 0.27), (y0 - 0.20, 0.23), (y0 - 0.28, 0.40), (y0 - 0.19, 0.57), (y0, 0.61)],
           "x", x, 0.025, "STEEL", weapon)
    _plate("Halberd fluke", [(y0, 0.30), (y0 + 0.19, 0.38), (y0, 0.45)], "x", x, 0.025, "IRON", weapon)
    _plate("Team pennon", [(y0, 0.24), (y0 + 0.27, 0.21), (y0 + 0.20, 0.13), (y0 + 0.27, 0.05), (y0, 0.08)],
           "x", x, 0.012, "TEAM", weapon)
    return p


def longbowman():
    p = _figure("Crown longbowman", "longbowman")
    body = p["body"]
    box("Belt", (0, 0, 0.53), (0.28, 0.19, 0.07), "LEATHER", body)
    cone("Team tunic", (0, 0, 0.69), 0.215, 0.34, "TEAM", body, 0.165, 6)
    box("Tunic collar", (0, -0.115, 0.83), (0.15, 0.025, 0.06), "IVORY", body)
    beam("Quiver strap", (-0.14, -0.13, 0.87), (0.16, -0.12, 0.56), 0.02, "LEATHER", body)
    _head(body)
    ico("Hood cap", (0, 0.01, 1.125), (0.155, 0.145, 0.115), "LEAF", body, 2)
    cylinder("Hood band", (0, -0.005, 1.075), 0.152, 0.03, "LEATHER", body, 10)
    cone("Hood tail", (0, 0.15, 1.11), 0.085, 0.24, "LEAF", body, 0.0, 6).rotation_euler.x = -0.8
    beam("Cap feather", (0.10, 0.0, 1.17), (0.20, 0.08, 1.33), 0.014, "IVORY", body)
    cylinder("Quiver", (0.12, 0.20, 0.76), 0.058, 0.42, "LEATHER", body, 8)
    for dx, dz in ((-0.025, 0.0), (0.02, 0.04), (0.0, -0.03)):
        beam("Quiver arrow", (0.12 + dx, 0.20, 0.95), (0.12 + dx * 2, 0.215, 1.12 + dz), 0.01, "WOOD_LIGHT", body)
        ico("Quiver fletching", (0.12 + dx * 2, 0.215, 1.12 + dz), (0.028, 0.028, 0.04), "IVORY", body)
    box("Hip dagger", (-0.17, 0.04, 0.45), (0.035, 0.035, 0.22), "STEEL", body)
    _legs(p)
    for side, sign in (("left", -1), ("right", 1)):
        _arm(p, side, hand=(sign * 0.03, -0.07, -0.37), elbow=(sign * 0.03, 0.0, -0.19),
             bracer="LEATHER", glove="LEATHER")
    bow = root("Longbow", (-0.23, -0.22, 0.52), body)
    p["bow"] = bow
    box("Bow grip", (0, 0, 0), (0.05, 0.07, 0.17), "LEATHER", bow)
    upper = [(0.0, 0.0), (0.2, 0.015), (0.38, 0.07), (0.55, 0.17)]
    for sign in (1, -1):
        for (z1, y1), (z2, y2) in zip(upper, upper[1:]):
            beam("Bow limb", (0, y1, sign * z1), (0, y2, sign * z2), 0.022, "WOOD_LIGHT", bow)
        ico("Bow nock", (0, 0.17, sign * 0.55), (0.026, 0.026, 0.026), "IVORY", bow)
    p["string_rest"] = beam("Bow string", (0, 0.17, 0.55), (0, 0.17, -0.55), 0.01, "IVORY", bow)
    for key, label in (("string_up", "Drawn string upper"), ("string_dn", "Drawn string lower")):
        p[key] = cylinder(label, (0, 0, 0), 0.01, 1.0, "IVORY", bow, 6)
        p[key].hide_render = True
    arrow = root("Nocked arrow", (0, 0.17, 0), bow)
    p["arrow"] = arrow
    box("Arrow shaft", (0, -0.25, 0), (0.018, 0.50, 0.018), "WOOD_LIGHT", arrow)
    cone("Arrow head", (0, -0.535, 0), 0.03, 0.07, "STEEL", arrow, 0.0, 4).rotation_euler.x = math.pi / 2
    box("Arrow fletching", (0, -0.04, 0), (0.07, 0.08, 0.004), "IVORY", arrow)
    box("Arrow fletching", (0, -0.04, 0), (0.004, 0.08, 0.07), "IVORY", arrow)
    anim.visibility(arrow, False)
    return p


def crossbowman():
    p = _figure("Crown crossbowman", "crossbowman")
    body = p["body"]
    box("Belt", (0, 0, 0.53), (0.30, 0.20, 0.075), "LEATHER", body)
    cone("Team gambeson", (0, 0, 0.69), 0.23, 0.34, "TEAM", body, 0.175, 6)
    box("Tunic collar", (0, -0.12, 0.84), (0.15, 0.025, 0.06), "IVORY", body)
    box("Breast harness", (0, -0.185, 0.76), (0.20, 0.03, 0.13), "IRON", body)
    beam("Harness strap", (-0.13, -0.19, 0.84), (0.12, -0.19, 0.60), 0.018, "LEATHER", body)
    _head(body)
    ico("Sallet dome", (0, 0.01, 1.10), (0.155, 0.15, 0.135), "IRON", body, 2)
    box("Sallet visor", (0, -0.135, 1.075), (0.17, 0.03, 0.065), "STEEL", body)
    box("Sallet tail", (0, 0.17, 1.04), (0.17, 0.12, 0.045), "IRON", body)
    box("Sallet comb", (0, 0.0, 1.225), (0.03, 0.22, 0.04), "STEEL", body)
    pavise = [(-0.19, 0.30), (0.19, 0.30), (0.22, 1.00), (0.0, 1.12), (-0.22, 1.00)]
    _plate("Pavise", pavise, "y", 0.24, 0.03, "WOOD_LIGHT", body)
    _plate("Pavise team stripe", [(-0.05, 0.31), (0.05, 0.31), (0.05, 1.02), (-0.05, 1.02)],
           "y", 0.262, 0.012, "TEAM", body)
    for a, b in zip(pavise, pavise[1:] + pavise[:1]):
        beam("Pavise rim", (a[0], 0.262, a[1]), (b[0], 0.262, b[1]), 0.013, "IRON", body)
    box("Bolt case", (-0.20, 0.0, 0.40), (0.075, 0.11, 0.18), "LEATHER", body)
    for dx in (-0.02, 0.02):
        beam("Case bolt", (-0.20 + dx, 0.0, 0.48), (-0.20 + dx, 0.0, 0.60), 0.011, "WOOD_LIGHT", body)
        cone("Case bolt head", (-0.20 + dx, 0.0, 0.62), 0.02, 0.05, "STEEL", body, 0.0, 4)
    _legs(p)
    _arm(p, "right", hand=(-0.205, -0.26, -0.12), elbow=(-0.06, 0.06, -0.24), glove="LEATHER")
    _arm(p, "left", hand=(0.205, -0.44, -0.11), elbow=(0.10, -0.20, -0.20), glove="LEATHER")
    weapon = root("Crossbow", (0, 0, 0.82), body)
    p["weapon"] = weapon
    box("Crossbow stock", (0, -0.44, -0.05), (0.055, 0.52, 0.07), "WOOD_LIGHT", weapon)
    box("Crossbow butt plate", (0, -0.175, -0.05), (0.07, 0.03, 0.09), "IRON", weapon)
    box("Crossbow lock", (0, -0.30, -0.04), (0.075, 0.08, 0.06), "IRON", weapon)
    box("Crossbow grip", (0, -0.27, -0.12), (0.04, 0.05, 0.12), "LEATHER", weapon)
    box("Crossbow fore grip", (0, -0.44, -0.11), (0.045, 0.06, 0.08), "LEATHER", weapon)
    prod = [(-0.29, -0.55), (-0.16, -0.65), (0.0, -0.69), (0.16, -0.65), (0.29, -0.55)]
    for (x1, y1), (x2, y2) in zip(prod, prod[1:]):
        beam("Steel prod", (x1, y1, -0.045), (x2, y2, -0.045), 0.024, "STEEL", weapon)
    box("Crossbow stirrup", (0, -0.72, -0.045), (0.10, 0.03, 0.03), "IRON", weapon)
    cocked = root("Cocked string", parent=weapon)
    for sign in (-1, 1):
        beam("Cocked string", (sign * 0.29, -0.55, -0.03), (0, -0.32, -0.025), 0.01, "IVORY", cocked)
    slack = root("Slack string", parent=weapon)
    beam("Slack string", (-0.29, -0.55, -0.03), (0.29, -0.55, -0.03), 0.01, "IVORY", slack)
    bolt = root("Loaded bolt", parent=weapon)
    box("Bolt shaft", (0, -0.51, 0.0), (0.022, 0.38, 0.022), "WOOD_LIGHT", bolt)
    cone("Bolt head", (0, -0.72, 0.0), 0.03, 0.07, "STEEL", bolt, 0.0, 4).rotation_euler.x = math.pi / 2
    box("Bolt fletching", (0, -0.34, 0.0), (0.05, 0.05, 0.004), "IVORY", bolt)
    p.update(string_cocked=cocked, string_slack=slack, bolt=bolt)
    anim.visibility(slack, False)
    return p


# --- posing helpers ----------------------------------------------------------------------------

def _smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def _osc(obj, frame, count, amount, base=0.0, phase=0.0, axis=0):
    obj.rotation_euler[axis] = base + amount * math.sin(2 * math.pi * frame / count + phase)


def _breathe(p, frame, count):
    anim.bob(p["body"], frame, count, 0.012)


def _gait(p, frame, count, lean=0.07):
    anim.bob(p["body"], frame * 2, count, 0.025)
    _osc(p["left_leg"], frame, count, 0.6)
    _osc(p["right_leg"], frame, count, 0.6, phase=math.pi)
    anim.lean(p["body"], lean)


def _step(p, frame, forward):
    """Lunge: `forward` is the left leg's swing, the right leg counters it."""
    p["left_leg"].rotation_euler.x = forward[frame]
    p["right_leg"].rotation_euler.x = -forward[frame] * 0.7


def _topple(body, t, direction, dip=0.0, twist=0.0, axis=0):
    """Fall about the ground origin; direction -1 backward / +1 forward on axis 0, +1 to the right on axis 1."""
    e = _smooth(t)
    body.rotation_euler[axis] = direction * 1.52 * e
    body.rotation_euler[2] = twist * e
    body.location.z = 0.13 * e - dip * math.sin(math.pi * t)


def _hold(p, angle):
    """Rigid two-handed weapon: arms and weapon share the shoulder-line axis."""
    for key in ("weapon", "left_arm", "right_arm"):
        p[key].rotation_euler.x = angle


def _reach(pivot, hand, target, weight=1.0, relaxed=0.0):
    """Swing a rigid arm so its grip points at a world point; the grip stays on its fixed-length sphere."""
    bpy.context.view_layer.update()
    wanted = pivot.parent.matrix_world.inverted() @ target - pivot.location
    aimed = hand.location.rotation_difference(wanted)
    rest = Euler((relaxed, 0, 0)).to_quaternion()
    pivot.rotation_euler = rest.slerp(aimed, weight).to_euler()
    bpy.context.view_layer.update()


def _bow_to_hand(p, rotation):
    bpy.context.view_layer.update()
    bow = p["bow"]
    bow.location = p["body"].matrix_world.inverted() @ p["left_hand"].matrix_world.translation
    bow.rotation_euler = rotation
    bpy.context.view_layer.update()


# --- clips -------------------------------------------------------------------------------------

def _man_at_arms_pose(p, name, frame, count):
    body, left, right = p["body"], p["left_arm"], p["right_arm"]
    if name == "idle":
        _breathe(p, frame, count)
        _osc(right, frame, count, 0.04, base=-0.5)
        _osc(left, frame, count, 0.03, base=-0.3, phase=math.pi)
    elif name == "walk":
        _gait(p, frame, count, 0.06)
        _osc(right, frame, count, 0.2, base=-0.5, phase=math.pi)
        _osc(left, frame, count, 0.15, base=-0.3)
    elif name == "attack":
        # Overhead cut: raise to frame 4, impact on frame 5, recover.
        right.rotation_euler.x = (-0.5, -1.2, -2.0, -2.65, -2.8, -1.1, -0.9, -0.65)[frame]
        left.rotation_euler.x = (-0.3, -0.35, -0.45, -0.5, -0.5, -0.95, -0.7, -0.45)[frame]
        anim.lean(body, (0.0, -0.04, -0.1, -0.16, -0.18, 0.26, 0.15, 0.06)[frame])
        body.location.z = (0, 0, 0, 0.01, 0.01, -0.04, -0.02, 0)[frame]
        _step(p, frame, (0, 0, 0.05, 0.1, 0.1, -0.35, -0.2, -0.05))
    else:
        t = frame / (count - 1)
        e = _smooth(t)
        k = math.sin(math.pi * t)
        _topple(body, t, -1, dip=0.10, twist=0.35)
        p["left_leg"].rotation_euler.x = -0.5 * k
        p["right_leg"].rotation_euler.x = 0.45 * k
        right.rotation_euler.x = -0.5 - 1.0 * e
        right.rotation_euler.y = -0.8 * e
        left.rotation_euler.x = -0.3 - 0.8 * e
        left.rotation_euler.y = 0.8 * e


def _halberdier_pose(p, name, frame, count):
    body = p["body"]
    if name == "idle":
        _breathe(p, frame, count)
        _hold(p, -0.05 + 0.025 * math.sin(2 * math.pi * frame / count))
    elif name == "walk":
        _gait(p, frame, count, 0.05)
        _hold(p, -0.12 + 0.05 * math.sin(4 * math.pi * frame / count))
    elif name == "attack":
        # Chop: pole top swings back to frame 4, then forward and down on frame 5.
        _hold(p, (-0.05, -0.45, -0.8, -1.0, -1.1, 1.15, 0.7, 0.2)[frame])
        anim.lean(body, (0.0, -0.04, -0.08, -0.12, -0.14, 0.28, 0.18, 0.06)[frame])
        body.location.z = (0, 0, 0, 0.01, 0.01, -0.04, -0.02, 0)[frame]
        _step(p, frame, (0, 0, 0.05, 0.1, 0.1, -0.35, -0.2, -0.05))
    else:
        t = frame / (count - 1)
        e = _smooth(t)
        k = math.sin(math.pi * t)
        _topple(body, t, 1, dip=0.08, twist=-0.3, axis=1)
        _hold(p, -0.05 + 1.0 * e)
        p["left_leg"].rotation_euler.x = -0.4 * k
        p["right_leg"].rotation_euler.x = 0.35 * k


_CARRY = Euler((0.75, 0.0, 0.0))
_AIM = Euler((0.0, 0.0, 0.0))
_BOW_GRIP = Vector((-0.05, -0.42, 0.93))
_RAISE = (0.0, 0.5, 1.0, 1.0, 1.0, 1.0, 0.7, 0.25)
_NOCK_Y = (0.17, 0.17, 0.24, 0.31, 0.39, 0.39, 0.25, 0.20)
_HAND_W = (0.0, 0.7, 1.0, 1.0, 1.0, 1.0, 0.7, 0.3)
_STRING_DRAWN = (2, 3, 4)
_ARROW_SHOWN = (1, 2, 3, 4)


def _longbowman_pose(p, name, frame, count):
    body, bow, left, right = p["body"], p["bow"], p["left_arm"], p["right_arm"]
    rotation = _CARRY
    if name == "idle":
        _breathe(p, frame, count)
        _osc(left, frame, count, 0.03, base=-0.45)
        _osc(right, frame, count, 0.05)
    elif name == "walk":
        _gait(p, frame, count, 0.06)
        _osc(left, frame, count, 0.08, base=-0.45, phase=math.pi)
        _osc(right, frame, count, 0.4)
    elif name == "attack":
        raise_ = _RAISE[frame]
        anim.lean(body, (0.0, -0.02, -0.04, -0.05, -0.05, -0.08, -0.03, 0.0)[frame])
        _step(p, frame, (0, 0, 0.05, 0.08, 0.08, 0.1, 0.05, 0))
        left.rotation_euler.x = -0.45
        if raise_ > 0:
            bpy.context.view_layer.update()
            _reach(left, p["left_hand"], body.matrix_world @ _BOW_GRIP, raise_, relaxed=-0.45)
        rotation = Euler(tuple(c * (1 - raise_) + a * raise_ for c, a in zip(_CARRY, _AIM)))
        _bow_to_hand(p, rotation)
        if frame > 0:
            target = bow.matrix_world @ Vector((0, _NOCK_Y[frame], 0))
            _reach(right, p["right_hand"], target, _HAND_W[frame])
        if frame in _ARROW_SHOWN:
            anim.visibility(p["arrow"], True)
            p["arrow"].location.y = 0.17
        if frame in _STRING_DRAWN:
            nock = bow.matrix_world.inverted() @ p["right_hand"].matrix_world.translation
            p["arrow"].location.y = nock.y
            p["string_rest"].hide_render = True
            for key, z in (("string_up", 0.55), ("string_dn", -0.55)):
                p[key].hide_render = False
                _segment(p[key], (0, 0.17, z), nock)
        return
    else:
        t = frame / (count - 1)
        e = _smooth(t)
        k = math.sin(math.pi * t)
        _topple(body, t, -1, dip=0.06, twist=-0.25)
        p["left_leg"].rotation_euler.x = -0.4 * k
        p["right_leg"].rotation_euler.x = 0.5 * k
        left.rotation_euler.x = -0.45 - 1.4 * e
        left.rotation_euler.y = 0.7 * e
        right.rotation_euler.x = -2.0 * e
        right.rotation_euler.y = -0.9 * e
        rotation = Euler((0.75 + 2.0 * e, 0.0, 0.8 * e))
    _bow_to_hand(p, rotation)


_XBOW_ANGLE = (0.45, 0.2, -0.08, -0.2, -0.2, -0.4, -0.05, 0.3)
_XBOW_LEAN = (0.0, 0.0, -0.02, -0.03, -0.03, -0.1, -0.04, 0.0)
_XBOW_RECOIL = (0, 0, 0, 0, 0, 0.05, 0.02, 0)
_XBOW_LOADED = (True, True, True, True, True, False, False, True)


def _crossbowman_pose(p, name, frame, count):
    body, weapon = p["body"], p["weapon"]
    if name == "idle":
        _breathe(p, frame, count)
        _hold(p, 0.45 + 0.02 * math.sin(2 * math.pi * frame / count))
    elif name == "walk":
        _gait(p, frame, count, 0.05)
        _hold(p, 0.45 + 0.04 * math.sin(4 * math.pi * frame / count))
    elif name == "attack":
        # Raise, aim, release on frame 5 (string slack, bolt gone), recock on frame 7.
        _hold(p, _XBOW_ANGLE[frame])
        anim.lean(body, _XBOW_LEAN[frame])
        weapon.location.y += _XBOW_RECOIL[frame]
        _step(p, frame, (0, 0, 0.04, 0.06, 0.06, 0.1, 0.05, 0))
        loaded = _XBOW_LOADED[frame]
        anim.visibility(p["string_cocked"], loaded)
        anim.visibility(p["bolt"], loaded)
        anim.visibility(p["string_slack"], not loaded)
    else:
        t = frame / (count - 1)
        e = _smooth(t)
        k = math.sin(math.pi * t)
        _topple(body, t, 1, dip=0.2, twist=0.25)
        _hold(p, 0.45 + 1.0 * e)
        p["left_leg"].rotation_euler.x = -0.4 * k
        p["right_leg"].rotation_euler.x = 0.7 * k


_POSES = {"man_at_arms": _man_at_arms_pose, "halberdier": _halberdier_pose,
          "longbowman": _longbowman_pose, "crossbowman": _crossbowman_pose}


def clips(parts):
    reset = anim.resetter(parts["root"])
    pose = _POSES[parts["kind"]]

    def clip(name):
        descriptor = anim.UNIT_ANIMS[name]
        count = descriptor["frames"]

        def apply(frame):
            reset()
            pose(parts, name, frame, count)
        apply.descriptor = descriptor
        apply.frames = count
        apply.loop = descriptor["loop"]
        return apply
    return {name: clip(name) for name in anim.UNIT_ANIMS}
