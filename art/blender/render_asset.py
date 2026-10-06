"""Run with blender -b --factory-startup --python-exit-code 1 --python this.py -- ..."""
import argparse
import math
from pathlib import Path
import sys
import time

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import io, look, materials, rig


def main():
    parser = argparse.ArgumentParser(description="Render manifest sprite body, team mask and cast shadows")
    parser.add_argument("--asset", required=True)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--only-anim")
    parser.add_argument("--only-dir", type=int)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    entry, module = io.load_asset(args.asset)
    if args.only_anim is not None and args.only_anim not in entry["anims"]:
        parser.error(f"Unknown animation {args.only_anim!r} for {args.asset}")
    if args.only_dir is not None and not 0 <= args.only_dir < entry["dirs"]:
        parser.error(f"Direction must be in 0..{entry['dirs'] - 1}")
    start = time.monotonic()
    calibration = entry["kind"] == "calibration"
    catcher = rig.setup(entry["frame"], entry["kind"] in ("building", "doodad"))
    styled, plain, shadow = look.setup(entry["frame"], calibration)
    model = module.build()
    clips = module.anims()
    if set(clips) != set(entry["anims"]):
        raise ValueError(f"Animation implementation does not match manifest: {args.asset}")
    for name, expected in entry["anims"].items():
        clip = clips[name]
        descriptor = getattr(clip, "descriptor", None)
        if descriptor is not None:
            actual_frames = descriptor["frames"]
            actual_loop = descriptor["loop"]
        elif hasattr(clip, "frames") and hasattr(clip, "loop"):
            actual_frames = clip.frames
            actual_loop = clip.loop
        elif name == "idle":
            actual_frames = 1
            actual_loop = True
        else:
            raise ValueError(f"Missing animation descriptor for {args.asset}.{name}")

        if expected["frames"] != actual_frames or expected["loop"] != actual_loop:
            raise ValueError(
                f"Animation descriptor mismatch for {args.asset}.{name}: "
                f"manifest has frames={expected['frames']} loop={expected['loop']}, "
                f"asset has frames={actual_frames} loop={actual_loop}"
            )
    objects = [model, *model.children_recursive]
    initial_rotation = model.rotation_euler.z
    renders = 0
    for name, animation in entry["anims"].items():
        if args.only_anim is not None and name != args.only_anim:
            continue
        for direction in range(entry["dirs"]):
            if args.only_dir is not None and direction != args.only_dir:
                continue
            for frame in range(animation["frames"]):
                clips[name](frame)
                model.rotation_euler.z = initial_rotation - direction * math.pi / 4
                bpy.context.view_layer.update()
                for render_pass in (("body", "mask", "shadow") if catcher else ("body", "mask")):
                    if render_pass != "mask":
                        rig.render_bounds(objects, shadow=render_pass == "shadow")
                    look.select_pass(render_pass, styled, plain, shadow, calibration)
                    saved = materials.set_mask(objects) if render_pass == "mask" else None
                    if render_pass == "shadow":
                        catcher.hide_render = False
                        for obj in objects:
                            obj.visible_camera = False
                    bpy.context.scene.render.filepath = str(io.frame_path(args.out, render_pass, name, direction, frame))
                    try:
                        bpy.ops.render.render(write_still=True)
                    finally:
                        if saved is not None:
                            materials.restore(saved)
                        if catcher is not None:
                            catcher.hide_render = True
                        for obj in objects:
                            obj.visible_camera = True
                    renders += 1
    print(f"SPRITE_DONE {args.asset}: {renders} passes in {time.monotonic() - start:.2f}s", flush=True)


if __name__ == "__main__":
    main()
