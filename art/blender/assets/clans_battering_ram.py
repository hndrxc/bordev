from lib import clans_vehicles

_parts = None


def build():
    global _parts
    _parts = clans_vehicles.battering_ram()
    return _parts["root"]


def anims():
    return clans_vehicles.ram_clips(_parts)
