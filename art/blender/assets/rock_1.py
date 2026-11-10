from lib import nature


def build():
    return nature.rock(1)


def anims():
    return {"idle": lambda frame: None}
