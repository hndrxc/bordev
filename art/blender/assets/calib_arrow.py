"""Flat arrow: a neutral shaft and saturated magenta triangular forward tip."""
import math
from lib.model import mesh, root
from lib.materials import material


def build():
    parent = root("Calibration arrow")
    parent.rotation_euler.z = math.pi / 4
    mesh("Arrow shaft", [(-0.08,0.35,0),(0.08,0.35,0),(0.08,-0.18,0),(-0.08,-0.18,0)],
         [(0,3,2,1)], material("CALIB_SHAFT", (0.85,0.85,0.72), True), parent)
    mesh("Bright forward tip", [(-0.25,-0.14,0),(0.25,-0.14,0),(0,-0.66,0)],
         [(0,2,1)], material("CALIB_TIP", (1,0,1), True), parent)
    return parent


def anims():
    return {"idle": lambda frame: None}
