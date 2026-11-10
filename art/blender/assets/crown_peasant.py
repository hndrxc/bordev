from lib import anim, characters

_parts = None


def build():
    global _parts
    _parts = characters.build()
    return _parts["root"]


def anims():
    return anim.character_clips(_parts, worker=True)
