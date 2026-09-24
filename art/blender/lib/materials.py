"""Named, matte low-poly palette and the TEAM mask rendering convention."""
import bpy

PALETTE = {
    "STONE": (0.43, 0.46, 0.44),
    "STONE_LIGHT": (0.63, 0.65, 0.60),
    "STONE_DARK": (0.23, 0.27, 0.27),
    "PLASTER": (0.77, 0.68, 0.48),
    "WOOD": (0.29, 0.14, 0.055),
    "WOOD_LIGHT": (0.49, 0.29, 0.105),
    "ROOF": (0.29, 0.115, 0.065),
    "THATCH": (0.59, 0.39, 0.12),
    "SKIN": (0.64, 0.36, 0.19),
    "HAIR": (0.11, 0.055, 0.025),
    "CLOTH": (0.52, 0.44, 0.27),
    "LEATHER": (0.13, 0.07, 0.035),
    "IRON": (0.30, 0.36, 0.39),
    "STEEL": (0.64, 0.72, 0.73),
    "TEAM": (0.72, 0.72, 0.72),
    "GOLD": (0.95, 0.57, 0.045),
    "EARTH": (0.20, 0.105, 0.045),
    "LEAF": (0.12, 0.27, 0.055),
    "LEAF_LIGHT": (0.26, 0.39, 0.075),
    "PINE": (0.06, 0.19, 0.11),
    "WHEAT": (0.73, 0.51, 0.12),
    "OX": (0.43, 0.24, 0.105),
    "IVORY": (0.82, 0.75, 0.56),
    "DARK": (0.055, 0.045, 0.032),
}


def material(name, color=None, emission=False):
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing
    color = color if color is not None else PALETTE[name]
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1.0)
    result.use_nodes = True
    nodes = result.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    if emission:
        shader = nodes.new("ShaderNodeEmission")
        shader.inputs["Color"].default_value = (*color, 1.0)
    else:
        shader = nodes.new("ShaderNodeBsdfPrincipled")
        shader.inputs["Base Color"].default_value = (*color, 1.0)
        shader.inputs["Roughness"].default_value = 0.87
        shader.inputs["Specular IOR Level"].default_value = 0.18
    result.node_tree.links.new(shader.outputs[0], output.inputs["Surface"])
    return result


def mask_material(team):
    return material("MASK_WHITE" if team else "MASK_BLACK", (1, 1, 1) if team else (0, 0, 0), True)


def set_mask(objects):
    """Replace slots, not geometry, so occlusion and animation remain identical."""
    saved = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        saved.append((obj, list(obj.data.materials)))
        for index, source in enumerate(obj.data.materials):
            obj.data.materials[index] = mask_material(source is not None and source.name == "TEAM")
    return saved


def restore(saved):
    for obj, slots in saved:
        for index, source in enumerate(slots):
            obj.data.materials[index] = source
