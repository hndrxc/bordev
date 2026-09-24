"""Seeded, faceted tree/boulder variants and a visibly gold-bearing mine."""
import math
import random
from lib.model import root, ico, cone, beam, box


def tree(variant):
    parent = root(f"Tree variant {variant}")
    rng = random.Random(100+variant)
    if variant in (2,4):
        height = 2.20 if variant == 2 else 1.80
        beam("Pine trunk", (0,0,0),(0,0,height*0.83),0.095,"WOOD",parent)
        for index in range(4):
            z = 0.67+index*height*0.18
            radius = (0.65 if variant == 2 else 0.53)*(1-index*0.18)
            crown = cone("Layered pine boughs", (0,0,z),radius,height*0.51,
                         "PINE" if index%2 == 0 else "LEAF",parent,vertices=7)
            crown.rotation_euler.z = index*0.53
    else:
        height = 1.62 if variant == 1 else 1.84
        beam("Angular trunk", (0,0,0),(0.04,0,height),0.105,"WOOD",parent)
        for index in range(5):
            a = index*math.tau/5+variant
            x,y = math.cos(a)*0.40,math.sin(a)*0.40
            z = height-0.18+rng.random()*0.24
            beam("Forked branch", (0,0,height*0.48),(x,y,z),0.048,"WOOD_LIGHT",parent)
            foliage = ico("Broadleaf crown", (x,y,z),(0.56,0.51,0.48),
                          "LEAF_LIGHT" if (index+variant)%3 == 0 else "LEAF",parent,2)
            foliage.rotation_euler.z = rng.random()*math.tau
        ico("Tree crown top", (0,0,height+0.22),(0.58,0.56,0.48),"LEAF_LIGHT",parent,2)
    for angle in (0,2.1,4.2):
        beam("Exposed root", (0,0,0.12),(math.cos(angle)*0.3,math.sin(angle)*0.3,0.015),0.035,"WOOD",parent)
    return parent


def rock(variant):
    parent = root(f"Rock formation {variant}")
    rng = random.Random(300+variant)
    centers = [(-0.15,0.06,0.39),(0.35,0.12,0.20),(-0.34,-0.28,0.14)] if variant == 1 else [(-0.2,0.13,0.55),(0.23,-0.2,0.30),(0.39,0.35,0.16)]
    for index, center in enumerate(centers):
        chunk = ico("Weathered boulder", center,(0.52-index*0.1,0.44-index*0.09,center[2]+0.09),
                    "STONE" if index%2 else "STONE_LIGHT",parent,1)
        chunk.rotation_euler = (0.12*rng.random(),0.18*rng.random(),rng.random()*math.tau)
    for index in range(4):
        ico("Loose gravel", (rng.uniform(-0.58,0.58),rng.uniform(-0.48,0.48),0.055),
            (0.1,0.095,0.075),"STONE_DARK",parent)
    return parent


def mine():
    parent = root("Gold mine")
    for location,scale in (((-0.38,0.25,0.55),(0.75,0.68,0.72)),((0.40,0.23,0.47),(0.61,0.62,0.58)),((0,0.47,0.91),(0.51,0.43,0.52))):
        ico("Gold-bearing outcrop",location,scale,"STONE_DARK",parent,1)
    for index,(x,y,z) in enumerate(((-0.59,-0.14,0.8),(0.46,-0.21,0.65),(0.10,0.18,1.30),(-0.30,0.1,1.03),(0.66,0.20,0.85))):
        ore = ico("Exposed gold vein",(x,y,z),(0.19,0.08,0.17),"GOLD",parent,1)
        ore.rotation_euler.z = index*0.73
    box("Dark mine entrance", (0,-0.36,0.42),(0.63,0.04,0.73),"DARK",parent)
    for x in (-0.37,0.37):
        beam("Pit timber support", (x,-0.46,0.03),(x,-0.46,0.87),0.075,"WOOD",parent)
    beam("Mine lintel",(-0.45,-0.46,0.87),(0.45,-0.46,0.87),0.09,"WOOD_LIGHT",parent)
    for x in (-0.20,0.20):
        beam("Mine rail",(x,-0.95,0.035),(x,-0.38,0.035),0.018,"IRON",parent)
    for y in (-0.85,-0.64,-0.43):
        box("Rail sleeper",(0,y,0.025),(0.58,0.08,0.035),"WOOD",parent)
    box("Ore crate",(0.69,-0.56,0.20),(0.36,0.39,0.36),"WOOD_LIGHT",parent)
    for x in (0.61,0.77):
        ico("Crated gold",(x,-0.56,0.41),(0.11,0.12,0.085),"GOLD",parent)
    return parent
