from lib import cart

_parts = None


def build():
    global _parts
    _parts = cart.build()
    return _parts["root"]


def anims():
    return cart.clips(_parts)
