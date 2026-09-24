"""Render a 3D model to 2D sprite PNGs (transparent background), headless.

Usage:
  blender -b -P tools/blender/render_sprites.py -- --out assets/generated/hero --demo
  blender -b -P tools/blender/render_sprites.py -- --model path/to/model.glb --out assets/generated/tree --angles 8 --size 256

Options:
  --model PATH    .glb/.gltf/.fbx/.obj to import (omit with --demo)
  --demo          build a simple placeholder character instead of importing
  --out DIR       output directory (files: <name>_<angle>.png)
  --angles N      number of evenly spaced views around the model (default 1)
  --size PX       square output size (default 128)
  --engine NAME   WORKBENCH (fast, default) or CYCLES (nicer lighting)
  --elevation DEG camera tilt, 0 = side view, 90 = top-down (default 30)
"""
import argparse
import math
import os
import sys

import bpy
from mathutils import Vector


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--model")
    p.add_argument("--demo", action="store_true")
    p.add_argument("--out", required=True)
    p.add_argument("--angles", type=int, default=1)
    p.add_argument("--size", type=int, default=128)
    p.add_argument("--engine", default="WORKBENCH", choices=["WORKBENCH", "CYCLES"])
    p.add_argument("--elevation", type=float, default=30.0)
    return p.parse_args(argv)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, rgb):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1.0)
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*rgb, 1.0)
    return m


def build_demo():
    body = material("body", (0.2, 0.55, 0.9))
    skin = material("skin", (1.0, 0.8, 0.6))
    bpy.ops.mesh.primitive_cylinder_add(radius=0.5, depth=1.0, location=(0, 0, 0.5))
    bpy.context.object.data.materials.append(body)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.4, location=(0, 0, 1.35))
    bpy.context.object.data.materials.append(skin)
    eye = material("eye", (0.05, 0.05, 0.08))
    for x in (0.15, -0.15):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.08, location=(x, -0.36, 1.42))
        bpy.context.object.data.materials.append(eye)


def import_model(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    else:
        raise SystemExit(f"unsupported model format: {ext}")


def scene_bounds():
    pts = [o.matrix_world @ Vector(c) for o in bpy.context.scene.objects
           if o.type == "MESH" for c in o.bound_box]
    if not pts:
        raise SystemExit("no mesh objects in scene")
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return (lo + hi) / 2, (hi - lo).length


def setup_render(args):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH" if args.engine == "WORKBENCH" else "CYCLES"
    if args.engine == "WORKBENCH":
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "MATERIAL"
        scene.display.shading.show_object_outline = True
    else:
        scene.cycles.samples = 32
        scene.cycles.device = "CPU"
        bpy.ops.object.light_add(type="SUN", location=(3, -3, 6))
        bpy.context.object.data.energy = 3.0
        world = bpy.data.worlds.new("w")
        world.color = (0.6, 0.6, 0.6)
        scene.world = world
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = args.size
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"


def main():
    args = parse_args()
    clear_scene()
    if args.demo:
        build_demo()
    elif args.model:
        import_model(os.path.abspath(args.model))
    else:
        raise SystemExit("pass --model PATH or --demo")

    setup_render(args)
    center, diag = scene_bounds()

    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = diag * 1.05
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam

    os.makedirs(args.out, exist_ok=True)
    name = os.path.basename(os.path.normpath(args.out))
    dist = diag * 3
    elev = math.radians(args.elevation)
    for i in range(args.angles):
        az = 2 * math.pi * i / args.angles
        offset = Vector((math.sin(az) * math.cos(elev), -math.cos(az) * math.cos(elev), math.sin(elev)))
        cam.location = center + offset * dist
        cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
        path = os.path.join(os.path.abspath(args.out), f"{name}_{i}.png")
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print(f"wrote {path}")


main()
