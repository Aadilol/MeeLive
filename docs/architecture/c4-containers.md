# MeeLive containers

```mermaid
C4Container
  title Containers for MeeLive

  Person(presenter, "Presenter", "Opens MeeLive and controls the avatar")

  System_Boundary(meelive, "MeeLive") {
    Container(studio, "Browser studio", "JavaScript and WebGL", "Loads avatars, tracks motion, and renders clips")
    Container(staticSite, "Static site", "HTTPS static hosting", "Serves the release bundle and response headers")
    ContainerDb(profile, "Saved avatar", "Browser IndexedDB", "Stores the last GLB and studio settings")
  }

  Rel(presenter, studio, "Loads a GLB and starts tracking", "Browser UI")
  Rel(studio, staticSite, "Loads the studio files and tracking models", "HTTPS")
  Rel(studio, profile, "Restores, saves, and clears the last avatar", "IndexedDB")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

- **Browser studio.** [index.html](../../index.html) defines the interface and the import map. [bootstrap.js](../../bootstrap.js) starts [app.js](../../app.js) and reports startup errors. Three.js, MediaPipe, and their worker and WASM files run on the device as part of the studio.
- **Static site.** [scripts/build.mjs](../../scripts/build.mjs) assembles the app, artwork, fonts, and dependencies in `dist/`. After loading the page, the studio fetches tracking models and other assets from the same origin as needed.
- **Saved avatar.** [app.js](../../app.js#L525) stores the last GLB, head node, front angle, framing, body-tracking setting, and mouth placement in IndexedDB. **Forget saved avatar** removes that copy and keeps the current model open for the visit. Clips are generated in memory and downloaded separately.

See the [browser components](c4-components-studio.md) and the [Vercel deployment](c4-deployment.md).
