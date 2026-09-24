"""Cycles/OIDN and Blender 5.2 compositor; calibration deliberately bypasses style."""
import bpy


def compositor(scene, painterly):
    tree = bpy.data.node_groups.new("Sprite compositor", "CompositorNodeTree")
    tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    output = tree.nodes.new("NodeGroupOutput")
    layers = tree.nodes.new("CompositorNodeRLayers")
    if painterly:
        kuwahara = tree.nodes.new("CompositorNodeKuwahara")
        kuwahara.inputs["Type"].default_value = "Anisotropic"
        kuwahara.inputs["Size"].default_value = 6
        alpha = tree.nodes.new("CompositorNodeSetAlpha")
        alpha.inputs["Type"].default_value = "Replace Alpha"
        tree.links.new(layers.outputs["Image"], kuwahara.inputs["Image"])
        tree.links.new(kuwahara.outputs["Image"], alpha.inputs["Image"])
        tree.links.new(layers.outputs["Alpha"], alpha.inputs["Alpha"])
        tree.links.new(alpha.outputs["Image"], output.inputs["Image"])
    else:
        tree.links.new(layers.outputs["Image"], output.inputs["Image"])
    scene.compositing_node_group = tree
    return tree


def shadow_compositor(scene):
    """Convert Cycles' denoised illumination ratio into a transparent black shadow."""
    scene.view_layers[0].cycles.use_pass_shadow_catcher = True
    tree = bpy.data.node_groups.new("Cast shadow compositor", "CompositorNodeTree")
    tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    output = tree.nodes.new("NodeGroupOutput")
    layers = tree.nodes.new("CompositorNodeRLayers")
    opacity = tree.nodes.new("ShaderNodeMath")
    opacity.operation = "SUBTRACT"
    opacity.use_clamp = True
    # OIDN leaves at most a few percent low-frequency illumination noise.
    # Removing that floor avoids a faint rectangular catcher in the atlas.
    opacity.inputs[0].default_value = 0.95
    tree.links.new(layers.outputs["Shadow Catcher"], opacity.inputs[1])
    normalize = tree.nodes.new("ShaderNodeMath")
    normalize.operation = "DIVIDE"
    normalize.inputs[1].default_value = 0.95
    tree.links.new(opacity.outputs[0], normalize.inputs[0])
    alpha = tree.nodes.new("CompositorNodeSetAlpha")
    alpha.inputs["Type"].default_value = "Replace Alpha"
    alpha.inputs["Image"].default_value = (0, 0, 0, 1)
    tree.links.new(normalize.outputs[0], alpha.inputs["Alpha"])
    crop = tree.nodes.new("CompositorNodeCrop")
    crop.name = "Shadow border"
    crop.inputs["Alpha Crop"].default_value = True
    tree.links.new(alpha.outputs["Image"], crop.inputs["Image"])
    tree.links.new(crop.outputs["Image"], output.inputs["Image"])
    scene.view_layers[0].cycles.use_pass_shadow_catcher = False
    return tree


def setup(frame, calibration=False):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.render.compositor_device = "CPU"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 32
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.seed = 0
    scene.cycles.use_animated_seed = False
    scene.cycles.use_denoising = not calibration
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.cycles.denoising_use_gpu = False
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 2
    scene.render.resolution_x = frame * 2
    scene.render.resolution_y = frame * 2
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 25
    scene.render.use_file_extension = True
    scene.render.fps = 12
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    scene.render.use_freestyle = not calibration
    scene.render.line_thickness = 1.0
    lines = scene.view_layers[0].freestyle_settings.linesets
    line_set = lines[0] if lines else lines.new("Sprite contours")
    line_set.select_silhouette = True
    line_set.select_border = True
    line_set.select_crease = True
    line_set.linestyle.color = (0.08, 0.06, 0.05)
    line_set.linestyle.thickness = 2.0
    return compositor(scene, not calibration), compositor(scene, False), shadow_compositor(scene)


def select_pass(name, styled, plain, shadow, calibration=False):
    scene = bpy.context.scene
    body = name == "body"
    scene.cycles.samples = 16 if name == "mask" else 32
    scene.cycles.use_denoising = name != "mask" and not calibration
    scene.view_layers[0].cycles.use_pass_shadow_catcher = name == "shadow"
    scene.render.use_freestyle = body and not calibration
    scene.compositing_node_group = styled if body else shadow if name == "shadow" else plain
    if name == "shadow":
        crop = shadow.nodes["Shadow border"]
        width, height = scene.render.resolution_x, scene.render.resolution_y
        x, y = int(scene.render.border_min_x * width), int(scene.render.border_min_y * height)
        crop.inputs["X"].default_value = x
        crop.inputs["Y"].default_value = y
        crop.inputs["Width"].default_value = int(scene.render.border_max_x * width) - x
        crop.inputs["Height"].default_value = int(scene.render.border_max_y * height) - y
