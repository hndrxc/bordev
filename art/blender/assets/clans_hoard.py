from lib import anim, clans_buildings

_parts = None


def build():
    global _parts
    _parts = clans_buildings.hoard()
    return _parts["root"]


def anims():
    return anim.building_clips(_parts)
