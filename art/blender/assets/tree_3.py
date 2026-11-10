from lib import nature


def build():
    return nature.tree(3)


def anims():
    return {"idle": lambda frame: None}
