"""Exact one-tile ground square with inset world-axis edge markers."""
from lib.model import mesh, root
from lib.materials import material


def build():
    parent = root("Calibration tile")
    mesh("One world tile", [(-0.5,-0.5,0), (0.5,-0.5,0), (0.5,0.5,0), (-0.5,0.5,0)],
         [(0,1,2,3)], material("CALIB_TILE", (0.46,0.46,0.46), True), parent)
    mesh("World +X", [(0.40,-0.34,0.0001),(0.49,-0.34,0.0001),(0.49,0.34,0.0001),(0.40,0.34,0.0001)],
         [(0,1,2,3)], material("CALIB_RED", (1,0,0), True), parent)
    mesh("World +Z", [(-0.34,-0.49,0.0001),(0.34,-0.49,0.0001),(0.34,-0.40,0.0001),(-0.34,-0.40,0.0001)],
         [(0,1,2,3)], material("CALIB_BLUE", (0,0,1), True), parent)
    return parent


def anims():
    return {"idle": lambda frame: None}
