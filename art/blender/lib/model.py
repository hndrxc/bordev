"""Small rigid-part modelling vocabulary, in tile units (Z is height)."""
import math
import bpy
from mathutils import Vector
from lib.materials import material


def root(name, location=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    return obj


def finish(obj, name, mat, parent):
    obj.name = name
    obj.parent = parent
    obj.data.materials.append(material(mat) if isinstance(mat, str) else mat)
    return obj


def box(name, location, scale, mat, parent=None, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = finish(bpy.context.object, name, mat, parent)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new("Chipped edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
    return obj


def ico(name, location, scale, mat, parent=None, subdivisions=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1, location=location)
    obj = finish(bpy.context.object, name, mat, parent)
    obj.scale = scale
    return obj


def cylinder(name, location, radius, depth, mat, parent=None, vertices=8):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    return finish(bpy.context.object, name, mat, parent)


def cone(name, location, radius, depth, mat, parent=None, radius_top=0, vertices=8):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=radius_top, depth=depth, location=location)
    return finish(bpy.context.object, name, mat, parent)


def beam(name, start, end, width, mat, parent=None):
    start, end = Vector(start), Vector(end)
    obj = cylinder(name, (start + end) / 2, width, (end - start).length, mat, parent, 6)
    obj.rotation_euler = (end - start).to_track_quat("Z", "Y").to_euler()
    return obj


def mesh(name, vertices, faces, mat, parent=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    return finish(obj, name, mat, parent)


def roof(name, center, width, depth, height, mat, parent=None):
    x, y, z = center
    w, d = width / 2, depth / 2
    return mesh(name, [(x-w,y-d,z), (x+w,y-d,z), (x+w,y+d,z), (x-w,y+d,z),
                       (x,y-d,z+height), (x,y+d,z+height)],
                [(0,3,2,1), (0,1,4), (3,5,2), (0,4,5,3), (1,2,5,4)], mat, parent)


def flag(parent, location, size=0.4):
    x, y, z = location
    beam("Flagpole", (x,y,z), (x,y,z+size*1.6), 0.018, "WOOD", parent)
    return mesh("Team pennant", [(x,y,z+size*1.55), (x+size,y+0.03,z+size*1.4),
                                 (x+size*0.8,y-0.015,z+size*0.78), (x,y,z+size*0.9)],
                [(0,1,2,3)], "TEAM", parent)


def wheel(parent, location, radius=0.25):
    pivot = root("Wheel axle", location, parent)
    rim = cylinder("Iron wheel rim", (0,0,0), radius, 0.085, "IRON", pivot, 12)
    rim.rotation_euler.y = math.pi / 2
    inset = cylinder("Wood wheel", (0,0,0), radius*0.80, 0.095, "WOOD_LIGHT", pivot, 12)
    inset.rotation_euler.y = math.pi / 2
    for angle in range(0, 180, 45):
        a = math.radians(angle)
        beam("Wheel spoke", (0,math.cos(a)*radius*0.8,math.sin(a)*radius*0.8),
             (0,-math.cos(a)*radius*0.8,-math.sin(a)*radius*0.8), 0.025, "WOOD", pivot)
    hub = cylinder("Wheel pin", (0,0,0), 0.065, 0.15, "IRON", pivot)
    hub.rotation_euler.y = math.pi / 2
    return pivot
