"""Manifest loading and the single canonical raw-frame path convention."""
import importlib.util
import json
from pathlib import Path

ART_ROOT = Path(__file__).resolve().parents[2]
BLENDER_ROOT = ART_ROOT / "blender"


def load_asset(asset_id):
    manifest = json.loads((ART_ROOT / "manifest.json").read_text())
    entry = next((entry for entry in manifest if entry["id"] == asset_id), None)
    if entry is None:
        raise ValueError(f"Unknown asset {asset_id!r}")
    script = (BLENDER_ROOT / entry["script"]).resolve()
    if not script.is_relative_to(BLENDER_ROOT):
        raise ValueError(f"Asset script escapes blender directory: {script}")
    spec = importlib.util.spec_from_file_location(f"sprite_{asset_id}", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return entry, module


def frame_path(out, render_pass, animation, direction, frame):
    path = Path(out) / render_pass / animation / str(direction) / f"{frame}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path
