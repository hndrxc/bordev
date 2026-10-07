from lib import crown_infantry

_parts = None


def build():
    global _parts
    _parts = crown_infantry.longbowman()
    return _parts["root"]


def anims():
    return crown_infantry.clips(_parts)
