"""Render painterly, periodic ground textures with headless Blender 5.2.

Run: blender -b --factory-startup --python render_terrain.py -- --out public/terrain
The torus shader repeats outside the tile too: a 32-pixel rendered guard band
lets the anisotropic Kuwahara filter see real neighbouring texture, not clamped
image borders. Only the central 512 pixels are exported.
"""

import argparse
import math
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

import bpy
import numpy as np


SIZE = 512
PADDING = 32
# Palette entries are display-space sRGB. The shaders receive linear colours.
TERRAINS = {
    "grass": {
        "palette": ("30432a", "526442", "788451", "a3a56b"),
        "scale": 3.0,
        "detail_scale": 11.0,
        "bump": 0.12,
    },
    "dirt": {
        "palette": ("514033", "786047", "a08561", "b9a17c"),
        "scale": 3.6,
        "detail_scale": 12.0,
        "bump": 0.15,
    },
    "sand": {
        "palette": ("9c875e", "c2ad7c", "ddca98", "eaddb5"),
        "scale": 2.4,
        "detail_scale": 10.0,
        "bump": 0.07,
    },
    "shallow": {
        "palette": ("366965", "548b81", "7eaa96", "b3c5a9"),
        "scale": 2.6,
        "detail_scale": 8.0,
        "bump": 0.06,
    },
    "water": {
        "palette": ("234858", "356779", "50899a", "78a8b2"),
        "scale": 2.2,
        "detail_scale": 7.0,
        "bump": 0.05,
    },
    "rock-ground": {
        "palette": ("444644", "646961", "8a8c7f", "b2ad97"),
        "scale": 3.5,
        "detail_scale": 10.0,
        "bump": 0.18,
    },
}


def linear_colour(hex_colour):
    channels = [int(hex_colour[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(
        value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4
        for value in channels
    ) + (1.0,)


def math_node(tree, operation, first, second=None):
    node = tree.nodes.new("ShaderNodeMath")
    node.operation = operation
    for index, value in enumerate((first, second)):
        if value is None:
            continue
        if isinstance(value, (float, int)):
            node.inputs[index].default_value = value
        else:
            tree.links.new(value, node.inputs[index])
    return node.outputs[0]


def terrain_material(name, settings):
    material = bpy.data.materials.new(name)
    tree = material.node_tree
    tree.nodes.clear()
    geometry = tree.nodes.new("ShaderNodeNewGeometry")
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(geometry.outputs["Position"], separate.inputs[0])
    u = math_node(tree, "MULTIPLY", separate.outputs["X"], math.tau)
    v = math_node(tree, "MULTIPLY", separate.outputs["Y"], math.tau)
    torus = tree.nodes.new("ShaderNodeCombineXYZ")
    tree.links.new(math_node(tree, "COSINE", u), torus.inputs["X"])
    tree.links.new(math_node(tree, "SINE", u), torus.inputs["Y"])
    tree.links.new(math_node(tree, "COSINE", v), torus.inputs["Z"])
    w = math_node(tree, "SINE", v)

    def noise(scale, detail):
        node = tree.nodes.new("ShaderNodeTexNoise")
        node.noise_dimensions = "4D"
        node.inputs["Scale"].default_value = scale
        node.inputs["Detail"].default_value = detail
        node.inputs["Roughness"].default_value = 0.65
        tree.links.new(torus.outputs[0], node.inputs["Vector"])
        tree.links.new(w, node.inputs["W"])
        return node.outputs["Fac"]

    broad = noise(settings["scale"], 3.0)
    grain = noise(settings["detail_scale"], 2.0)
    pattern = math_node(
        tree, "ADD",
        math_node(tree, "MULTIPLY", broad, 0.82),
        math_node(tree, "MULTIPLY", grain, 0.18),
    )
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "EASE"
    ramp.color_ramp.elements.remove(ramp.color_ramp.elements[1])
    for index, (position, colour) in enumerate(
        zip((0.22, 0.43, 0.58, 0.78), settings["palette"])
    ):
        element = ramp.color_ramp.elements[0] if index == 0 else ramp.color_ramp.elements.new(position)
        element.position = position
        element.color = linear_colour(colour)
    tree.links.new(pattern, ramp.inputs["Fac"])
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = settings["bump"]
    bump.inputs["Distance"].default_value = 0.012
    tree.links.new(pattern, bump.inputs["Height"])
    surface = tree.nodes.new("ShaderNodeBsdfPrincipled")
    surface.inputs["Roughness"].default_value = 0.9
    surface.inputs["Specular IOR Level"].default_value = 0.1
    tree.links.new(ramp.outputs["Color"], surface.inputs["Base Color"])
    tree.links.new(bump.outputs["Normal"], surface.inputs["Normal"])
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(surface.outputs[0], output.inputs["Surface"])
    return material


def setup_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 32
    scene.cycles.seed = 0
    scene.cycles.use_animated_seed = False
    # Kuwahara smooths the render; avoid a separate, non-periodic denoising pass.
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 2
    scene.render.resolution_x = SIZE + 2 * PADDING
    scene.render.resolution_y = SIZE + 2 * PADDING
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 25
    scene.render.dither_intensity = 0.0
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (1, 1, 1, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.4

    bpy.ops.mesh.primitive_plane_add(size=2.0)
    ground = bpy.context.object
    ground.name = "Periodic terrain"
    bpy.ops.object.camera_add(location=(0, 0, 3))
    scene.camera = bpy.context.object
    scene.camera.data.type = "ORTHO"
    scene.camera.data.ortho_scale = (SIZE + 2 * PADDING) / SIZE
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(25), math.radians(-20), 0))
    bpy.context.object.data.energy = 3.0
    bpy.context.object.data.angle = math.radians(5)

    scene.render.use_compositing = True
    scene.render.compositor_device = "CPU"
    group = bpy.data.node_groups.new("Periodic terrain look", "CompositorNodeTree")
    group.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    scene.compositing_node_group = group
    layers = group.nodes.new("CompositorNodeRLayers")
    kuwahara = group.nodes.new("CompositorNodeKuwahara")
    kuwahara.inputs["Type"].default_value = "Anisotropic"
    kuwahara.inputs["Size"].default_value = 6.0
    output = group.nodes.new("NodeGroupOutput")
    group.links.new(layers.outputs["Image"], kuwahara.inputs["Image"])
    group.links.new(kuwahara.outputs["Image"], output.inputs["Image"])
    return scene, ground


def export_tile(scene, padded_path, output_path):
    # Blender's scene output always keeps the render dimensions, even with a
    # compositor Crop node. Crop the filtered image without resampling instead.
    source = bpy.data.images.load(str(padded_path), check_existing=False)
    extent = SIZE + 2 * PADDING
    pixels = np.empty(extent * extent * 4, dtype=np.float32)
    source.pixels.foreach_get(pixels)
    tile_pixels = pixels.reshape(extent, extent, 4)[
        PADDING:PADDING + SIZE, PADDING:PADDING + SIZE
    ].copy()
    tile = bpy.data.images.new("Terrain tile", width=SIZE, height=SIZE, alpha=False, float_buffer=True)
    tile.pixels.foreach_set(tile_pixels.ravel())
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "8"
    tile.save_render(str(output_path), scene=scene)
    bpy.data.images.remove(tile)
    bpy.data.images.remove(source)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("public/terrain"))
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    args.out.mkdir(parents=True, exist_ok=True)
    scene, ground = setup_scene()
    with TemporaryDirectory(prefix="bordev-terrain-") as temporary:
        # Keep the filtered intermediate linear; apply Standard/sRGB just once
        # when saving the cropped tile, rather than gamma-encoding a PNG twice.
        padded_path = Path(temporary) / "padded.exr"
        for name, settings in TERRAINS.items():
            material = terrain_material(name, settings)
            ground.data.materials.clear()
            ground.data.materials.append(material)
            scene.render.image_settings.file_format = "OPEN_EXR"
            scene.render.image_settings.color_depth = "32"
            scene.render.filepath = str(padded_path)
            bpy.ops.render.render(write_still=True)
            output_path = (args.out / f"{name}.png").resolve()
            export_tile(scene, padded_path, output_path)
            print(f"Rendered {name}: {output_path}", flush=True)
            ground.data.materials.clear()
            bpy.data.materials.remove(material)


if __name__ == "__main__":
    main()
