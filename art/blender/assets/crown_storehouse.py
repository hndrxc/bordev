from lib import anim, buildings

_parts = None


def build():
    global _parts
    _parts = buildings.storehouse()
    return _parts["root"]


def anims():
    return anim.building_clips(_parts)
