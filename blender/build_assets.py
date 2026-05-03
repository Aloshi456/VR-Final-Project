"""
build_assets.py - Procedural Blender scene for VR Heist Simulator custom assets.

Run this inside Blender's scripting tab (or `blender --background --python build_assets.py`).
It constructs:
  1. vault_door.glb   - the heavy steel door with a wheel handle and rivets
  2. lockpick.glb     - L-shaped lockpick tool
  3. hacker.glb       - handheld hacking device with screen
  4. drill.glb        - power drill with bit

Each model is saved as .glb to the ../models/ folder so the WebXR project
picks them up automatically (see tools.js / scene.js GLTFLoader stubs).

This script also serves as Group 13's Procedural Generation advanced feature
(Category A): tweak the rivet count, door radius, or tool dimensions and
re-run to get a fresh asset set without touching the modeling UI.
"""

import bpy
import math
import os

# --------------------------------------------------------------------------
# Output directory: <project root>/models
#
# We resolve this by walking up from the .blend file (or Blender's CWD) until
# we find a folder that contains an "index.html" or "js/" - that's the project
# root. This way the script writes to the right /models folder regardless of
# whether the .blend was saved next to the script or inside the project root.
# --------------------------------------------------------------------------
def _find_project_root(start):
    cur = os.path.abspath(start)
    for _ in range(6):
        # Either index.html or js/ is a strong signal we're at the WebXR root
        if os.path.isfile(os.path.join(cur, "index.html")) or os.path.isdir(os.path.join(cur, "js")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    # Fallback: the script's own folder's parent (assumes /blender/build_assets.py)
    return os.path.dirname(start)

SCRIPT_DIR = os.path.dirname(bpy.data.filepath) if bpy.data.filepath else os.getcwd()
PROJECT_ROOT = _find_project_root(SCRIPT_DIR)
OUT_DIR = os.path.join(PROJECT_ROOT, "models")
os.makedirs(OUT_DIR, exist_ok=True)
print(f"[heist] writing GLBs to {OUT_DIR}")

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def reset_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes): bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials): bpy.data.materials.remove(block)

def make_material(name, color, metallic=0.0, roughness=0.5):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat

def export_selected(name):
    out = os.path.join(OUT_DIR, f"{name}.glb")
    bpy.ops.export_scene.gltf(
        filepath=out,
        use_selection=True,
        export_format='GLB',
        export_apply=True,
    )
    print(f"[heist] wrote {out}")

# --------------------------------------------------------------------------
# 1. Vault Door
# --------------------------------------------------------------------------
def build_vault_door():
    reset_scene()
    steel = make_material("Steel", (0.45, 0.45, 0.5), metallic=0.95, roughness=0.35)
    dark_steel = make_material("DarkSteel", (0.18, 0.18, 0.20), metallic=0.9, roughness=0.5)

    # Main slab
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    door = bpy.context.active_object
    door.scale = (1.0, 0.15, 1.3)
    door.name = "VaultDoor"
    door.data.materials.append(steel)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    # Bevel for nicer edges
    bpy.ops.object.modifier_add(type='BEVEL')
    door.modifiers["Bevel"].width = 0.02
    door.modifiers["Bevel"].segments = 3
    bpy.ops.object.modifier_apply(modifier="Bevel")

    # Rivets around the perimeter (procedural - tweak NUM_RIVETS)
    NUM_RIVETS = 16
    perimeter_pts = []
    for i in range(NUM_RIVETS):
        t = i / NUM_RIVETS * 2 * math.pi
        perimeter_pts.append((math.cos(t) * 0.85, 0.16, math.sin(t) * 1.15))

    for i, (x, y, z) in enumerate(perimeter_pts):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.04, depth=0.04, location=(x, y, z))
        rivet = bpy.context.active_object
        rivet.rotation_euler = (math.pi / 2, 0, 0)
        rivet.data.materials.append(dark_steel)
        rivet.parent = door

    # Wheel handle
    bpy.ops.mesh.primitive_torus_add(major_radius=0.32, minor_radius=0.05, location=(0, 0.2, 0))
    wheel = bpy.context.active_object
    wheel.rotation_euler = (math.pi / 2, 0, 0)
    wheel.data.materials.append(steel)
    wheel.parent = door

    # Two crossing spokes
    for rot_z in (0, math.pi / 2):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.025, depth=0.65, location=(0, 0.2, 0))
        s = bpy.context.active_object
        s.rotation_euler = (math.pi / 2, 0, rot_z)
        s.data.materials.append(steel)
        s.parent = door

    # Select everything for export
    bpy.ops.object.select_all(action='SELECT')
    export_selected("vault_door")

# --------------------------------------------------------------------------
# 2. Lockpick
# --------------------------------------------------------------------------
def build_lockpick():
    reset_scene()
    silver = make_material("Silver", (0.85, 0.85, 0.9), metallic=0.95, roughness=0.2)
    rubber = make_material("Rubber", (0.1, 0.1, 0.1), metallic=0.0, roughness=0.8)

    # Handle
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    h = bpy.context.active_object
    h.scale = (0.025, 0.025, 0.07)
    h.name = "Handle"
    h.data.materials.append(rubber)
    bpy.ops.object.transform_apply(scale=True)

    # Pin
    bpy.ops.mesh.primitive_cylinder_add(radius=0.0025, depth=0.1, location=(0, 0, 0.12))
    pin = bpy.context.active_object
    pin.data.materials.append(silver)

    # Bent tip
    bpy.ops.mesh.primitive_cylinder_add(radius=0.0025, depth=0.025, location=(0.012, 0, 0.18))
    tip = bpy.context.active_object
    tip.rotation_euler = (0, math.pi / 4, 0)
    tip.data.materials.append(silver)

    bpy.ops.object.select_all(action='SELECT')
    export_selected("lockpick")

# --------------------------------------------------------------------------
# 3. Hacker device
# --------------------------------------------------------------------------
def build_hacker():
    reset_scene()
    plastic = make_material("Plastic", (0.05, 0.05, 0.05), metallic=0.0, roughness=0.6)
    screen = make_material("Screen", (0.1, 1.0, 0.4), metallic=0.0, roughness=0.1)
    wire = make_material("Wire", (1.0, 0.1, 0.1), metallic=0.0, roughness=0.7)

    bpy.ops.mesh.primitive_cube_add(size=1)
    body = bpy.context.active_object
    body.scale = (0.1, 0.025, 0.16)
    body.data.materials.append(plastic)
    bpy.ops.object.transform_apply(scale=True)

    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0.013, 0.03))
    sc = bpy.context.active_object
    sc.scale = (0.07, 1, 0.05)
    sc.rotation_euler = (math.pi / 2, 0, 0)
    sc.data.materials.append(screen)
    bpy.ops.object.transform_apply(scale=True)

    bpy.ops.mesh.primitive_cylinder_add(radius=0.002, depth=0.08, location=(0, 0, 0.12))
    pr = bpy.context.active_object
    pr.data.materials.append(wire)

    bpy.ops.object.select_all(action='SELECT')
    export_selected("hacker")

# --------------------------------------------------------------------------
# 4. Drill
# --------------------------------------------------------------------------
def build_drill():
    reset_scene()
    orange = make_material("Orange", (0.9, 0.5, 0.1), metallic=0.3, roughness=0.5)
    grip = make_material("Grip", (0.1, 0.1, 0.1), metallic=0.0, roughness=0.8)
    chrome = make_material("Chrome", (0.85, 0.85, 0.85), metallic=1.0, roughness=0.15)

    # Main body
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    body = bpy.context.active_object
    body.scale = (0.07, 0.06, 0.18)
    body.data.materials.append(orange)
    bpy.ops.object.transform_apply(scale=True)

    # Grip
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.08, 0.02))
    g = bpy.context.active_object
    g.scale = (0.04, 0.12, 0.05)
    g.data.materials.append(grip)
    bpy.ops.object.transform_apply(scale=True)

    # Drill bit
    bpy.ops.mesh.primitive_cylinder_add(radius=0.008, depth=0.12, location=(0, 0, 0.18))
    bit = bpy.context.active_object
    bit.rotation_euler = (math.pi / 2, 0, 0)
    bit.data.materials.append(chrome)

    bpy.ops.object.select_all(action='SELECT')
    export_selected("drill")

# --------------------------------------------------------------------------
# Run all builders
# --------------------------------------------------------------------------
if __name__ == "__main__":
    build_vault_door()
    build_lockpick()
    build_hacker()
    build_drill()
    print("[heist] all assets exported to", OUT_DIR)
