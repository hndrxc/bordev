from lib import nature


def build():
    return nature.tree(1)


def anims():
    return {"idle": lambda frame: None}
