"""Reusable construction states with Crown masonry, timber and working farmland."""
import math
import random
from lib import anim
from lib.model import root, box, ico, cylinder, cone, beam, roof, flag, mesh


def states(name, size):
    parent = root(name)
    levels = [root(label, parent=parent) for label in ("Foundations", "Walls", "Roof and fittings")]
    scaffold = root("Construction scaffold", parent=parent)
    rubble = root("Collapsed rubble", parent=parent)
    damage = root("Damage cracks and scorch", parent=parent)
    half = size / 2 - 0.08
    for x in (-half,half):
        for y in (-half,half):
            beam("Scaffold upright", (x,y,0.02),(x,y,size*0.58),0.034,"WOOD_LIGHT",scaffold)
        for z in (size*0.25,size*0.5):
            beam("Scaffold crossbar", (x,-half,z),(x,half,z),0.029,"WOOD_LIGHT",scaffold)
            box("Scaffold board", (x,0,z),(0.19,size-0.08,0.035),"WOOD",scaffold)
        beam("Scaffold brace", (x,-half,0.05),(x,half,size*0.49),0.025,"WOOD",scaffold)
    rng = random.Random(name)
    for index in range(20 if size > 2 else 12):
        x, y = rng.uniform(-half*0.85,half*0.85), rng.uniform(-half*0.85,half*0.85)
        chunk = ico("Rubble masonry", (x,y,0.10+rng.random()*0.1),
                    (size*0.10,size*0.075,0.12+rng.random()*0.12),
                    "STONE_DARK" if index%3 == 0 else "STONE",rubble)
        chunk.rotation_euler.z = rng.random()*math.tau
    for index in range(4):
        plank = box("Broken roof timber", (rng.uniform(-half,half),rng.uniform(-half,half),0.21),
                    (size*0.45,0.08,0.07),"WOOD",rubble)
        plank.rotation_euler.z = rng.random()*math.pi
    anim.visibility(scaffold,False)
    anim.visibility(rubble,False)
    anim.visibility(damage,False)
    return {"root":parent,"levels":levels,"scaffold":scaffold,"rubble":rubble,"damage":damage}


def window(parent, x, y, z, width=0.22, height=0.35):
    box("Recessed window", (x,y,z),(width,0.025,height),"DARK",parent)
    box("Stone lintel", (x,y-0.012,z+height/2),(width+0.10,0.08,0.055),"STONE_LIGHT",parent)
    box("Window mullion", (x,y-0.025,z),(0.025,0.025,height),"WOOD_LIGHT",parent)


def cracks(parent, y, height, width):
    for index in range(3):
        x = (index-1)*width*0.31
        z = height*(0.45+index*0.1)
        mesh("Jagged masonry crack", [(x,y,z+0.32),(x+0.025,y,z+0.13),(x-0.085,y,z),
                                       (x-0.065,y,z-0.24),(x-0.025,y,z-0.02),(x+0.075,y,z+0.12)],
             [(0,1,2,3,4,5)],"DARK",parent)
    for x in (-width*0.22,width*0.24):
        ico("Scorched rubble", (x,y-0.04,0.16),(0.19,0.10,0.18),"STONE_DARK",parent)


def keep():
    parts = states("Crown keep",4)
    base, walls, top = parts["levels"]
    box("Four tile foundation", (0,0,0.07),(3.94,3.94,0.14),"STONE_DARK",base,0.04)
    box("Inner keep masonry", (0,0.25,0.92),(2.10,2.05,1.7),"STONE",walls,0.035)
    box("Foundation course", (0,0.25,0.23),(2.22,2.17,0.24),"STONE_LIGHT",walls)
    roof("Great hall slate roof", (0,0.25,1.78),2.36,2.30,0.65,"ROOF",top)
    for y in (-1.45,1.45):
        box("Curtain wall", (0,y,0.69),(2.85,0.26,1.17),"STONE",walls,0.025)
        box("Wall coping", (0,y,1.29),(2.90,0.32,0.12),"STONE_LIGHT",top)
        for x in (-1.12,-0.68,-0.23,0.23,0.68,1.12):
            box("Wall merlon", (x,y,1.48),(0.24,0.31,0.31),"STONE_LIGHT",top)
    for x in (-1.45,1.45):
        box("Side curtain wall", (x,0,0.69),(0.26,2.85,1.17),"STONE",walls,0.025)
        for y in (-0.90,-0.45,0,0.45,0.90):
            box("Side merlon", (x,y,1.42),(0.31,0.24,0.31),"STONE_LIGHT",top)
    for x in (-1.45,1.45):
        for y in (-1.45,1.45):
            cylinder("Octagonal corner tower", (x,y,1.09),0.47,1.96,"STONE",walls)
            cylinder("Tower footing", (x,y,0.24),0.52,0.28,"STONE_DARK",walls)
            cylinder("Tower rim", (x,y,2.03),0.52,0.17,"STONE_LIGHT",top)
            cylinder("Tower dark interior", (x,y,2.13),0.40,0.045,"STONE_DARK",top)
            for angle in range(0,360,60):
                a = math.radians(angle)
                block = box("Tower crenellation", (x+math.cos(a)*0.41,y+math.sin(a)*0.41,2.24),
                            (0.23,0.24,0.27),"STONE_LIGHT",top)
                block.rotation_euler.z = a
            window(walls,x,y-0.447,1.23,0.13,0.41)
    box("Gate recess", (0,-1.602,0.61),(0.72,0.035,1.03),"DARK",walls)
    box("Oak gate", (0,-1.63,0.52),(0.59,0.025,0.82),"WOOD",walls)
    for x in (-0.21,-0.07,0.07,0.21):
        box("Portcullis bar", (x,-1.66,0.55),(0.026,0.025,0.91),"IRON",walls)
    for z in (0.32,0.65,0.97):
        box("Gate crossbar", (0,-1.67,z),(0.68,0.025,0.027),"IRON",walls)
    for x in (-0.95,0.95):
        box("Team wall banner", (x,-1.621,0.85),(0.29,0.025,0.59),"TEAM",walls)
        box("Banner gold stripe", (x,-1.64,0.92),(0.21,0.015,0.045),"GOLD",walls)
    flag(top,(0,0.25,2.43),0.47)
    cracks(parts["damage"],-1.648,1.12,2.5)
    return parts


def cottage():
    parts = states("Crown cottage",2)
    base, walls, top = parts["levels"]
    box("Cottage foundation", (0,0,0.075),(1.85,1.74,0.15),"STONE_DARK",base,0.035)
    box("Warm plaster house", (0,0,0.62),(1.55,1.45,1.05),"PLASTER",walls,0.025)
    box("Stone lower course", (0,0,0.24),(1.62,1.52,0.26),"STONE",walls)
    for x in (-0.72,0,0.72):
        box("Front timber post", (x,-0.744,0.68),(0.09,0.05,0.93),"WOOD",walls)
    for z in (0.4,1.1):
        box("Front timber band", (0,-0.75,z),(1.56,0.05,0.085),"WOOD",walls)
    for x in (-0.79,0.79):
        beam("Side diagonal timber", (x,-0.7,0.4),(x,0.7,1.06),0.038,"WOOD",walls)
    box("Oak cottage door", (-0.35,-0.773,0.50),(0.38,0.045,0.69),"WOOD_LIGHT",walls)
    ico("Door latch", (-0.25,-0.804,0.51),(0.025,0.018,0.025),"IRON",walls)
    window(walls,0.38,-0.776,0.79,0.28,0.33)
    roof("Thick thatched roof", (0,0,1.10),1.89,1.86,0.67,"THATCH",top)
    beam("Roof ridge cap", (0,-0.98,1.78),(0,0.98,1.78),0.075,"WOOD",top)
    box("Stone chimney", (0.50,0.40,1.66),(0.24,0.26,0.68),"STONE",top)
    box("Chimney cap", (0.50,0.40,2.01),(0.31,0.32,0.07),"STONE_DARK",top)
    box("Team door awning", (-0.35,-0.88,0.96),(0.56,0.37,0.035),"TEAM",top)
    for x in (-0.61,-0.09):
        beam("Awning support", (x,-1.0,0.16),(x,-1.0,0.95),0.025,"WOOD",top)
    cracks(parts["damage"],-0.809,0.80,1.2)
    return parts


def farm():
    parts = states("Crown farm",2)
    base, fence, crops = parts["levels"]
    box("Tilled soil plot", (0,0,0.035),(1.92,1.92,0.07),"EARTH",base)
    for x in (-0.69,-0.35,0,0.35,0.69):
        box("Raised planting row", (x,0,0.078),(0.21,1.72,0.075),"WOOD",base)
    for x in (-0.95,0.95):
        for y in (-0.92,-0.3,0.32,0.94):
            box("Fence post", (x,y,0.23),(0.06,0.06,0.44),"WOOD",fence)
        for z in (0.18,0.36):
            beam("Fence rail", (x,-0.95,z),(x,0.95,z),0.023,"WOOD_LIGHT",fence)
    rng = random.Random(719)
    for x in (-0.69,-0.35,0,0.35,0.69):
        for row in range(7):
            y = -0.70+row*0.23
            height = 0.31+rng.random()*0.1
            beam("Wheat stalk", (x,y,0.10),(x,y,height),0.012,"WHEAT",crops)
            cone("Ripe wheat ear", (x,y,height+0.085),0.055,0.18,"WHEAT",crops,vertices=5)
            beam("Wheat leaf", (x,y,0.20),(x+0.1,y+0.045,0.32),0.012,"LEAF_LIGHT",crops)
    flag(crops,(-0.83,0.70,0.37),0.31)
    for x in (-0.69,0,0.69):
        for y in (-0.4,0.25):
            broken = box("Trampled crop", (x,y,0.24),(0.18,0.30,0.08),"DARK",parts["damage"])
            broken.rotation_euler.z = 0.35
    return parts
