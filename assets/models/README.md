# 3D models (optional)

Cardio Surf works **out of the box** with hand-built primitive geometry. You don't need any of these models to run the app.

If you want a bigger visual jump, drop real CC0 GLB models in this folder. The app auto-detects them when enabled.

---

## Quick setup (5 minutes)

### Step 1 — Download Quaternius's Modular Train Pack

The Modular Train Pack by Quaternius is **CC0** (free for any use, no attribution needed) and available as GLB from Poly Pizza:

→ <https://poly.pizza/bundle/Modular-Train-Pack-jYEybkFVr1>

1. Open that link in your browser
2. Click **Download GLTF** (the button under "Just give me the Download")
3. You get a ZIP. Unzip it.
4. Find `Locomotive Passenger Carriage.glb` (or pick any train car from the pack that you like the look of)
5. Rename it to `train.glb`
6. Move it to: `assets/models/train.glb`

### Step 2 — Download a building pack

You have a few good options. Pick one:

**Option A — Quaternius Downtown City MegaKit** (300+ pieces, biggest visual upgrade)
→ <https://quaternius.com/packs/downtowncitymegakit.html>
Click **Download here**, unzip, then pick 4 building GLB files you like and rename them:
- `assets/models/buildingA.glb`
- `assets/models/buildingB.glb`
- `assets/models/buildingC.glb`
- `assets/models/buildingD.glb`

**Option B — Kenney City Kit (Commercial)** (simpler / lighter)
→ <https://kenney.nl/assets/city-kit-commercial>
Click **Download (Free)**, unzip, find the GLB folder, rename 4 building variants to the same names as Option A.

**Option C — Poly Pizza City Pack** (mix of authors)
→ <https://poly.pizza/bundle/City-Pack-kJqRAIGsw0>
Download GLTF, pick 4 buildings, rename as above.

### Step 3 — Enable models in code

Open [`src/lib/modelRegistry.ts`](../../src/lib/modelRegistry.ts) and do TWO things:

1. Uncomment the `ASSET_MAP` block (delete the `//` from each line, and delete the `const ASSET_MAP: Partial<...> = {};` line below it)
2. Change `export const MODELS_ENABLED = false;` to `export const MODELS_ENABLED = true;`

Save, then restart the dev server:

```bash
cd ~/Desktop/cardiosurf
npx expo start --clear
```

Real models will now appear everywhere a primitive train or building was before. If a specific GLB is missing, the app silently falls back to the primitive for that one — nothing breaks.

---

## Filenames the app looks for

```
assets/models/train.glb        ← used for every train obstacle (tinted per palette)
assets/models/buildingA.glb    ← skyline variant 1
assets/models/buildingB.glb    ← skyline variant 2
assets/models/buildingC.glb    ← skyline variant 3
assets/models/buildingD.glb    ← skyline variant 4
```

If you add more building variants, update [`src/lib/modelRegistry.ts`](../../src/lib/modelRegistry.ts) and the building chooser in [`src/components/scene/buildings.tsx`](../../src/components/scene/buildings.tsx).

## Tips

- **GLB scale** - Quaternius and Kenney models are usually 1 unit = 1 meter, same as our world. If a model looks tiny or huge, adjust the `scale` prop in `src/components/scene/models/TrainGLB.tsx` and `BuildingGLB.tsx`.
- **GLB orientation** - The train must face -Z (forward, away from camera). If it's facing the wrong way, add `rotation={[0, Math.PI, 0]}` in `TrainGLB.tsx`.
- **Performance** - Each loaded GLB is reused (cloned) for every instance, so loading 5 buildings doesn't mean 5 fetches.
- **License hygiene** - Stick to CC0 (Public Domain) so you can ship without attribution. Quaternius and Kenney are both CC0. Most Poly Pizza models are marked CC0 or CC-BY in their listing.
