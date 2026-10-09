"""Deterministic rigid-part animation clips; a clip applies an integer frame."""
import math

UNIT_ANIMS = {"idle": {"frames": 4, "loop": True}, "walk": {"frames": 8, "loop": True},
              "attack": {"frames": 8, "loop": False}, "die": {"frames": 8, "loop": False}}
WORKER_ANIMS = {**UNIT_ANIMS, "work": {"frames": 8, "loop": True}}
CART_ANIMS = {"idle": {"frames": 1, "loop": True}, "walk": {"frames": 8, "loop": True},
              "load": {"frames": 4, "loop": False}}
BUILDING_ANIMS = {"construct": {"frames": 3, "loop": False}, "idle": {"frames": 1, "loop": True},
                  "damaged": {"frames": 1, "loop": False}, "rubble": {"frames": 1, "loop": False}}



def bob(obj, frame, count, amount=0.025, base=0.0):
    obj.location.z = base + amount * math.sin(2 * math.pi * frame / count)


def swing(obj, frame, count, amount=0.5, phase=0.0, axis=0, base=0.0):
    obj.rotation_euler[axis] = base + amount * math.sin(2 * math.pi * frame / count + phase)


def lean(obj, amount, axis=0):
    obj.rotation_euler[axis] = amount


def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def breathe(body, frame, count, amount=0.012):
    bob(body, frame, count, amount)


def human_gait(parts, frame, count, swing_amount=0.6, bob_amount=0.025, lean_angle=0.07):
    bob(parts["body"], frame * 2, count, bob_amount)
    swing(parts["left_leg"], frame, count, swing_amount, 0.0)
    swing(parts["right_leg"], frame, count, swing_amount, math.pi)
    lean(parts["body"], lean_angle)


def fall(obj, frame, count):
    progress = frame / (count - 1)
    obj.rotation_euler.x = math.pi * 0.48 * progress
    obj.location.z = -0.07 * progress


def objects_under(parent):
    return [parent, *parent.children_recursive]


def visibility(parent, visible):
    for obj in objects_under(parent):
        obj.hide_render = not visible


def resetter(parent):
    rest = [(obj, obj.location.copy(), obj.rotation_euler.copy(), obj.scale.copy(), obj.hide_render)
            for obj in objects_under(parent)]

    def reset():
        for obj, location, rotation, scale, hidden in rest:
            obj.location = location
            obj.rotation_euler = rotation
            obj.scale = scale
            obj.hide_render = hidden
    return reset


def clip_set(root_obj, descriptors, pose):
    """Build a dictionary of clips for each animation in `descriptors`.

    `pose(name, frame, count)` is called each frame after resetting `root_obj`
    to rest pose. Returns a dict mapping animation name to an apply callable
    decorated with `.descriptor`, `.frames`, and `.loop`.
    """
    reset = resetter(root_obj)

    def make_clip(name, descriptor):
        count = descriptor["frames"]
        loop = descriptor["loop"]

        def apply(frame, name=name, count=count):
            reset()
            pose(name, frame, count)

        apply.descriptor = descriptor
        apply.frames = count
        apply.loop = loop
        return apply

    return {name: make_clip(name, desc) for name, desc in descriptors.items()}


def character_clips(parts, worker=False):
    descriptors = WORKER_ANIMS if worker else UNIT_ANIMS
    body = parts["body"]

    def pose(name, frame, count):
        if name == "idle":
            breathe(body, frame, count)
            swing(parts["right_arm"], frame, count, 0.055)
        elif name == "walk":
            human_gait(parts, frame, count, lean_angle=0.08)
            for side, phase in (("left", 0.0), ("right", math.pi)):
                swing(parts[side + "_arm"], frame, count, 0.5, phase + math.pi)
        elif name in ("attack", "work"):
            # Strike lands at frame five of eight; work repeats the same full arc.
            strike = (0.05, -0.35, -0.85, -1.45, -1.75, 0.95, 0.65, 0.15)[frame]
            lean(parts["right_arm"], strike)
            lean(parts["left_arm"], strike * 0.55)
            lean(body, max(0, strike) * 0.23)
        else:
            fall(body, frame, count)
            lean(parts["left_arm"], frame / (count - 1) * -1.1, 1)
            lean(parts["right_arm"], frame / (count - 1) * 1.1, 1)

    return clip_set(parts["root"], descriptors, pose)


def building_clips(parts):
    levels = parts["levels"]

    def pose(name, frame, count):
        visibility(parts["scaffold"], name == "construct")
        visibility(parts["rubble"], name == "rubble")
        visibility(parts["damage"], name == "damaged")
        for index, level in enumerate(levels):
            visible = name != "rubble"
            if name == "construct":
                visible = index <= frame
            if name == "damaged" and index == len(levels) - 1:
                level.rotation_euler.y = 0.055
                level.location.z -= 0.045
            visibility(level, visible)

    return clip_set(parts["root"], BUILDING_ANIMS, pose)
