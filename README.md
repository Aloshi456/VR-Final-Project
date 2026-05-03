# VR Heist Simulator

**ECE 376 - Project 2 - Group 13**
Team: Ryan, Alaa, George

A WebXR vault-cracking experience where the player uses a multi-tool inventory
to defeat a sequence of vault security stages, then physically grabs the loot
inside and drops it in a duffel bag.

---

## Run instructions

1. Open the `final project/` folder in VS Code.
2. Install the **Live Server** extension if you don't have it.
3. Right-click `index.html` -> **Open with Live Server**.
4. In the browser, click **ENTER VR** (Meta Quest or the
   [Immersive Web Emulator](https://chrome.google.com/webstore/detail/immersive-web-emulator/cgffilbpcibhmcfbgggfhfolhkfbhmik)
   Chrome extension).

### Desktop testing (no headset)
Use the keyboard while the page is focused:
- `T` - cycle through tools
- `U` - force-advance the vault stage (debug)
- `D` - toggle physics debug overlay
- `R` - reset

---

## Feature Mapping Table (Project 2 requirements)

| Requirement | Category | How it's implemented | File |
|---|---|---|---|
| Custom theme | Base | Vault heist - not a copy of any lab scene | `js/scene.js` |
| 2+ custom 3D assets | Base | Vault door + 3 tool models built procedurally in `build_assets.py`, exported as `.glb`, loaded via `GLTFLoader` | `blender/build_assets.py`, `js/tools.js` |
| 2+ core VR interactions | Base | (1) Grab + drop loot, (2) Aim + use tool on lock/keypad/bolt | `js/main.js`, `js/vault.js` |
| Cannon-ES Physics | **A** | Door swings on a `HingeConstraint`; loot uses dynamic rigid bodies with proper colliders | `js/scene.js`, `js/physics.js` |
| Multiple Object Types / Modes | **A** | Three distinct interactive tools (lockpick, hacker, drill), each only valid against its matching target | `js/tools.js`, `js/vault.js` |
| Custom Interaction System | **A** | 4-stage vault unlock state machine with held-trigger progress bars | `js/vault.js` |
| Procedural Generation (bonus) | **A** | `build_assets.py` is a Blender Python script; tweaking parameters regenerates the asset set | `blender/build_assets.py` |

3-person 376 group needs 3 advanced features, with at least 2 from Category A. We have **3 Category A features** + procedural generation as bonus, so we're comfortably over the bar.

---

## Code structure

```
final project/
  index.html         - HUD overlay + WebXR entry point
  style.css          - HUD styling
  js/
    main.js          - Three.js + WebXR setup, controller wiring, game loop
    scene.js         - Vault room, door, hinge, loot, lighting (Lab 1-3, 7 patterns)
    physics.js       - Cannon-ES <-> Three.js sync helper (Lab 7 pattern)
    tools.js         - Multi-tool inventory, grip-button cycling
    vault.js         - Unlock state machine + progress bars
  models/            - Drop .glb files here (vault_door.glb, lockpick.glb, hacker.glb, drill.glb)
  textures/          - Bake outputs from Blender (Lab 3)
  blender/
    build_assets.py  - Procedural asset script (Lab 2 pattern)
```

If a `.glb` is missing from `/models`, the corresponding tool/door falls back
to the procedural Three.js mesh, so the project always runs.

---

## Generating Blender models

Open Blender, switch to the **Scripting** workspace, open `blender/build_assets.py`, and click **Run Script**. Four `.glb` files will be written into `/models/`. Refresh the browser - the procedural fallbacks will be replaced with the real Blender meshes.

For higher visual quality, follow the Lab 3 baking workflow on each individual model before exporting (UV unwrap -> bake combined -> apply material -> export GLB).

---

## Individual contributions (proposal placeholder)

| Component | Lead |
|---|---|
| Blender modeling pipeline (`build_assets.py`, vault door, tools) | Alaa |
| WebXR scene + controller integration (`main.js`, `scene.js`) | Ryan |
| Physics + state machine + tool system (`physics.js`, `tools.js`, `vault.js`) | George |

Update this with the real division before submitting the written proposal.

---

## Lab lineage

| Lab | Used for |
|---|---|
| Lab 1-3 / HW 1-2 | Blender modeling, baking, GLB export pipeline |
| Lab 2 / HW 1 | Procedural Python `bpy` scene building (`build_assets.py`) |
| Lab 7 / HW 4 | Cannon-ES physics + GLTFLoader |
| Lab 8 / HW 4 | WebXR controller events, raycasting, attach/detach for grab |

---

## Known TODOs / next iteration

- [ ] Bake textures on the vault door for warm wear-and-tear look (Lab 3)
- [ ] Add a 360-degree skybox outside the antechamber window (Lab 5) - would push us into Category B
- [ ] Add controller haptics on tool-progress and on door-open
- [ ] Spatial audio: lockpick clicks, drill whine, vault thunk
- [ ] Win-screen UI (currently just changes the HUD objective text)
