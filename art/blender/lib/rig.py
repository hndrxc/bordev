"""Shared dimetric rig: Blender X/-Y map to game X/Z, origin is frame centre."""
import math
import bpy
from mathutils import Euler, Vector
from bpy_extras.object_utils import world_to_camera_view
from lib.materials import material

PPU = 96 / math.sqrt(2)


def setup(frame, shadows=False):
    scene = bpy.context.scene
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    camera_data = bpy.data.cameras.new("Dimetric camera")
    camera = bpy.data.objects.new("Dimetric camera", camera_data)
    scene.collection.objects.link(camera)
    camera.rotation_euler = Euler((math.radians(60), 0, math.radians(45)), "XYZ")
    camera.location = camera.rotation_euler.to_matrix() @ Vector((0, 0, 30))
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = frame / PPU
    camera_data.clip_end = 100
    scene.camera = camera
    sun_data = bpy.data.lights.new("Upper left sun", "SUN")
    sun_data.energy = 3.0
    sun_data.angle = math.radians(5)
    sun = bpy.data.objects.new("Upper left sun", sun_data)
    scene.collection.objects.link(sun)
    sun.location = (-3, -4, 8)
    sun.rotation_euler = (-sun.location).to_track_quat("-Z", "Y").to_euler()
    scene.world = bpy.data.worlds.new("Ambient world")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.78, 0.84, 1.0, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.4
    catcher = None
    if shadows:
        bpy.ops.mesh.primitive_plane_add(size=frame / PPU * 3, location=(0, 0, -0.008))
        catcher = bpy.context.object
        catcher.name = "Ground shadow catcher"
        catcher.data.materials.append(material("SHADOW_GROUND", (0.5, 0.5, 0.5)))
        catcher.is_shadow_catcher = True
        catcher.hide_render = True
    return catcher


def render_bounds(objects, shadow=False):
    """Skip empty pixels without cropping the full-size, origin-centred output."""
    scene = bpy.context.scene
    graph = bpy.context.evaluated_depsgraph_get()
    points = []
    for obj in objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        evaluated = obj.evaluated_get(graph)
        for corner in evaluated.bound_box:
            point = evaluated.matrix_world @ Vector(corner)
            if shadow:
                # Directional sun is at (-3,-4,8); project its rays onto Z=0.
                point = Vector((point.x + point.z * 3 / 8, point.y + point.z / 2, 0))
            points.append(world_to_camera_view(scene, scene.camera, point))
    padding = (16 if shadow else 4) * 2 / scene.render.resolution_x
    bounds = (min(p.x for p in points) - padding, min(p.y for p in points) - padding,
              max(p.x for p in points) + padding, max(p.y for p in points) + padding)
    scene.render.use_border = True
    scene.render.use_crop_to_border = False
    scene.render.border_min_x = max(0, bounds[0])
    scene.render.border_min_y = max(0, bounds[1])
    scene.render.border_max_x = min(1, bounds[2])
    scene.render.border_max_y = min(1, bounds[3])
    return bounds
