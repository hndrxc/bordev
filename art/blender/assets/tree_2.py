from lib import nature


def build():
    return nature.tree(2)


def anims():
    return {"idle": lambda frame: None}
