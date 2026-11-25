# MeeLive deployment security review

## Release status

The release build now restricts GLB imports to embedded resources, serves dependencies and tracking models locally, generates security headers, limits imported model complexity and recording size, and lets users forget saved avatars. The browser preview verified the policy with a rigged avatar, a synthetic camera feed, local face and pose models, clip creation, and saved avatar removal. Verify the final HTTPS host and physical camera permissions after deployment. See [deployment instructions](README.md#deploy-publicly).

## Original review

No critical or high-severity issue was confirmed in the original source review. The findings below describe the code before the release changes.

The [OpenAI security-best-practices skill](https://github.com/openai/skills/tree/main/skills/.curated/security-best-practices) fits this static, vanilla JavaScript app. The review covered the HTML entry point, asset loading, camera permissions, browser storage, recording, and pinned dependencies. It assumes a standalone static site at its own origin. A production URL or hosting configuration was unavailable for verification.

## Medium severity

### 1. GLB imports can cause outbound requests

[app.js, model import](app.js#L417) checks the filename extension before passing the file to `loader.parseAsync(await file.arrayBuffer(), '')` on [line 430](app.js#L430). The pinned Three.js loader resolves and fetches buffer and image URIs when the model references them. Opening a model from someone else can therefore make the viewer's browser contact a destination chosen by the file, exposing connection metadata and breaking the expectation that the avatar import stays local. This path does not itself send webcam frames or the entire GLB. [Three.js r177 buffer loading](https://github.com/mrdoob/three.js/blob/r177/examples/jsm/loaders/GLTFLoader.js#L2941) · [Three.js r177 image loading](https://github.com/mrdoob/three.js/blob/r177/examples/jsm/loaders/GLTFLoader.js#L3210)

**Fix before public launch.** Validate that the file is a GLB 2.0 container and that its buffers and textures are embedded before passing it to Three.js. Reject external and relative resource references. Keep the application's known decoder URLs separate from model-controlled resource loading. Test ordinary, Draco, Meshopt, and KTX2 imports after the change.

### 2. Remote scripts run with access to the page and its data

The import map loads Three.js from jsDelivr. The camera code dynamically loads MediaPipe JavaScript and WASM from the same CDN and downloads model files from Google Cloud Storage. Package versions are pinned, but executable dependencies are neither served from a reviewed local copy nor integrity-verified by the app. A compromised executable dependency could access webcam frames after permission is granted and read the saved avatar from the same-origin browser database. The code reviewed contains no intentional upload of either. [index.html, import map](index.html#L13) · [app.js, decoder dependencies](app.js#L19) · [app.js, face tracker imports](app.js#L545) · [app.js, browser storage](app.js#L508)

**Fix.** Prefer self-hosting reviewed, pinned JavaScript, WASM and ML model files. Record the versions and checksums, and keep dependency updates deliberate. Until then, use CSP to constrain script, worker and network destinations to the expected hosts and paths. An allowlist by itself cannot verify the code returned by a trusted host. [OpenAI frontend security guidance](https://github.com/openai/skills/blob/main/skills/.curated/security-best-practices/references/javascript-general-web-frontend-security.md)

### 3. Production security headers are unspecified

The project documents a loopback development server and contains no production hosting configuration or CSP. The HTML includes an inline import map and startup block. These will need hashes or another compatible script policy when CSP is enforced. The absence of host configuration in the repository does not establish which headers a future host will send. [README.md, local server](README.md#L10) · [index.html, import map](index.html#L13) · [index.html, startup script](index.html#L119)

**Fix before public launch.** Use an HTTPS static host, publish only the app files and assets, and keep `.git` and local files out of the web root. Deliver a CSP via HTTP headers with restricted script and network sources and `frame-ancestors 'none'` for the standalone studio. Set `Permissions-Policy: camera=(self), microphone=()` and `X-Content-Type-Options: nosniff`. Verify the actual response headers and exercise camera start and stop, model imports with compression, and recording under the policy. Avoid enabling unrestricted inline JavaScript or `unsafe-eval` to make the policy pass. [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP) · [Camera secure-context requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

## Low severity

### 4. Model loading and recording have no resource limit

The whole selected file is read into memory without a size limit. Recording appends each chunk to memory until the user stops. Large or complex models and long clips can consume significant browser memory and freeze or close the tab. This is a local availability risk. [app.js, file parsing](app.js#L430) · [app.js, recording chunks](app.js#L888)

**Fix.** Bound file size and decoded model complexity, and set a recording duration or accumulated-byte limit. Show a clear message when a limit is reached.

### 5. The last avatar persists in the browser profile

The app saves the entire selected file and associated settings to IndexedDB. It reloads the avatar on later visits from the same origin. Someone sharing that browser profile can see it. Clearing the site's data removes this saved copy. [app.js, saved avatar](app.js#L530) · [README.md, browser persistence](README.md#L38)

**Fix.** Disclose persistence where models are selected and provide a way to clear the saved avatar, especially if the app will be used on shared devices.

## Verification

- The reviewed camera path starts on user action, requests video with audio disabled, and stops the tracks on stop. Recording captures the avatar canvas and creates a local download URL. [app.js, camera start](app.js#L627) · [app.js, camera stop](app.js#L685) · [app.js, canvas capture](app.js#L883) · [app.js, local download](app.js#L924)
- Source review found no app backend, explicit media upload path, or use of HTML injection APIs for model filenames and node labels. Those labels use text APIs. [app.js, model labels](app.js#L481)
- All three JavaScript modules passed syntax checks. GitHub's reviewed advisory database returned zero results for `three@0.177.0` and `@mediapipe/tasks-vision@0.10.21`. That lookup covers those named package versions and is not an audit of every bundled decoder or browser component. [GitHub global advisory API](https://docs.github.com/en/rest/security-advisories/global-advisories#list-global-security-advisories)
- This was a source and dependency review. Production response headers, browser network behavior under a deployed policy, and webcam permissions on the final origin remain unverified.
