from lib import anim, clans_buildings

_parts = None

GATE_ANIMS = {
    **anim.BUILDING_ANIMS,
    "open": {"frames": 1, "loop": True},
    "damaged_open": {"frames": 1, "loop": False},
}


def build():
    global _parts
    _parts = clans_buildings.palisade_gate()
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
