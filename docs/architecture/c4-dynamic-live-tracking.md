# Live tracking flow

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

1. **Calibrate.** When the presenter starts tracking, the app averages a steady head pose for roughly a second and samples the resting mouth. A supported, enabled upper-body rig also establishes a reference pose. [Camera startup](../../app.js#L654) · [Neutral pose calibration](../../app.js#L737)
2. **Repeat.** The video callback runs face detection on fresh frames and samples pose less often when body tracking is enabled. The frame loop applies mirrored, neutral-relative head rotation and joint updates. Mouth tracking uses face landmarks and scores to select the texture. [Frame detection](../../app.js#L805) · [Animation loop](../../app.js#L866)
3. **Record on request.** The recording samples the rendered canvas and creates a downloadable clip when stopped. The clip contains the avatar view without webcam imagery or microphone audio. [Canvas capture](../../app.js#L898) · [Clip download](../../app.js#L956)
