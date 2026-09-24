"""Crown worker and infantry share a readable, rigid-part human silhouette."""
import math
from lib.model import root, box, ico, cylinder, cone, beam, mesh


def build(spearman=False):
    parent = root("Crown spearman" if spearman else "Crown peasant")
    parent.rotation_euler.z = math.pi / 4
    body = root("Body motion", parent=parent)
    parts = {"root": parent, "body": body}
    box("Belt", (0,0,0.53), (0.30,0.20,0.075), "LEATHER", body)
    cone("Team tunic", (0,0,0.69), 0.22, 0.32, "TEAM", body, 0.17, 6)
    box("Tunic collar", (0,-0.115,0.82), (0.15,0.025,0.06), "IVORY", body)
    cylinder("Neck", (0,0,0.91), 0.065, 0.10, "SKIN", body)
    ico("Head", (0,-0.018,1.035), (0.135,0.115,0.17), "SKIN", body, 2)
    ico("Nose", (0,-0.13,1.035), (0.036,0.047,0.038), "SKIN", body)
    for x in (-0.058,0.058):
        ico("Eye", (x,-0.119,1.08), (0.012,0.012,0.012), "DARK", body)
    if spearman:
        cone("Steel helmet", (0,0,1.155), 0.15, 0.17, "STEEL", body, 0.06)
        cylinder("Helmet brim", (0,0,1.095), 0.175, 0.038, "IRON", body)
        box("Nasal guard", (0,-0.151,1.046), (0.027,0.025,0.14), "STEEL", body)
        box("Padded breastplate", (0,-0.16,0.73), (0.25,0.065,0.20), "IRON", body)
    else:
        ico("Hair", (0,0.025,1.145), (0.143,0.11,0.075), "HAIR", body)
        cylinder("Straw hat brim", (0,0,1.155), 0.24, 0.025, "THATCH", body, 10)
        cone("Straw hat crown", (0,0,1.205), 0.145, 0.09, "THATCH", body, 0.10, 10)
        box("Apron", (0,-0.165,0.565), (0.22,0.025,0.27), "CLOTH", body)
    for side, sign in (("left",-1),("right",1)):
        leg = root(side + " leg", (sign*0.09,0,0.51), body)
        box("Trouser leg", (0,0,-0.16), (0.115,0.135,0.29), "CLOTH", leg)
        box("Boot", (0,-0.045,-0.41), (0.135,0.21,0.15), "LEATHER", leg)
        arm = root(side + " shoulder", (sign*0.205,0,0.82), body)
        ico("Sleeve", (sign*0.025,0,-0.09), (0.085,0.10,0.16), "TEAM", arm)
        beam("Forearm", (sign*0.025,0,-0.18), (sign*0.025,-0.055,-0.32), 0.048, "SKIN", arm)
        ico("Hand", (sign*0.025,-0.055,-0.33), (0.055,0.055,0.065), "SKIN", arm)
        parts[side + "_arm"] = arm
        parts[side + "_leg"] = leg
    hand = parts["right_arm"]
    if spearman:
        beam("Spear shaft", (0.035,-0.065,-0.64), (0.035,-0.065,0.83), 0.018, "WOOD_LIGHT", hand)
        cone("Spear head", (0.035,-0.065,0.94), 0.055, 0.25, "STEEL", hand, vertices=4)
        shield = parts["left_arm"]
        mesh("Kite shield", [(-0.09,-0.11,-0.04),(0.15,-0.11,-0.04),(0.18,-0.11,-0.28),
                             (0.03,-0.11,-0.52),(-0.12,-0.11,-0.28)], [(0,1,2,3,4)], "TEAM", shield)
        beam("Shield cross", (-0.08,-0.122,-0.18),(0.14,-0.122,-0.18),0.02,"IVORY",shield)
        beam("Shield cross", (0.03,-0.122,-0.07),(0.03,-0.122,-0.38),0.02,"IVORY",shield)
    else:
        beam("Hoe shaft", (0.035,-0.065,-0.51),(0.035,-0.065,0.49),0.022,"WOOD_LIGHT",hand)
        box("Hoe blade", (0.035,-0.12,0.49),(0.22,0.17,0.045),"IRON",hand)
    return parts
