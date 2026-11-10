from lib import anim, clans_infantry

_parts = None


def build():
    global _parts
    _parts = clans_infantry.shield_bearer()
    return _parts["root"]


def anims():
    return anim.character_clips(_parts)
