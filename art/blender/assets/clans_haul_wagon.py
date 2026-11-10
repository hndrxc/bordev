from lib import cart, clans_vehicles

_parts = None


def build():
    global _parts
    _parts = clans_vehicles.haul_wagon()
    return _parts["root"]


def anims():
    return cart.clips(_parts)
