from lib import nature


def build():
    return nature.mine()


def anims():
    return {"idle": lambda frame: None}
