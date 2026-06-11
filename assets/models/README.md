# Legacy Model Assets

Most model files here are legacy raw material from the previous gameplay scene.

The active gameplay scene currently uses:

```text
assets/models/gameplay/Road.glb
assets/models/gameplay/Tunnel.glb
assets/models/gameplay/Train.glb
```

The runtime scene uses optimized mobile copies:

```text
assets/models/gameplay/Road.mobile.glb
assets/models/gameplay/Tunnel.mobile.glb
assets/models/gameplay/Train.mobile.glb
```

Add new gameplay assets under `assets/models/gameplay/` and wire them through
the fresh loader in `src/components/gameplay/GlbModel.tsx`.
