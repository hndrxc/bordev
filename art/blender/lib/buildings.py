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


def storehouse():
    parts = states("Crown storehouse", 2)
    base, walls, top = parts["levels"]
    box("Storehouse foundation", (0, 0.08, 0.075), (1.85, 1.70, 0.15), "STONE_DARK", base, 0.035)
    box("Loading dock deck", (0, -0.66, 0.13), (1.76, 0.46, 0.10), "WOOD", base)
    for x in (-0.75, -0.25, 0.25, 0.75):
        box("Dock foundation pier", (x, -0.85, 0.06), (0.16, 0.16, 0.12), "STONE_DARK", base)
    box("Dock access steps", (0.65, -0.92, 0.05), (0.42, 0.22, 0.09), "STONE", base)
    box("Plinth course", (0, 0.18, 0.24), (1.68, 1.34, 0.24), "STONE_DARK", walls)
    box("Storehouse masonry walls", (0, 0.18, 0.68), (1.60, 1.26, 0.76), "STONE", walls, 0.025)
    for x in (-0.78, 0.78):
        for y in (-0.42, 0.78):
            box("Wall quoin", (x, y, 0.68), (0.12, 0.12, 0.82), "STONE_LIGHT", walls)
    for z in (0.34, 0.98):
        box("Wall timber band", (0, 0.18, z), (1.64, 1.30, 0.06), "WOOD", walls)
    box("Cargo door opening", (-0.15, -0.46, 0.52), (0.68, 0.035, 0.78), "DARK", walls)
    box("Left cargo door", (-0.31, -0.48, 0.50), (0.31, 0.025, 0.72), "WOOD_LIGHT", walls)
    box("Right cargo door", (0.01, -0.48, 0.50), (0.31, 0.025, 0.72), "WOOD_LIGHT", walls)
    for z in (0.28, 0.72):
        box("Door hinge strap", (-0.15, -0.50, z), (0.64, 0.02, 0.04), "IRON", walls)
    ico("Door iron latch", (-0.15, -0.51, 0.50), (0.025, 0.02, 0.025), "IRON", walls)
    box("Side lean-to deck", (0.78, 0.18, 0.11), (0.32, 1.05, 0.06), "WOOD", walls)
    for y in (-0.30, 0.65):
        beam("Shelter post", (0.90, y, 0.12), (0.90, y, 0.95), 0.032, "WOOD", walls)
    beam("Shelter tie-beam", (0.90, -0.30, 0.95), (0.90, 0.65, 0.95), 0.032, "WOOD", walls)
    box("Wooden cargo crate A", (0.48, -0.62, 0.26), (0.28, 0.28, 0.22), "WOOD_LIGHT", walls)
    box("Wooden cargo crate B", (0.48, -0.62, 0.44), (0.22, 0.22, 0.18), "WOOD", walls)
    box("Side cargo crate", (0.78, -0.05, 0.24), (0.26, 0.28, 0.24), "WOOD_LIGHT", walls)
    cylinder("Storehouse barrel A", (-0.62, -0.62, 0.28), 0.14, 0.28, "WOOD", walls, 8)
    cylinder("Barrel iron hoop A1", (-0.62, -0.62, 0.36), 0.145, 0.025, "IRON", walls, 8)
    cylinder("Barrel iron hoop A2", (-0.62, -0.62, 0.20), 0.145, 0.025, "IRON", walls, 8)
    cylinder("Storehouse barrel B", (-0.62, -0.32, 0.26), 0.12, 0.24, "WOOD_LIGHT", walls, 8)
    for i, (gx, gy, gz) in enumerate([(0.18, -0.65, 0.20), (0.28, -0.65, 0.20), (0.23, -0.65, 0.24)]):
        box(f"Gold ingot {i}", (gx, gy, gz), (0.10, 0.06, 0.04), "GOLD", walls)
    ico("Grain sack A", (-0.62, 0.40, 0.24), (0.16, 0.16, 0.15), "CLOTH", walls)
    ico("Grain sack B", (-0.62, 0.62, 0.22), (0.14, 0.14, 0.13), "EARTH", walls)
    window(walls, -0.15, 0.815, 0.75, 0.28, 0.28)
    roof("Storehouse tile roof", (0, 0.18, 1.06), 1.78, 1.48, 0.65, "ROOF", top)
    beam("Roof ridge timber", (0, -0.56, 1.71), (0, 0.92, 1.71), 0.045, "WOOD_LIGHT", top)
    mesh("Side lean-to roof",
         [(0.70, -0.34, 1.05), (0.98, -0.34, 0.92), (0.98, 0.69, 0.92), (0.70, 0.69, 1.05)],
         [(0, 1, 2, 3)], "ROOF", top)
    beam("Gable hoist beam", (0, -0.40, 1.68), (0, -0.86, 1.68), 0.038, "WOOD", top)
    beam("Hoist angle brace", (0, -0.46, 1.42), (0, -0.78, 1.66), 0.028, "WOOD", top)
    cylinder("Hoist pulley wheel", (0, -0.83, 1.63), 0.045, 0.035, "IRON", top, 8)
    beam("Hoist rope", (0, -0.83, 1.60), (0, -0.83, 1.25), 0.012, "CLOTH", top)
    ico("Hoist cargo hook", (0, -0.83, 1.23), (0.025, 0.025, 0.035), "IRON", top)
    box("Loft cargo hatch", (0, -0.46, 1.34), (0.36, 0.03, 0.42), "WOOD_LIGHT", top)
    box("Storehouse team banner", (-0.60, -0.47, 0.72), (0.28, 0.025, 0.58), "TEAM", top)
    box("Banner gold stripe", (-0.60, -0.485, 0.78), (0.20, 0.015, 0.045), "GOLD", top)
    box("Dock team awning", (-0.15, -0.62, 1.02), (0.78, 0.32, 0.035), "TEAM", top)
    for x in (-0.50, 0.20):
        beam("Awning timber support", (x, -0.46, 0.96), (x, -0.74, 1.01), 0.022, "WOOD", top)
    flag(top, (0, 0.88, 1.71), 0.36)
    cracks(parts["damage"], -0.47, 0.85, 1.4)
    broken_crate = box("Smashed cargo box", (0.42, -0.66, 0.19), (0.26, 0.26, 0.12), "DARK", parts["damage"])
    broken_crate.rotation_euler.z = 0.4
    ico("Spilled grain", (-0.55, -0.58, 0.18), (0.18, 0.14, 0.08), "EARTH", parts["damage"])
    box("Fallen hoist timber", (0.12, -0.52, 0.14), (0.65, 0.08, 0.07), "WOOD", parts["rubble"])
    cylinder("Cracked barrel", (-0.35, -0.50, 0.12), 0.14, 0.16, "WOOD", parts["rubble"])
    box("Scattered gold bar", (0.20, -0.35, 0.08), (0.10, 0.06, 0.04), "GOLD", parts["rubble"])
    return parts


def chapel():
    parts = states("Crown chapel", 2)
    base, walls, top = parts["levels"]
    box("Chapel foundation slab", (0, 0.02, 0.075), (1.86, 1.82, 0.15), "STONE_DARK", base, 0.035)
    box("Apse foundation course", (0.26, 0.82, 0.065), (0.76, 0.32, 0.13), "STONE_DARK", base)
    box("Portal stone steps", (0.26, -0.74, 0.055), (0.64, 0.28, 0.11), "STONE_LIGHT", base)
    box("Upper step course", (0.26, -0.66, 0.10), (0.54, 0.18, 0.08), "STONE_LIGHT", base)
    box("Tower foundation footing", (-0.46, -0.34, 0.09), (0.86, 0.86, 0.18), "STONE_DARK", base)
    box("Chapel nave masonry", (0.26, 0.06, 0.68), (0.96, 1.28, 0.92), "STONE", walls, 0.025)
    box("Nave plinth band", (0.26, 0.06, 0.25), (1.02, 1.34, 0.22), "STONE_LIGHT", walls)
    box("Nave rear apse", (0.26, 0.74, 0.62), (0.70, 0.28, 0.80), "STONE", walls)
    box("Apse plinth", (0.26, 0.74, 0.24), (0.74, 0.32, 0.22), "STONE_LIGHT", walls)
    for y in (-0.42, 0.08, 0.58):
        box("Nave buttress", (0.78, y, 0.58), (0.16, 0.22, 0.80), "STONE_LIGHT", walls)
        mesh("Buttress slope",
             [(0.70, y-0.10, 0.98), (0.86, y-0.10, 0.86), (0.86, y+0.10, 0.86), (0.70, y+0.10, 0.98)],
             [(0, 1, 2, 3)], "STONE_LIGHT", walls)
    box("Portal recess", (0.26, -0.59, 0.52), (0.50, 0.04, 0.76), "DARK", walls)
    box("Oak chapel door", (0.26, -0.61, 0.48), (0.42, 0.025, 0.68), "WOOD", walls)
    box("Door arch surround", (0.26, -0.625, 0.55), (0.56, 0.045, 0.82), "STONE_LIGHT", walls)
    for z in (0.30, 0.65):
        box("Portal iron hinge", (0.26, -0.63, z), (0.46, 0.02, 0.035), "IRON", walls)
    box("Portal cross vertical", (0.26, -0.63, 0.98), (0.04, 0.02, 0.18), "STONE_LIGHT", walls)
    box("Portal cross horizontal", (0.26, -0.63, 1.01), (0.14, 0.02, 0.04), "STONE_LIGHT", walls)
    for y in (-0.18, 0.34):
        box("Lancet window recess", (0.75, y, 0.74), (0.03, 0.22, 0.46), "DARK", walls)
        box("Lancet window sill", (0.76, y, 0.49), (0.07, 0.26, 0.04), "STONE_LIGHT", walls)
        box("Lancet stone arch", (0.76, y, 0.98), (0.07, 0.26, 0.05), "STONE_LIGHT", walls)
        box("Stained glass pane", (0.745, y, 0.74), (0.015, 0.14, 0.36), "GOLD", walls)
    box("Tower base masonry", (-0.46, -0.34, 0.75), (0.78, 0.78, 1.02), "STONE", walls, 0.025)
    box("Tower base plinth", (-0.46, -0.34, 0.26), (0.84, 0.84, 0.24), "STONE_LIGHT", walls)
    for x in (-0.83, -0.09):
        for y in (-0.71, 0.03):
            box("Tower quoin", (x, y, 0.75), (0.11, 0.11, 1.05), "STONE_LIGHT", walls)
    box("Tower slit window", (-0.46, -0.74, 0.78), (0.10, 0.03, 0.38), "DARK", walls)
    box("Slit window lintel", (-0.46, -0.75, 0.98), (0.16, 0.06, 0.04), "STONE_LIGHT", walls)
    roof("Chapel slate roof", (0.26, 0.06, 1.14), 1.08, 1.34, 0.64, "ROOF", top)
    beam("Nave ridge cresting", (0.26, -0.58, 1.78), (0.26, 0.70, 1.78), 0.035, "STONE_LIGHT", top)
    mesh("Apse roof slope",
         [(0.00, 0.68, 1.04), (0.52, 0.68, 1.04), (0.44, 0.88, 1.04), (0.08, 0.88, 1.04),
          (0.26, 0.74, 1.38)],
         [(0, 1, 2, 3)], "ROOF", top)
    box("Gable cross vertical", (0.26, -0.62, 1.88), (0.035, 0.035, 0.22), "STONE_LIGHT", top)
    box("Gable cross horizontal", (0.26, -0.62, 1.92), (0.14, 0.035, 0.035), "STONE_LIGHT", top)
    box("Belfry floor cornice", (-0.46, -0.34, 1.28), (0.82, 0.82, 0.08), "STONE_LIGHT", top)
    for x in (-0.78, -0.14):
        for y in (-0.66, -0.02):
            box("Belfry pillar", (x, y, 1.62), (0.14, 0.14, 0.60), "STONE_LIGHT", top)
    box("Belfry inner void", (-0.46, -0.34, 1.62), (0.50, 0.50, 0.56), "DARK", top)
    beam("Bell yoke beam", (-0.70, -0.34, 1.82), (-0.22, -0.34, 1.82), 0.035, "WOOD", top)
    cone("Bronze church bell", (-0.46, -0.34, 1.66), 0.17, 0.22, "GOLD", top, radius_top=0.06, vertices=8)
    cylinder("Bell clapper", (-0.46, -0.34, 1.54), 0.025, 0.08, "IRON", top, 6)
    box("Belfry upper cornice", (-0.46, -0.34, 1.94), (0.84, 0.84, 0.08), "STONE_LIGHT", top)
    for x in (-0.80, -0.12):
        for y in (-0.68, 0.00):
            cone("Corner pinnacle", (x, y, 2.08), 0.06, 0.20, "STONE_LIGHT", top, vertices=6)
    cone("Chapel tower spire", (-0.46, -0.34, 2.30), 0.42, 0.68, "ROOF", top, vertices=8)
    box("Spire cross vertical", (-0.46, -0.34, 2.70), (0.028, 0.028, 0.22), "GOLD", top)
    box("Spire cross horizontal", (-0.46, -0.34, 2.74), (0.13, 0.028, 0.028), "GOLD", top)
    box("Chapel team banner", (-0.46, -0.74, 1.05), (0.34, 0.025, 0.68), "TEAM", top)
    box("Banner gold cross", (-0.46, -0.755, 1.08), (0.16, 0.015, 0.035), "GOLD", top)
    box("Banner gold cross v", (-0.46, -0.755, 1.08), (0.035, 0.015, 0.24), "GOLD", top)
    flag(top, (0.26, 0.65, 1.78), 0.34)
    cracks(parts["damage"], -0.74, 0.85, 0.7)
    damaged_finial = box("Broken cross timber", (-0.28, -0.62, 0.16), (0.24, 0.04, 0.04), "GOLD", parts["damage"])
    damaged_finial.rotation_euler.z = 0.5
    ico("Scorched altar stone", (0.26, -0.45, 0.18), (0.16, 0.14, 0.12), "STONE_DARK", parts["damage"])
    cone("Fallen church bell", (-0.35, -0.35, 0.14), 0.17, 0.20, "GOLD", parts["rubble"], vertices=8)
    box("Shattered arch stone", (0.15, -0.45, 0.12), (0.32, 0.12, 0.10), "STONE_LIGHT", parts["rubble"])
    box("Collapsed roof beam", (0.05, 0.20, 0.16), (0.55, 0.07, 0.06), "WOOD", parts["rubble"])
    return parts


def barracks():
    parts = states("Crown barracks", 3)
    base, walls, top = parts["levels"]
    box("Barracks compound foundation", (0, 0, 0.075), (2.85, 2.85, 0.15), "STONE_DARK", base, 0.04)
    box("Yard flagstone paving", (0.60, -0.45, 0.08), (1.45, 1.55, 0.04), "STONE", base)
    box("Garrison hall plinth", (-0.48, 0.36, 0.12), (1.78, 1.86, 0.12), "STONE_LIGHT", base)
    box("Yard perimeter wall east", (1.35, -0.40, 0.28), (0.18, 1.70, 0.32), "STONE", base)
    box("Yard perimeter wall south", (0.55, -1.30, 0.28), (1.45, 0.18, 0.32), "STONE", base)
    box("Yard corner post pier", (1.35, -1.30, 0.38), (0.28, 0.28, 0.52), "STONE_LIGHT", base)
    box("Garrison lower masonry", (-0.48, 0.36, 0.65), (1.68, 1.76, 0.94), "STONE", walls, 0.03)
    for x in (-1.30, 0.34):
        for y in (-0.50, 1.22):
            box("Hall quoin", (x, y, 0.65), (0.14, 0.14, 0.98), "STONE_LIGHT", walls)
    box("Hall mid stringcourse", (-0.48, 0.36, 1.08), (1.72, 1.80, 0.08), "STONE_LIGHT", walls)
    box("Hall entrance recess", (0.34, 0.0, 0.56), (0.04, 0.62, 0.86), "DARK", walls)
    box("Reinforced oak gate", (0.355, 0.0, 0.52), (0.03, 0.54, 0.78), "WOOD", walls)
    for z in (0.32, 0.72):
        box("Gate iron strap", (0.37, 0.0, z), (0.02, 0.58, 0.04), "IRON", walls)
    ico("Gate iron ring", (0.375, 0.08, 0.52), (0.025, 0.02, 0.025), "IRON", walls)
    for y in (0.0, 0.72):
        box("Hall arrow slit", (-1.33, y, 0.68), (0.03, 0.10, 0.42), "DARK", walls)
        box("Arrow slit lintel", (-1.34, y, 0.91), (0.05, 0.18, 0.04), "STONE_LIGHT", walls)
    box("Hall front arrow slit", (-0.48, -0.53, 0.68), (0.10, 0.03, 0.42), "DARK", walls)
    cylinder("Quintain base post", (0.65, -0.65, 0.44), 0.045, 0.68, "WOOD", walls, 6)
    beam("Quintain crossbar", (0.42, -0.65, 0.72), (0.88, -0.65, 0.72), 0.026, "WOOD", walls)
    cylinder("Quintain dummy torso", (0.42, -0.65, 0.58), 0.11, 0.28, "CLOTH", walls, 6)
    cylinder("Quintain dummy head", (0.42, -0.65, 0.76), 0.07, 0.12, "LEATHER", walls, 6)
    cylinder("Quintain target shield", (0.88, -0.65, 0.72), 0.13, 0.03, "TEAM", walls, 8)
    cylinder("Shield iron boss", (0.88, -0.665, 0.72), 0.035, 0.02, "IRON", walls, 6)
    for y in (-0.42, 0.12):
        beam("Weapon rack frame", (1.20, y, 0.10), (1.20, y, 0.62), 0.028, "WOOD", walls)
    beam("Weapon rack rail", (1.20, -0.42, 0.48), (1.20, 0.12, 0.48), 0.024, "WOOD", walls)
    for i, y in enumerate((-0.34, -0.20, -0.06, 0.06)):
        beam(f"Spear shaft {i}", (1.18, y, 0.10), (1.18, y, 0.94), 0.014, "WOOD_LIGHT", walls)
        box(f"Spear blade {i}", (1.18, y, 0.98), (0.02, 0.05, 0.14), "STEEL", walls)
    for i, y in enumerate((-0.85, -0.10)):
        cylinder(f"Mounted shield {i}", (1.33, y, 0.56), 0.15, 0.025, "TEAM", walls, 8)
        cylinder(f"Shield boss {i}", (1.315, y, 0.56), 0.04, 0.02, "IRON", walls, 6)
    box("Anvil wood stump", (0.22, -0.85, 0.22), (0.22, 0.22, 0.24), "WOOD", walls)
    box("Iron anvil", (0.22, -0.85, 0.38), (0.14, 0.26, 0.12), "IRON", walls)
    box("Quench water trough", (0.95, 0.55, 0.22), (0.28, 0.50, 0.24), "WOOD", walls)
    box("Trough water", (0.95, 0.55, 0.28), (0.22, 0.44, 0.06), "DARK", walls)
    roof("Garrison slate roof", (-0.48, 0.36, 1.18), 1.84, 1.92, 0.72, "ROOF", top)
    beam("Garrison ridge cap", (-0.48, -0.58, 1.90), (-0.48, 1.30, 1.90), 0.055, "WOOD_LIGHT", top)
    box("East dormer house", (0.20, 0.36, 1.45), (0.38, 0.42, 0.38), "PLASTER", top)
    mesh("Dormer roof",
         [(0.01, 0.15, 1.64), (0.39, 0.15, 1.48), (0.39, 0.57, 1.48), (0.01, 0.57, 1.64)],
         [(0, 1, 2, 3)], "ROOF", top)
    box("Dormer window", (0.395, 0.36, 1.45), (0.02, 0.22, 0.24), "DARK", top)
    box("Barracks stone chimney", (-1.05, 0.95, 1.65), (0.36, 0.38, 0.88), "STONE", top)
    box("Chimney cap stone", (-1.05, 0.95, 2.12), (0.44, 0.46, 0.08), "STONE_DARK", top)
    mesh("Weapon rack canopy",
         [(1.08, -0.48, 0.88), (1.36, -0.48, 0.76), (1.36, 0.18, 0.76), (1.08, 0.18, 0.88)],
         [(0, 1, 2, 3)], "ROOF", top)
    beam("Canopy eave timber", (1.08, -0.48, 0.88), (1.08, 0.18, 0.88), 0.028, "WOOD", top)
    box("Barracks team banner", (-0.48, -0.54, 0.84), (0.46, 0.025, 0.82), "TEAM", top)
    box("Banner gold chevron", (-0.48, -0.555, 0.92), (0.34, 0.015, 0.05), "GOLD", top)
    box("Yard entrance banner", (1.35, -1.315, 0.65), (0.24, 0.02, 0.48), "TEAM", top)
    flag(top, (-0.48, 0.36, 1.90), 0.46)
    cracks(parts["damage"], -0.54, 0.95, 1.5)
    broken_dummy = cylinder("Broken quintain", (0.60, -0.55, 0.16), 0.08, 0.45, "WOOD", parts["damage"])
    broken_dummy.rotation_euler.x = 1.1
    broken_dummy.rotation_euler.y = 0.4
    ico("Scorched yard stones", (0.50, -0.80, 0.12), (0.24, 0.20, 0.10), "STONE_DARK", parts["damage"])
    cylinder("Shattered shield", (0.75, -0.40, 0.11), 0.15, 0.025, "TEAM", parts["rubble"])
    box("Broken spear shaft", (0.90, -0.20, 0.10), (0.55, 0.03, 0.03), "WOOD_LIGHT", parts["rubble"])
    box("Fallen chimney stones", (-0.75, 0.70, 0.14), (0.30, 0.28, 0.20), "STONE", parts["rubble"])
    return parts


def archery_range():
    parts = states("Crown archery range", 3)
    base, walls, top = parts["levels"]
    box("Range compound foundation", (0, 0, 0.06), (2.85, 2.85, 0.12), "EARTH", base)
    for x in (-1.40, 1.40):
        box("Perimeter curb side", (x, 0, 0.12), (0.12, 2.85, 0.12), "STONE_DARK", base)
    for y in (-1.40, 1.40):
        box("Perimeter curb end", (0, y, 0.12), (2.85, 0.12, 0.12), "STONE_DARK", base)
    box("Shooting deck planks", (0.05, -0.88, 0.13), (1.75, 0.88, 0.10), "WOOD", base)
    for x in (-0.75, 0.05, 0.85):
        box("Deck support pier", (x, -1.30, 0.07), (0.16, 0.16, 0.14), "STONE_DARK", base)
    box("Fletcher lodge plinth", (-0.85, 0.48, 0.12), (1.05, 1.55, 0.14), "STONE_DARK", base)
    box("Target turf mound", (0.25, 0.95, 0.08), (1.80, 0.65, 0.08), "EARTH", base)
    box("Lodge stone course", (-0.85, 0.48, 0.28), (0.95, 1.45, 0.24), "STONE", walls)
    box("Lodge plaster walls", (-0.85, 0.48, 0.72), (0.88, 1.38, 0.68), "PLASTER", walls, 0.02)
    for x in (-1.26, -0.44):
        for y in (-0.18, 1.14):
            box("Lodge timber post", (x, y, 0.72), (0.10, 0.10, 0.72), "WOOD", walls)
    box("Lodge door opening", (-0.41, 0.15, 0.54), (0.04, 0.46, 0.72), "DARK", walls)
    box("Lodge oak door", (-0.395, 0.15, 0.51), (0.03, 0.40, 0.66), "WOOD_LIGHT", walls)
    box("Fletcher crafting bench", (-0.38, 0.78, 0.32), (0.16, 0.65, 0.28), "WOOD", walls)
    box("Bench arrow vise", (-0.37, 0.68, 0.48), (0.08, 0.12, 0.08), "IRON", walls)
    for i, tx in enumerate((-0.30, 0.25, 0.80)):
        beam(f"Target leg left {i}", (tx-0.16, 0.80, 0.08), (tx, 0.88, 0.68), 0.022, "WOOD", walls)
        beam(f"Target leg right {i}", (tx+0.16, 0.80, 0.08), (tx, 0.88, 0.68), 0.022, "WOOD", walls)
        beam(f"Target leg rear {i}", (tx, 1.05, 0.08), (tx, 0.88, 0.68), 0.022, "WOOD", walls)
        boss = cylinder(f"Straw target boss {i}", (tx, 0.85, 0.68), 0.25, 0.08, "WHEAT", walls, 10)
        boss.rotation_euler.x = math.pi / 2
        ring = cylinder(f"Target outer ring {i}", (tx, 0.805, 0.68), 0.20, 0.015, "IVORY", walls, 10)
        ring.rotation_euler.x = math.pi / 2
        bullseye = cylinder(f"Target bullseye {i}", (tx, 0.795, 0.68), 0.11, 0.015, "TEAM", walls, 8)
        bullseye.rotation_euler.x = math.pi / 2
        pin = cylinder(f"Target gold pin {i}", (tx, 0.785, 0.68), 0.04, 0.015, "GOLD", walls, 6)
        pin.rotation_euler.x = math.pi / 2
        beam(f"Arrow shaft A {i}", (tx-0.04, 0.52, 0.66), (tx-0.04, 0.80, 0.66), 0.009, "WOOD_LIGHT", walls)
        # Cone's seventh argument is radius_top, not the polygon count.
        arrow_tip = cone(f"Arrow tip A {i}", (tx-0.04, 0.79, 0.66), 0.015, 0.035, "STEEL", walls, vertices=4)
        arrow_tip.rotation_euler.x = -math.pi / 2
        beam(f"Arrow shaft B {i}", (tx+0.05, 0.56, 0.71), (tx+0.05, 0.80, 0.71), 0.009, "WOOD_LIGHT", walls)
    for i, bx in enumerate((-0.45, 0.0, 0.45, 0.90)):
        box(f"Backstop bale {i}", (bx, 1.12, 0.25), (0.42, 0.32, 0.32), "THATCH", walls)
        box(f"Upper bale {i}", (bx, 1.12, 0.54), (0.38, 0.28, 0.28), "THATCH", walls)
    box("Bow rack stand A", (0.85, -0.72, 0.38), (0.05, 0.08, 0.45), "WOOD", walls)
    box("Bow rack stand B", (0.85, -1.08, 0.38), (0.05, 0.08, 0.45), "WOOD", walls)
    beam("Bow rack crossbar", (0.85, -1.08, 0.52), (0.85, -0.72, 0.52), 0.022, "WOOD", walls)
    for by in (-0.98, -0.82):
        beam(f"Longbow upper {by}", (0.83, by, 0.54), (0.83, by-0.05, 0.82), 0.014, "WOOD", walls)
        beam(f"Longbow lower {by}", (0.83, by, 0.54), (0.83, by+0.05, 0.26), 0.014, "WOOD", walls)
        beam(f"Bowstring {by}", (0.85, by-0.05, 0.81), (0.85, by+0.05, 0.27), 0.007, "IVORY", walls)
    for qx, qy in [(-0.55, -0.65), (0.45, -0.65)]:
        cylinder("Arrow quiver", (qx, qy, 0.34), 0.065, 0.36, "LEATHER", walls, 6)
        for fx in (-0.02, 0.02):
            cone("Quiver fletching", (qx+fx, qy, 0.55), 0.02, 0.08, "IVORY", walls, vertices=4)
    roof("Fletcher lodge roof", (-0.85, 0.48, 1.08), 1.04, 1.54, 0.55, "ROOF", top)
    beam("Lodge roof ridge", (-0.85, -0.28, 1.63), (-0.85, 1.24, 1.63), 0.045, "WOOD_LIGHT", top)
    box("Lodge stone chimney", (-1.15, 0.95, 1.48), (0.24, 0.26, 0.62), "STONE", top)
    box("Lodge chimney cap", (-1.15, 0.95, 1.80), (0.30, 0.32, 0.06), "STONE_DARK", top)
    for px in (-0.72, 0.82):
        for py in (-1.26, -0.50):
            beam("Canopy timber post", (px, py, 0.18), (px, py, 1.05), 0.038, "WOOD", top)
    beam("Canopy front tie", (-0.72, -1.26, 1.05), (0.82, -1.26, 1.05), 0.034, "WOOD", top)
    beam("Canopy rear tie", (-0.72, -0.50, 1.05), (0.82, -0.50, 1.05), 0.034, "WOOD", top)
    for px in (-0.72, 0.82):
        beam("Canopy side tie", (px, -1.26, 1.05), (px, -0.50, 1.05), 0.034, "WOOD", top)
    mesh("Shooting canopy roof south",
         [(-0.80, -1.34, 1.05), (0.90, -1.34, 1.05), (0.90, -0.88, 1.34), (-0.80, -0.88, 1.34)],
         [(0, 1, 2, 3)], "ROOF", top)
    mesh("Shooting canopy roof north",
         [(-0.80, -0.88, 1.34), (0.90, -0.88, 1.34), (0.90, -0.42, 1.05), (-0.80, -0.42, 1.05)],
         [(0, 1, 2, 3)], "ROOF", top)
    box("Canopy team valance", (0.05, -1.28, 0.92), (1.46, 0.025, 0.24), "TEAM", top)
    box("Valance gold trim", (0.05, -1.295, 0.82), (1.38, 0.015, 0.035), "GOLD", top)
    flag(top, (0.05, -0.88, 1.34), 0.42)
    cracks(parts["damage"], -0.19, 0.85, 0.8)
    beam("Splintered target post", (0.45, 0.70, 0.12), (0.75, 0.85, 0.12), 0.025, "WOOD", parts["damage"])
    broken_boss = cylinder("Fallen damaged target", (0.60, 0.78, 0.10), 0.22, 0.06, "WHEAT", parts["damage"])
    broken_boss.rotation_euler.x = 0.2
    beam("Stray arrow A", (0.15, -0.30, 0.06), (0.15, -0.10, 0.28), 0.009, "WOOD_LIGHT", parts["damage"])
    beam("Stray arrow B", (-0.72, -0.50, 0.75), (-0.52, -0.50, 0.82), 0.009, "WOOD_LIGHT", parts["damage"])
    cylinder("Shattered target ring", (0.35, 0.75, 0.08), 0.18, 0.02, "TEAM", parts["rubble"])
    box("Charred straw bale", (0.10, 0.95, 0.12), (0.35, 0.30, 0.16), "EARTH", parts["rubble"])
    box("Fallen canopy timber", (0.05, -0.75, 0.10), (0.80, 0.07, 0.06), "WOOD", parts["rubble"])
    return parts
