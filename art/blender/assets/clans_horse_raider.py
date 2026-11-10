from lib import clans_mounted

_parts = None


def build():
    global _parts
    _parts = clans_mounted.build("horse_raider")
    return _parts["root"]


def anims():
    return clans_mounted.clips(_parts)
