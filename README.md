# MeeLive

MeeLive is a browser-based avatar studio that turns webcam motion into a live 3D avatar preview with optional clip recording. Avatar files, motion tracking, and recording stay on your device.

With Node.js 22 or newer, run `npm ci --ignore-scripts` followed by `npm run build` to create `dist/` (see the [usage and deployment guide](docs/usage-and-deployment.md)).

## System context

```mermaid
C4Context
  title System context for MeeLive

  Person(presenter, "Presenter", "Animates an avatar on their own device")
  System(meelive, "MeeLive", "Renders a live avatar and saves optional clips")
  System_Ext(creator, "Mii Creator", "Optional source of avatar GLB files")
  System_Ext(webcam, "Webcam", "Provides a live video feed")

  Rel(presenter, creator, "Creates and exports an avatar", "Web / GLB")
  Rel(presenter, meelive, "Selects an avatar and controls tracking", "Browser UI")
  Rel(meelive, webcam, "Requests video access", "getUserMedia")

  UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="1")
```

## Containers

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

## Browser studio components

```mermaid
C4Component
  title Components of the MeeLive browser studio

  Container_Boundary(studio, "Browser studio") {
    Component(controller, "Studio controller", "app.js", "Handles controls and the avatar lifecycle")
    Component(importer, "Model import", "glb.js and GLTFLoader", "Validates and loads self-contained GLBs")
    Component(storage, "Session persistence", "app.js and IndexedDB", "Restores, saves, and forgets the last avatar")
    Component(tracking, "Webcam tracking", "app.js and MediaPipe", "Calibrates and estimates face and pose motion")
    Component(body, "Body motion", "avatar-motion.js", "Finds or builds rigs and animates joints")
    Component(mouth, "Mouth motion", "mouth-motion.js", "Selects textures from webcam expression signals")
    Component(rendering, "Avatar rendering", "app.js and Three.js", "Frames, smooths, and draws the avatar")
    Component(recording, "Clip recording", "app.js and MediaRecorder", "Records the canvas as a downloadable clip")
  }

  Rel(controller, importer, "Validates and loads the selected file")
  Rel(controller, storage, "Restores and saves model settings")
  Rel(controller, tracking, "Starts, calibrates, and stops the webcam")
  Rel(importer, rendering, "Supplies the avatar scene graph")
  Rel(tracking, rendering, "Sets the head rotation target", "Quaternion")
  Rel(tracking, body, "Supplies upper-body landmarks")
  Rel(tracking, mouth, "Supplies face scores and landmarks")
  Rel(body, rendering, "Updates spine and arm joints")
  Rel(mouth, rendering, "Swaps the mask texture or overlay")
  Rel(recording, rendering, "Captures the avatar canvas", "MediaStream")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## Live tracking flow

```mermaid
C4Dynamic
  title Live tracking and clip capture in MeeLive

  Person(presenter, "Presenter", "Loads an avatar and starts tracking")
  System_Ext(webcam, "Webcam", "Produces video frames")
  Container_Boundary(studio, "Browser studio") {
    Component(controller, "Studio controller", "app.js", "Owns the webcam stream and calibration")
    Component(tracking, "Webcam tracking", "MediaPipe Tasks Vision", "Estimates face and optional upper-body motion")
    Component(rendering, "Avatar canvas", "Three.js", "Draws the current avatar pose")
    Component(recording, "Clip recorder", "MediaRecorder", "Encodes the canvas stream on request")
  }

  Rel(presenter, controller, "1. Starts tracking after loading a GLB", "Browser UI")
  Rel(controller, webcam, "2. Requests video access", "getUserMedia")
  Rel(webcam, tracking, "3. Provides frames through the video element", "MediaStream")
  Rel(tracking, rendering, "4. Updates the head, mouth, and available joints", "Pose and expression signals")
  Rel(rendering, recording, "5. Supplies rendered frames when recording", "Canvas MediaStream")
  Rel(recording, presenter, "6. Offers the finished clip for download", "WebM or MP4")

  UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="1")
```

## Vercel deployment

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
