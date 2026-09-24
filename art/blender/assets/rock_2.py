from lib import nature


def build():
    return nature.rock(2)


def anims():
    return {"idle": lambda frame: None}
