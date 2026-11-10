from lib import crown_mounted

_parts = None


def build():
    global _parts
    _parts = crown_mounted.build("knight")
    return _parts["root"]


def anims():
    return crown_mounted.clips(_parts)
