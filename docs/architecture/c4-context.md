# MeeLive system context

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

The presenter transfers the GLB from Mii Creator to MeeLive by choosing a local file. MeeLive also accepts compatible GLBs from other sources. Webcam frames, avatar files, and canvas recordings are processed on the presenter's device. A public host delivers the studio files.

Next, see [where the code and data live](c4-containers.md).
