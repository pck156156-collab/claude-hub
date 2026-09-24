"""Style test: build the chibi hero "Ray" in Blender and render pose frames for pixelisation.

Two passes per frame, both at 4x the final sprite size:
  <out>/<name>_id.png    flat colours (material IDs)
  <out>/<name>_lum.png   studio-lit white clay (shading)
tools/pixelize.py turns them into palette-locked pixel art.

Usage: blender -b -P tools/blender/chibi_ray.py -- --out /tmp/ray_raw
"""
import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

# Flat ID colours; must match MATERIALS in tools/pixelize.py
ID = {
    'skin': (1.0, 0.0, 0.0), 'hair': (0.0, 1.0, 0.0), 'band': (0.0, 0.0, 1.0),
    'shirt': (1.0, 1.0, 0.0), 'vest': (1.0, 0.0, 1.0), 'pants': (0.0, 1.0, 1.0),
    'boot': (0.5, 0.0, 0.0), 'gun': (0.0, 0.5, 0.0), 'belt': (0.0, 0.0, 0.5),
    'eye': (0.5, 0.5, 0.0), 'metal': (0.5, 0.0, 0.5),
}
FW, FH, SCALE = 40, 44, 4  # final frame size and supersampling


def args():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument('--out', required=True)
    return p.parse_args(a)


def mat(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = (*ID[name], 1)
    return m


def obj_from(op, name, material, parent=None, loc=(0, 0, 0), **kw):
    op(**kw)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(mat(material))
    bpy.ops.object.shade_smooth()
    if parent:
        o.parent = parent
    o.location = loc
    return o


def limb(name, material, length, radius, parent, loc, taper=1.0):
    """Cylinder hanging down from its origin (the joint)."""
    bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=radius * taper, radius2=radius, depth=length)
    o = bpy.context.object
    o.name = name
    for v in o.data.vertices:
        v.co.z -= length / 2
    o.data.materials.append(mat(material))
    bpy.ops.object.shade_smooth()
    o.parent = parent
    o.location = loc
    return o


def ball(name, material, r, parent, loc, scale=(1, 1, 1)):
    o = obj_from(bpy.ops.mesh.primitive_uv_sphere_add, name, material, parent, loc, radius=r, segments=24, ring_count=12)
    o.scale = scale
    return o


def box(name, material, size, parent, loc, rot=(0, 0, 0)):
    o = obj_from(bpy.ops.mesh.primitive_cube_add, name, material, parent, loc, size=1)
    o.scale = size
    o.rotation_euler = rot
    bpy.ops.object.modifier_add(type='BEVEL')
    o.modifiers['Bevel'].width = min(size) * 0.25
    o.modifiers['Bevel'].segments = 2
    return o


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    root = bpy.data.objects.new('root', None)
    bpy.context.scene.collection.objects.link(root)
    hip = bpy.data.objects.new('hip', None)
    bpy.context.scene.collection.objects.link(hip)
    hip.parent = root
    hip.location = (0, 0, 1.2)
    R = {'root': root, 'hip': hip}

    # legs (far leg first so names are stable)
    for side, y in (('far', 0.22), ('near', -0.22)):
        th = limb(f'thigh_{side}', 'pants', 0.62, 0.2, hip, (0, y, 0), taper=0.85)
        sh = limb(f'shin_{side}', 'pants', 0.52, 0.17, th, (0, 0, -0.62), taper=0.9)
        box(f'boot_{side}', 'boot', (0.5, 0.3, 0.26), sh, (0.1, 0, -0.56))
        R[f'thigh_{side}'], R[f'shin_{side}'] = th, sh

    # torso (child of hip)
    chest = bpy.data.objects.new('chest', None)
    bpy.context.scene.collection.objects.link(chest)
    chest.parent = hip
    R['chest'] = chest
    box('pelvis', 'pants', (0.5, 0.52, 0.26), chest, (0, 0, 0.08))
    box('belt', 'belt', (0.54, 0.56, 0.1), chest, (0, 0, 0.24))
    box('torso', 'shirt', (0.5, 0.56, 0.62), chest, (0, 0, 0.58))
    box('vest', 'vest', (0.56, 0.6, 0.42), chest, (0.02, 0, 0.56))
    box('pouch', 'belt', (0.14, 0.2, 0.16), chest, (0.3, -0.18, 0.5))

    # head
    neck = bpy.data.objects.new('neck', None)
    bpy.context.scene.collection.objects.link(neck)
    neck.parent = chest
    neck.location = (0.04, 0, 0.9)
    R['neck'] = neck
    ball('head', 'skin', 0.76, neck, (0.08, 0, 0.66), (1.0, 0.95, 1.0))
    ball('hair', 'hair', 0.74, neck, (-0.2, 0, 0.84), (0.9, 1.0, 0.85))
    ball('nose', 'skin', 0.1, neck, (0.84, -0.02, 0.58))
    for y in (-0.26, 0.22):
        ball(f'eye{y}', 'eye', 0.1, neck, (0.74, y, 0.72), (0.6, 1, 1.7))
    band = obj_from(bpy.ops.mesh.primitive_torus_add, 'band', 'band', neck, (0.02, 0, 1.0),
                    major_radius=0.76, minor_radius=0.1)
    band.rotation_euler = (0, math.radians(-14), 0)
    band.scale = (1.02, 1.05, 1.4)
    tails = []
    for i, (y, a) in enumerate(((-0.12, 30), (0.12, 50))):
        t = box(f'tail{i}', 'band', (0.5, 0.08, 0.14), neck, (-0.92, y, 0.9), (0, math.radians(a), 0))
        tails.append(t)
    R['tails'] = tails

    # arms: shoulders are children of the chest
    for side, y in (('far', 0.36), ('near', -0.36)):
        up = limb(f'upper_{side}', 'shirt', 0.42, 0.13, chest, (0.02, y, 0.8))
        fo = limb(f'fore_{side}', 'skin', 0.36, 0.11, up, (0, 0, -0.42))
        ball(f'hand_{side}', 'skin', 0.13, fo, (0, 0, -0.38))
        R[f'upper_{side}'], R[f'fore_{side}'] = up, fo

    # pistol held in the near hand, pointing along the forearm
    gun = bpy.data.objects.new('gun', None)
    bpy.context.scene.collection.objects.link(gun)
    gun.parent = R['fore_near']
    gun.location = (0, 0, -0.38)
    box('slide', 'gun', (0.22, 0.16, 0.8), gun, (0.03, 0, -0.36))
    box('grip', 'metal', (0.34, 0.14, 0.16), gun, (-0.18, 0, -0.1))
    box('muzzle', 'metal', (0.16, 0.12, 0.1), gun, (0.03, 0, -0.78))
    R['gun'] = gun
    return R


def deg(d):
    return math.radians(d)


def swing(o, forward_deg):
    """Rotate a hanging limb forward (+) or back (-) in the side view."""
    o.rotation_euler = (0, -deg(forward_deg), 0)


def pose(R, kind, t):
    """t in [0, 1) through the cycle."""
    for k in ('thigh_far', 'thigh_near', 'shin_far', 'shin_near', 'upper_far', 'fore_far', 'upper_near', 'fore_near'):
        R[k].rotation_euler = (0, 0, 0)
    R['root'].location = (0, 0, 0)
    R['upper_near'].location = (0.02, -0.36, 0.8)
    R['chest'].rotation_euler = (0, 0, 0)
    R['neck'].rotation_euler = (0, 0, 0)
    for i, tl in enumerate(R['tails']):
        tl.rotation_euler = (0, deg(30 + i * 20), 0)
    aim = 90  # gun arm horizontal

    if kind == 'idle':
        breath = math.sin(t * 2 * math.pi)
        R['root'].location.z = -0.03 * (1 - breath) / 2
        swing(R['thigh_far'], -6); swing(R['thigh_near'], 8)
        swing(R['shin_far'], -2); swing(R['shin_near'], -4)
        R['chest'].rotation_euler = (0, deg(4 + breath * 1.5), 0)
        swing(R['upper_far'], 50); swing(R['fore_far'], 40)
        swing(R['upper_near'], aim - 8); swing(R['fore_near'], 8)
        for i, tl in enumerate(R['tails']):
            tl.rotation_euler = (0, deg(40 + i * 18 + breath * 4), 0)
    elif kind == 'run':
        a = t * 2 * math.pi
        s = math.sin(a)
        R['root'].location.z = 0.08 * abs(math.cos(a)) - 0.04
        R['chest'].rotation_euler = (0, deg(12), 0)
        swing(R['thigh_near'], 40 * s)
        swing(R['thigh_far'], -40 * s)
        swing(R['shin_near'], -max(0, 70 * math.cos(a + 0.6)) - 10)
        swing(R['shin_far'], -max(0, -70 * math.cos(a + 0.6)) - 10)
        swing(R['upper_far'], 40 + 30 * s); swing(R['fore_far'], 60)
        swing(R['upper_near'], aim - 12); swing(R['fore_near'], 12)
        for i, tl in enumerate(R['tails']):
            tl.rotation_euler = (0, deg(8 + i * 12 + 8 * math.sin(a * 2 + i)), 0)
    elif kind == 'shoot':
        kick = [0, 1, 0.4][int(t * 3) % 3]
        swing(R['thigh_far'], -10); swing(R['thigh_near'], 14)
        swing(R['shin_near'], -6)
        R['chest'].rotation_euler = (0, deg(2 - kick * 5), 0)
        swing(R['upper_far'], 70); swing(R['fore_far'], 30)
        swing(R['upper_near'], aim + 4 * kick); swing(R['fore_near'], 0 + 12 * kick)
    elif kind == 'up':
        swing(R['thigh_far'], -6); swing(R['thigh_near'], 8)
        R['upper_near'].location = (0.3, -0.7, 0.8)
        swing(R['upper_near'], 165); swing(R['fore_near'], 8)
        swing(R['upper_far'], 150); swing(R['fore_far'], 20)
        R['neck'].rotation_euler = (0, deg(-15), 0)


def setup_camera():
    sc = bpy.context.scene
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = FH / 10  # 10 px per unit
    cam = bpy.data.objects.new('cam', cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    center = Vector((0, 0, FH / 20))
    az, el = deg(28), deg(12)
    d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    cam.location = center + d * 20
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
    # keep the feet on the bottom row: shift so world z=0 at the hip line lands at y=FH-1
    sc.render.resolution_x = FW * SCALE
    sc.render.resolution_y = FH * SCALE
    sc.render.film_transparent = True
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.render_aa = 'OFF'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'


def render(path, flat):
    sc = bpy.context.scene
    sh = sc.display.shading
    if flat:
        sh.light = 'FLAT'
        sh.color_type = 'MATERIAL'
        sh.show_shadows = False
        sh.show_cavity = False
    else:
        sh.light = 'STUDIO'
        sh.color_type = 'SINGLE'
        sh.single_color = (0.8, 0.8, 0.8)
        sh.show_shadows = False
        sh.show_cavity = False
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    a = args()
    os.makedirs(a.out, exist_ok=True)
    R = build()
    setup_camera()
    seqs = [('idle', 4), ('run', 8), ('shoot', 3), ('up', 1)]
    for kind, n in seqs:
        for i in range(n):
            pose(R, kind, i / n)
            bpy.context.view_layer.update()
            base = os.path.join(os.path.abspath(a.out), f'{kind}_{i}')
            render(base + '_id.png', True)
            render(base + '_lum.png', False)
            print('frame', kind, i)


main()
