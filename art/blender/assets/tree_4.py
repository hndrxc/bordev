from lib import nature


def build():
    return nature.tree(4)


def anims():
    return {"idle": lambda frame: None}
