# MeeLive

MeeLive animates a `.glb` avatar with your webcam and displays it in a resizable browser preview.

See the [C4 architecture](docs/architecture/c4-context.md) for the browser components, live tracking flow, and deployment.

## Run locally

Install Node.js 22 or newer. From this folder, build the static site and preview it on your machine.

```sh
npm ci --ignore-scripts
npm run build
npm run preview
```

On Windows, use `npm.cmd` if PowerShell blocks the npm script launcher. Open [the MeeLive studio](http://127.0.0.1:8000/). Use the same host and port each time to retain your saved avatar and settings. Building needs internet access the first time to fetch and verify dependencies. The built studio loads its scripts, fonts, and tracking models from the same site and processes webcam frames and avatars in your browser.

## Deploy publicly

### Vercel

Import the repository as a Vercel project. The included `vercel.json` selects the **Other** framework preset, runs the static build, publishes `dist/`, and applies the security headers. Use the HTTPS deployment URL Vercel provides, then check avatar import, camera start and stop, Full body, and clip download there. [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json)

### Cloudflare Pages

1. Run `npm ci --ignore-scripts`, `npm test`, and `npm run build`.
2. Use **Cloudflare Pages Direct Upload** to upload the generated `dist/` directory. For Git-based Pages builds, use `npm run build` as the build command and `dist` as the output directory, with Node.js 22 or newer. Use the HTTPS URL Pages provides. [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) · [Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/)
3. On the public URL, verify camera start and stop, avatar import, Full body, and clip download. Inspect the document response for the Content Security Policy and Permissions Policy from `dist/_headers`. On other hosts, configure those headers explicitly if the host does not read `_headers`.

Publish only `dist/`. It contains the app, bundled assets, and dependency licenses. npm downloads are pinned by the lockfile. The build verifies the SHA-256 of the two MediaPipe model files and their upstream license before copying them into the release.

## Load and track an avatar

1. Pick or drop a glTF 2.0 `.glb` of up to 64 MiB with self-contained meshes and textures. MeeLive looks for `Head` or `miiHead`, ignoring case. Use the node picker to choose a different head joint.
2. Drag the preview to orbit and scroll to zoom. MeeLive uses glTF’s +Z direction as the initial front. For a model facing a different direction, orbit to face it and click **Set front**. **Reset preview** returns to the saved angle and automatic crop.
3. Click **Start tracking**, grant the browser camera access, and hold a straight-ahead pose for about a second. The webcam thumbnail is mirrored. Turn left and right, nod, and tilt to check that the avatar follows. Use **Recalibrate** after shifting your resting position.
4. For a quick standalone clip, click **Start recording**, **Stop recording**, then **Download clip**. The clip contains the avatar canvas without microphone audio. Recordings have a five-minute limit and a 128 MiB memory limit. The browser selects the video format and controls whether the recording retains alpha.

### Mouth and upper body

- Compatible Mii models without a mouth show a neutral black line at rest. The line swaps to a moving mouth during tracking. Models with an existing mouth keep it at rest. Other GLBs can use an empty `Mouth` or `Lips` locator to position the neutral line and moving mouth automatically. Head-only Mii exports get a simple rigged torso and arms. [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker?tab=Web)
- If the model’s mouth has no detectable anchor, face the model toward the preview, choose **Place mouth**, and click the center of its existing mouth. Use **Move mouth** to override automatic placement. Adjust **Mouth size** while tracking is stopped. **Clear placement** restores automatic placement when available.
- Mouth tracking can show a closed smile, a frown, a rounded O-mouth, and small or wide openings. Relax your mouth to return to the resting shape.
- **Track upper body** is on by default for supported models. Sit upright while calibrating. Keep your shoulders in view for lean and tilt, and bring elbows and wrists into view to animate the arms. Occluded joints ease back to their idle pose. [MediaPipe Pose Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker?tab=Web)
- Imported full-body GLBs can use their own skinned spine and arm bones when they use recognizable names, for example `Spine_1`, `LeftArm`, `LeftForeArm`, and `LeftHand`. Other models continue to use head tracking.

## Framing and window view

- Choose **Bust** to crop below the shoulders or **Full body** to fit all available geometry. A head-only model or generated torso shows the parts it has in **Full body**.
- Resize the browser window to fit your recording area. The preview refits the selected framing after resizing.
- Click **Fill window** to show just the avatar and its blue background inside the resizable browser window. Press **Esc** or **F**, or double-click the preview, to restore the studio controls.

MeeLive saves the uploaded avatar, selected head node, front angle, upper-body setting, and framing in the browser profile. Click **Forget saved avatar** to clear the saved copy and keep using the current avatar until you leave the page.
