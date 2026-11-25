# Browser studio components

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

| Part | Where to start |
| --- | --- |
| Load an avatar | [`loadModel`](../../app.js#L428) calls [`validateGlb`](../../glb.js#L33) before parsing. It mounts the scene, then selects a saved head node or looks for `Head` or `miiHead`. The node picker supports manual selection. |
| Track and render | [`detectFrame`](../../app.js#L805) samples the webcam. [`animate`](../../app.js#L866) smooths head rotation, applies body motion, and redraws the canvas when needed or while recording. [`frameAvatar`](../../app.js#L354) chooses the Full body fit or the Bust crop. |
| Animate the body | [`avatar-motion.js`](../../avatar-motion.js) maps pose landmarks to supported spine and arm joints. It can generate a torso and arms for compatible head-only Mii exports. |
| Animate the mouth | [`mouth-motion.js`](../../mouth-motion.js) uses blendshape scores and lip landmarks to select a mouth shape. It swaps part of a compatible Mii mask or uses a head-attached overlay. |
| Record a clip | [`startRecording`](../../app.js#L898) feeds the canvas stream to `MediaRecorder`. [`finishRecording`](../../app.js#L956) exposes the result as a local download. |

See [what happens in each live frame](c4-dynamic-live-tracking.md).
