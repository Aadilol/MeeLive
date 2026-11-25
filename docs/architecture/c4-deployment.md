# Vercel deployment

```mermaid
C4Deployment
  title MeeLive production deployment target on Vercel

  Deployment_Node(vercel, "Vercel", "Build and static hosting", "Builds and serves the release") {
    Container(staticSite, "Static site", "dist directory and HTTPS", "Serves the studio with security headers")
  }

  Deployment_Node(device, "Presenter's device", "Webcam and local browser", "Runs the interactive studio") {
    Container(studio, "Browser studio", "JavaScript, WASM, and WebGL", "Tracks motion and renders the avatar")
    ContainerDb(profile, "Saved avatar", "Origin-scoped IndexedDB", "Stores one avatar and its settings")
  }

  Rel(studio, staticSite, "Loads the page, scripts, fonts, and models", "HTTPS")
  Rel(studio, profile, "Reads and writes avatar data", "IndexedDB")

  UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="2")
```

1. Vercel uses [`vercel.json`](../../vercel.json) to install the locked packages, run `npm run build`, and publish `dist/`.
2. [`scripts/build.mjs`](../../scripts/build.mjs) verifies the SHA-256 digests of the pinned MediaPipe models and upstream license. It copies the release files and checks that the import map matches the hash in the Content Security Policy. The same policy is emitted as `dist/_headers` for Cloudflare Pages and local preview.
3. The browser gets the app and its assets over HTTPS. The page asks for camera permission on **Start tracking**. Tracking, IndexedDB storage, and recording run on the presenter’s device.

This diagram shows the repository’s configured deployment target. See [deployment and local preview commands](../../README.md#deploy-publicly).
