"""Crown cavalry: a rigged horse and a seated rider; sergeant and knight differ in coat, armour and weapon."""
import math
from mathutils import Matrix, Vector
from lib import anim, characters
from lib.model import root, box, ico, cylinder, cone, beam, mesh

# Right arm couches the weapon, left arm carries the shield; both rest bent forward over the saddle.
REST = {"left": -0.35, "right": -0.6}
SHOULDER = {"left": (-0.205, 0, 0.29), "right": (0.205, 0, 0.29)}
GRIP = {"left": (-0.025, -0.055, -0.33), "right": (0.025, -0.055, -0.33)}


def _tilt(obj, x=0.0, y=0.0, z=0.0):
    obj.rotation_euler = (x, y, z)
    return obj


def _to_rider(point, side):
    return Vector(SHOULDER[side]) + Matrix.Rotation(REST[side], 3, "X") @ Vector(point)


def _to_arm(point, side):
    return Matrix.Rotation(-REST[side], 3, "X") @ (Vector(point) - Vector(SHOULDER[side]))


def _pointed(name, base, tip, radius, mat, parent, vertices=4):
    base, tip = Vector(base), Vector(tip)
    obj = cone(name, (base + tip) / 2, radius, (tip - base).length, mat, parent, 0, vertices)
    obj.rotation_euler = (tip - base).to_track_quat("Z", "Y").to_euler()
    return obj


def _haft(arm, side, direction, back, front, radius, mat):
    """Shaft through the gripping hand along a rest-pose direction; ends in arm-local space."""
    hand = _to_rider(GRIP[side], side)
    d = Vector(direction).normalized()
    butt = _to_arm(hand - d * back, side)
    tip = _to_arm(hand + d * front, side)
    beam("Haft", butt, tip, radius, mat, arm)
    return hand, (tip - butt).normalized(), tip


def _horse(parts, heavy):
    coat = "HORSE_GREY" if heavy else "HORSE_BAY"
    horse = parts["horse"]
    ico("Horse barrel", (0, 0, 0.68), (0.205, 0.46, 0.235), coat, horse, 2)
    ico("Horse chest", (0, -0.29, 0.73), (0.20, 0.22, 0.25), coat, horse)
    ico("Horse haunch", (0, 0.30, 0.72), (0.21, 0.23, 0.245), coat, horse)
    beam("Horse neck", (0, -0.36, 0.80), (0, -0.57, 1.08), 0.105, coat, horse)
    for index in range(5):
        t = index / 4
        piece = box("Crinet plate" if heavy else "Horse mane", (0, -0.275 - 0.21 * t, 0.863 + 0.28 * t),
                    (0.05, 0.075, 0.125), "STEEL" if heavy else "HAIR", horse)
        _tilt(piece, 0.65)
    head = root("Horse head pivot", (0, -0.57, 1.08), horse)
    _tilt(ico("Horse head", (0, -0.16, -0.086), (0.085, 0.22, 0.09), coat, head, 2), 0.5)
    _tilt(ico("Horse muzzle", (0, -0.35, -0.19), (0.068, 0.10, 0.07), "DARK" if heavy else "IVORY", head), 0.5)
    ico("Forelock", (0, -0.04, 0.075), (0.04, 0.06, 0.05), "HAIR", head)
    for sign in (-1, 1):
        _tilt(cone("Horse ear", (sign * 0.05, 0.0, 0.10), 0.032, 0.12, coat, head, 0, 4), -0.2)
        ico("Horse eye", (sign * 0.084, -0.10, -0.035), (0.02, 0.02, 0.02), "DARK", head)
        beam("Bridle cheek strap", (sign * 0.09, -0.10, 0.03), (sign * 0.078, -0.30, -0.15), 0.012, "LEATHER", head)
    if heavy:
        _tilt(ico("Steel chamfron", (0, -0.246, -0.134), (0.094, 0.14, 0.10), "STEEL", head), 0.5)
        _tilt(cone("Team poll plume", (0, -0.03, 0.14), 0.04, 0.18, "TEAM", head, 0, 5), -0.55)
        ico("Steel peytral", (0, -0.43, 0.70), (0.19, 0.12, 0.19), "STEEL", horse)
    tail = root("Horse tail pivot", (0, 0.50, 0.84), horse)
    beam("Horse tail dock", (0, 0, 0), (0, 0.14, -0.12), 0.04, "HAIR", tail)
    ico("Horse tail tuft", (0, 0.20, -0.28), (0.06, 0.07, 0.22), "HAIR", tail)
    # Saddle cloth and tack: team colour reads from every side of the horse.
    cloth_length, cloth_drop = (0.60, 0.36) if heavy else (0.36, 0.24)
    box("Team saddle cloth", (0, 0.0, 0.905), (0.42, cloth_length + 0.04, 0.035), "TEAM", horse)
    for sign in (-1, 1):
        box("Team flank cloth", (sign * 0.216, 0.0, 0.89 - cloth_drop / 2), (0.03, cloth_length, cloth_drop), "TEAM", horse)
        if heavy:
            box("Gold caparison trim", (sign * 0.226, 0.0, 0.89 - cloth_drop), (0.02, cloth_length + 0.02, 0.03), "GOLD", horse)
    box("Saddle", (0, 0.02, 0.945), (0.26, 0.34, 0.07), "LEATHER", horse)
    box("Saddle pommel", (0, -0.15, 0.985), (0.12, 0.04, 0.07), "LEATHER", horse)
    box("Saddle cantle", (0, 0.19, 0.99), (0.20, 0.04, 0.09), "LEATHER", horse)
    legs, knees = [], []
    for y, front in ((-0.29, True), (0.29, False)):
        for x in (-0.12, 0.12):
            leg = root("Horse leg", (x, y, 0.60), horse)
            if front:
                beam("Horse forearm", (0, 0, 0), (0, -0.02, -0.30), 0.058, coat, leg)
                knee = root("Horse knee", (0, -0.02, -0.30), leg)
                beam("Horse cannon", (0, 0, 0), (0, 0, -0.24), 0.046 if not heavy else 0.042,
                     "IVORY" if not heavy else coat, knee)
                box("Horse hoof", (0, -0.01, -0.26), (0.09, 0.12, 0.075), "DARK", knee)
            else:
                beam("Horse thigh", (0, 0, 0.03), (0, 0.07, -0.27), 0.07, coat, leg)
                knee = root("Horse hock", (0, 0.07, -0.27), leg)
                beam("Horse cannon", (0, 0, 0), (0, -0.03, -0.26), 0.042, coat, knee)
                box("Horse hoof", (0, -0.03, -0.285), (0.09, 0.12, 0.075), "DARK", knee)
            legs.append(leg)
            knees.append(knee)
    parts.update(head=head, tail=tail, legs=legs, knees=knees)


def _rider(parts, heavy):
    rider = root("Rider", (0, 0.02, 0.955), parts["mount"])
    rider.scale = (0.92, 0.92, 0.92)
    torso = root("Rider torso", parent=rider)
    rider_legs = root("Rider legs", parent=rider)
    parts.update(rider=rider, torso=torso)
    characters.belt(torso, z_offset=-0.53)
    characters.tunic(torso, z_offset=-0.53)
    characters.head(torso, z_offset=-0.53, face=not heavy)
    if heavy:
        box("Gold buckle", (0, -0.105, 0.0), (0.07, 0.02, 0.06), "GOLD", torso)
        box("Steel breastplate", (0, -0.165, 0.20), (0.27, 0.07, 0.24), "STEEL", torso)
        box("Team tabard front", (0, -0.205, 0.17), (0.18, 0.02, 0.30), "TEAM", torso)
        box("Steel backplate", (0, 0.15, 0.20), (0.26, 0.06, 0.22), "STEEL", torso)
        box("Team tabard back", (0, 0.185, 0.17), (0.18, 0.02, 0.30), "TEAM", torso)
        cylinder("Steel gorget", (0, 0, 0.36), 0.105, 0.08, "STEEL", torso)
        cylinder("Great helm", (0, 0, 0.55), 0.155, 0.30, "STEEL", torso)
        cone("Helm crown", (0, 0, 0.735), 0.155, 0.07, "STEEL", torso, 0.09, 8)
        box("Visor slit", (0, -0.152, 0.58), (0.19, 0.02, 0.03), "DARK", torso)
        box("Helm band", (0, -0.157, 0.55), (0.035, 0.02, 0.30), "IRON", torso)
        for x in (-0.06, 0.0, 0.06):
            box("Helm breath", (x, -0.152, 0.49), (0.016, 0.02, 0.05), "DARK", torso)
        for y, z in ((0.02, 0.79), (0.12, 0.775), (0.22, 0.74), (0.30, 0.69)):
            ico("Team helm plume", (0, y, z), (0.04, 0.09, 0.07), "TEAM", torso)
        for sign in (-1, 1):
            ico("Steel pauldron", (sign * 0.225, 0, 0.30), (0.11, 0.12, 0.085), "STEEL", torso)
    else:
        cone("Steel helmet", (0, 0, 0.625), 0.15, 0.17, "STEEL", torso, 0.06)
        cylinder("Helmet brim", (0, 0, 0.565), 0.175, 0.038, "IRON", torso)
        box("Nasal guard", (0, -0.151, 0.516), (0.027, 0.025, 0.14), "STEEL", torso)
        ico("Team helmet tuft", (0, 0.0, 0.715), (0.04, 0.04, 0.05), "TEAM", torso)
        cylinder("Team scarf", (0, 0, 0.36), 0.105, 0.06, "TEAM", torso)
        box("Padded breastplate", (0, -0.16, 0.20), (0.25, 0.065, 0.20), "IRON", torso)
        _tilt(box("Team riding cloak", (0, 0.135, 0.12), (0.30, 0.03, 0.42), "TEAM", torso), 0.12)
    for side in ("left", "right"):
        characters.arm(parts, side, z_offset=-0.53, sleeve="STEEL" if heavy else "TEAM",
                       forearm="STEEL" if heavy else "SKIN", glove="IRON" if heavy else "SKIN",
                       rest_x=REST[side], parent=torso)
    characters.rider_legs(rider_legs, heavy=heavy)
    right, left = parts["right_arm"], parts["left_arm"]
    if heavy:
        hand, direction, tip = _haft(right, "right", (0, -0.985, -0.17), 0.5, 1.0, 0.026, "WOOD_LIGHT")
        _pointed("Steel lance head", tip - direction * 0.20, tip + direction * 0.05, 0.045, "STEEL", right, 6)
        _pointed("Vamplate", _to_arm(hand + Vector((0, -0.985, -0.17)).normalized() * 0.10, "right"),
                 _to_arm(hand - Vector((0, -0.985, -0.17)).normalized() * 0.14, "right"), 0.08, "IRON", right, 8)
        _pointed("Team lance pennon", tip - direction * 0.22, tip - direction * 0.65, 0.06, "TEAM", right, 4)
        points = [(0.03 + (x - 0.03) * 1.2, -0.115, -0.20 + (z + 0.20) * 1.25) for x, z in
                  ((-0.09, -0.04), (0.15, -0.04), (0.18, -0.28), (0.03, -0.52), (-0.12, -0.28))]
        mesh("Kite shield", points, [(0, 1, 2, 3, 4)], "TEAM", left)
        beam("Shield cross", (-0.09, -0.127, -0.22), (0.17, -0.127, -0.22), 0.02, "GOLD", left)
        beam("Shield cross", (0.03, -0.127, -0.06), (0.03, -0.127, -0.44), 0.02, "GOLD", left)
        ico("Shield boss", (0.03, -0.135, -0.22), (0.05, 0.03, 0.05), "IRON", left)
    else:
        hand, direction, tip = _haft(right, "right", (0, -0.96, 0.28), 0.45, 0.8, 0.02, "WOOD_LIGHT")
        _pointed("Spear head", tip - direction * 0.22, tip + direction * 0.04, 0.05, "STEEL", right, 4)
        _pointed("Team spear pennon", tip - direction * 0.20, tip - direction * 0.58, 0.055, "TEAM", right, 4)
        _tilt(cylinder("Iron buckler rim", (0.0, -0.107, -0.22), 0.165, 0.03, "IRON", left, 12), math.pi / 2)
        _tilt(cylinder("Team buckler", (0.0, -0.125, -0.22), 0.15, 0.035, "TEAM", left, 12), math.pi / 2)
        ico("Buckler boss", (0.0, -0.148, -0.22), (0.045, 0.03, 0.045), "IVORY", left)
    parts["rider_legs"] = rider_legs


def build(kind):
    if kind not in ("sergeant", "knight"):
        raise ValueError(f"Unknown Crown mounted unit {kind!r}")
    heavy = kind == "knight"
    parent = root("Crown knight" if heavy else "Crown mounted sergeant")
    parent.rotation_euler.z = math.pi / 4
    mount = root("Mount motion", parent=parent)
    horse = root("Horse body", parent=mount)
    parts = {"root": parent, "mount": mount, "horse": horse, "heavy": heavy}
    _horse(parts, heavy)
    _rider(parts, heavy)
    return parts


# Per-frame attack tables; impact is frame index 5 (MELEE_HIT_FRAME=5) for both riders.
ATTACKS = {
    False: {  # sergeant: couched spear lunge with a short surge
        "arm": (0.0, 0.0, -0.10, -0.20, -0.12, 0.30, 0.24, 0.10),
        "push": (0.0, 0.0, 0.04, 0.12, 0.0, -0.40, -0.32, -0.12),
        "lean": (0.0, 0.0, -0.04, -0.10, 0.0, 0.22, 0.18, 0.08),
        "surge": (0.0, 0.0, 0.02, 0.05, 0.0, -0.22, -0.18, -0.08),
        "pitch": (0.0, 0.0, -0.05, -0.16, -0.12, 0.03, 0.02, 0.0),
        "head": (0.0, 0.0, -0.10, -0.25, -0.15, 0.20, 0.15, 0.05),
    },
    True: {  # knight: destrier rears, then crashes forward behind the lance
        "arm": (0.0, 0.0, -0.08, -0.20, -0.12, 0.25, 0.20, 0.08),
        "push": (0.0, 0.0, 0.05, 0.14, 0.04, -0.55, -0.42, -0.15),
        "lean": (0.0, 0.0, -0.06, -0.14, -0.08, 0.28, 0.20, 0.10),
        "surge": (0.0, 0.0, 0.02, 0.06, 0.04, -0.30, -0.24, -0.10),
        "pitch": (0.0, 0.0, -0.08, -0.16, -0.22, -0.02, 0.04, 0.02),
        "head": (0.0, 0.0, -0.12, -0.28, -0.35, 0.22, 0.15, 0.05),
    },
}


def _gait(parts, phase, amount):
    """Trot: diagonal leg pairs swing together; positive rotation moves the foot backward."""
    for index, (leg, knee) in enumerate(zip(parts["legs"], parts["knees"])):
        angle = phase + (math.pi if index in (1, 2) else 0)
        leg.rotation_euler.x = amount * math.sin(angle)
        knee.rotation_euler.x = 1.8 * amount * max(0.0, -math.cos(angle))


def clips(parts):
    heavy = parts["heavy"]

    def pose(name, frame, count):
        mount, horse, rider = parts["mount"], parts["horse"], parts["rider"]
        torso, head, tail = parts["torso"], parts["head"], parts["tail"]
        right, left = parts["right_arm"], parts["left_arm"]
        if name == "idle":
            phase = 2 * math.pi * frame / count
            anim.bob(mount, frame, count, 0.008, 0.008)
            head.rotation_euler.x = 0.08 * math.sin(phase)
            tail.rotation_euler.z = 0.20 * math.sin(phase + 1.0)
            torso.rotation_euler.x = 0.015 * math.sin(phase)
            paw = max(0.0, math.sin(phase - 0.5))
            parts["legs"][0].rotation_euler.x = -0.35 * paw
            parts["knees"][0].rotation_euler.x = 0.7 * paw
        elif name == "walk":
            phase = 2 * math.pi * frame / count
            _gait(parts, phase, 0.42 if heavy else 0.5)
            anim.bob(mount, frame * 2, count, 0.026 if heavy else 0.032, 0.03)
            head.rotation_euler.x = 0.10 * math.sin(phase + 0.6)
            tail.rotation_euler.z = 0.18 * math.sin(phase + 1.2)
            torso.rotation_euler.x = 0.05 + 0.03 * math.sin(2 * phase)
            rider.rotation_euler.y = 0.03 * math.sin(phase)
            right.rotation_euler.x += 0.04 * math.sin(2 * phase)
            left.rotation_euler.x += 0.06 * math.sin(phase + 0.5)
        elif name == "attack":
            table = ATTACKS[heavy]
            pitch = table["pitch"][frame]
            rise = max(0.0, -pitch) / 0.16
            mount.rotation_euler.x = pitch
            mount.location.y = table["surge"][frame]
            mount.location.z = 0.3 * math.sin(abs(pitch)) if pitch < 0 else 0.0
            head.rotation_euler.x = table["head"][frame]
            tail.rotation_euler.x = -0.35 * rise
            for index, (leg, knee) in enumerate(zip(parts["legs"], parts["knees"])):
                if index < 2:
                    leg.rotation_euler.x = -0.55 * rise
                    knee.rotation_euler.x = 1.1 * rise
                else:
                    leg.rotation_euler.x = 0.12 * rise
            right.rotation_euler.x += table["arm"][frame]
            right.location.y += table["push"][frame]
            left.rotation_euler.x += table["arm"][frame] * 0.4
            torso.rotation_euler.x = table["lean"][frame]
        else:
            progress = frame / (count - 1)
            eased = anim.smoothstep(progress)
            horse.rotation_euler.y = 1.48 * eased
            horse.location.z = 0.15 * eased
            for index, (leg, knee) in enumerate(zip(parts["legs"], parts["knees"])):
                flail = 0.6 * math.sin(frame * 1.3 + index * 1.7) * (1 - eased)
                leg.rotation_euler.x = flail + (-0.45 if index < 2 else 0.35) * eased
                knee.rotation_euler.x = 0.5 * eased + 0.25 * (1 - eased) * abs(math.sin(frame + index))
            head.rotation_euler.x = -0.2 * eased
            tail.rotation_euler.x = -0.4 * eased
            # The rider is thrown clear on the side away from the falling horse and lies along Y.
            rider.location.x -= 0.55 * eased
            rider.location.y += 0.08 * eased
            rider.location.z -= 0.77 * eased
            rider.rotation_euler.x = -1.45 * eased
            rider.rotation_euler.z = 0.35 * eased
            right.rotation_euler.x -= 1.3 * eased
            left.rotation_euler.x -= 1.0 * eased

    return anim.clip_set(parts["root"], anim.UNIT_ANIMS, pose)
