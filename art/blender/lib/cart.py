"""Two-wheeled gold cart, a horned ox, working wheels and progressive loading."""
import math
from lib import anim
from lib.model import root, box, ico, beam, wheel


def build():
    parent = root("Crown ox cart")
    parent.rotation_euler.z = math.pi / 4
    chassis = root("Cart suspension", parent=parent)
    for x in (-0.27,0.27):
        beam("Long drawbar", (x,-0.75,0.44),(x,0.83,0.44),0.036,"WOOD",chassis)
    for x in (-0.28,-0.14,0,0.14,0.28):
        box("Bed plank", (x,0.46,0.48),(0.13,0.85,0.075),"WOOD_LIGHT",chassis)
    for x in (-0.38,0.38):
        for y in (0.06,0.86):
            box("Cart stake", (x,y,0.65),(0.055,0.055,0.43),"WOOD",chassis)
        for z in (0.58,0.73):
            box("Side rail", (x,0.46,z),(0.055,0.86,0.09),"WOOD_LIGHT",chassis)
    for y in (0.04,0.88):
        box("End rail", (0,y,0.63),(0.75,0.055,0.22),"WOOD",chassis)
    box("Team side cloth", (0.414,0.45,0.64),(0.018,0.36,0.26),"TEAM",chassis)
    box("Team side cloth", (-0.414,0.45,0.64),(0.018,0.36,0.26),"TEAM",chassis)
    wheels = [wheel(parent,(x,0.48,0.29),0.28) for x in (-0.47,0.47)]
    cargo = root("Gold load", (0,0,0.50), chassis)
    for x,y,z in ((-0.16,0.23,0.09),(0.15,0.29,0.09),(-0.13,0.57,0.10),(0.13,0.61,0.18)):
        ico("Gold sack", (x,y,z),(0.17,0.20,0.15),"CLOTH",cargo)
        ico("Visible gold", (x,y,z+0.13),(0.095,0.09,0.045),"GOLD",cargo)
    ox = root("Ox motion", (0,-0.56,0), parent)
    ico("Ox body", (0,0,0.64),(0.30,0.48,0.31),"OX",ox,2)
    ico("Ox shoulder", (0,-0.28,0.75),(0.29,0.20,0.28),"OX",ox)
    head = root("Ox head pivot", (0,-0.44,0.77), ox)
    ico("Ox head", (0,-0.1,-0.07),(0.20,0.24,0.23),"OX",head,2)
    ico("Cream muzzle", (0,-0.29,-0.16),(0.16,0.13,0.11),"IVORY",head)
    for sign in (-1,1):
        ico("Ox eye", (sign*0.16,-0.22,0),(0.026,0.026,0.026),"DARK",head)
        ico("Ox ear", (sign*0.23,-0.05,0.07),(0.12,0.06,0.045),"OX",head)
        beam("Horn", (sign*0.13,0,0.10),(sign*0.32,0,0.24),0.043,"IVORY",head)
        beam("Horn tip", (sign*0.32,0,0.24),(sign*0.31,-0.06,0.34),0.023,"IVORY",head)
    box("Ox yoke", (0,-0.34,0.82),(0.81,0.10,0.10),"WOOD_LIGHT",ox)
    legs = []
    for x in (-0.19,0.19):
        for y in (-0.29,0.27):
            leg = root("Ox leg", (x,y,0.54), ox)
            beam("Ox shin", (0,0,0),(0,0,-0.40),0.063,"OX",leg)
            box("Hoof", (0,-0.015,-0.45),(0.12,0.15,0.10),"DARK",leg)
            legs.append(leg)
    beam("Ox tail", (0,0.40,0.7),(0,0.56,0.41),0.027,"OX",ox)
    return {"root":parent,"chassis":chassis,"cargo":cargo,"ox":ox,"head":head,"legs":legs,"wheels":wheels}


def clips(parts):
    reset = anim.resetter(parts["root"])

    def clip(name):
        descriptor = anim.CART_ANIMS[name]

        def apply(frame):
            reset()
            if name == "walk":
                anim.bob(parts["chassis"],frame*2,8,0.012)
                anim.bob(parts["ox"],frame*2,8,0.018)
                for index, leg in enumerate(parts["legs"]):
                    anim.swing(leg,frame,8,0.34,math.pi if index in (1,2) else 0)
                for wheel_part in parts["wheels"]:
                    wheel_part.rotation_euler.x = -frame * math.pi / 4
            if name == "load":
                parts["cargo"].scale.z = (0.12,0.42,0.72,1.0)[frame]
                anim.lean(parts["head"],0.18*math.sin(frame*math.pi/2))
            else:
                anim.visibility(parts["cargo"],False)
        apply.descriptor = descriptor
        apply.frames = descriptor["frames"]
        apply.loop = descriptor["loop"]
        return apply
    return {name:clip(name) for name in anim.CART_ANIMS}
