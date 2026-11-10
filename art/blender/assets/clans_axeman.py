from lib import clans_infantry

_parts = None


def build():
    global _parts
    _parts = clans_infantry.axeman()
    return _parts["root"]


def anims():
    return clans_infantry.clips(_parts)
