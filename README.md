# Capi

A prototype screen recording and editing tool for creating demos, walkthroughs, and guides using native macOS screen capture plus a browser-based editor.

## Overview

Capi combines a parent orchestration process with a Vite-powered React editor. The parent process launches native macOS screen recordings, watches for completed clips, sends clip updates to the editor, and exports the final timeline with ffmpeg.

Shared product and domain terms are defined in [docs/ubiquitous-language.md](docs/ubiquitous-language.md).

### Native capture

Uses `screencapture` to provide macOS-native recording UI.

### Browser editor

Uses Vite and React to preview, trim, arrange, and export clips.

### ffmpeg export

Trims and stitches clips into a single final video.

## Branding

Capi's brand direction is documented in [brand/brand-guide.html](brand/brand-guide.html). The guide defines the product mark, color palette, typography, component styling, and brand personality for the prototype.

Brand elements live in the `brand/` directory:

- [brand/brand-guide.html](brand/brand-guide.html) - visual brand system.
- [brand/logo.png](brand/logo.png) - app logo.
- [brand/favicon.png](brand/favicon.png) - favicon source.
- [brand/branding.png](brand/branding.png) - brand overview image.
- `brand/current*.png` - current interface screenshots and visual references.

## Prototype Architecture

### 1. Parent Process

The parent process is responsible for lifecycle management of the entire session.

```sh
npm run capi
```

- Create a session ID.
- Create a capture directory for the session.
- Start the editor web server.
- Start the WebSocket/API server.
- Start the filesystem watcher.
- Launch screen recording processes.
- Cleanly shut down child processes when the session ends.

```text
/tmp/capi/<session-id>/
```

### 2. Screen Capture

Screen recording uses the native macOS `screencapture` utility.

```sh
screencapture -i -U -Jvideo -v -g /tmp/capi/<session-id>/<clip-id>.mov
```

This provides:

- Native macOS recording UI.
- Interactive screen, window, or selection capture.
- Microphone audio capture.
- One recording per invocation.

```text
/tmp/capi/abc123/
  1.mov
  2.mov
  3.mov
```

### Recording Flow

1. User clicks Record.
2. Parent generates a new clip ID.
3. Parent launches `screencapture`.
4. User records.
5. `screencapture` exits.
6. Clip becomes available to the editor.

## Editor Web App

The editor is a Vite-based React application.

- Load recorded clips into the browser.
- Preview clips as normal video.
- Trim clip start and end.
- Place clips onto a master timeline.
- Adjust clip timestamps.
- Preview the composed timeline.
- Trigger export or publish.

The editor communicates with the backend via WebSocket for real-time clip updates and HTTP for export operations.

## Backend Server

The backend server supports the editor and export pipeline.

- Serve recorded clip files.
- Maintain WebSocket connections.
- Notify clients when new clips are added.
- Receive timeline export payloads.
- Execute ffmpeg export jobs.

```text
GET  /sessions/:sessionId/clips/:filename
WS   /events
POST /export
```

### Example Export Payload

```json
{
  "clips": [
    {
      "file": "1.mov",
      "sourceStart": 2.4,
      "sourceEnd": 18.7,
      "timelineStart": 0
    },
    {
      "file": "2.mov",
      "sourceStart": 0,
      "sourceEnd": 9.2,
      "timelineStart": 18.7
    }
  ]
}
```

## Watcher

A filesystem watcher monitors the session capture directory.

```text
/tmp/capi/<session-id>/
```

On new `.mov` files, the watcher should:

- Detect completed file writes.
- Register the clip.
- Notify connected editor clients.
- Make the clip immediately available for editing.

### Example WebSocket Event

```json
{
  "type": "clip-added",
  "clip": {
    "id": "2",
    "path": "/sessions/<session-id>/clips/2.mov"
  }
}
```

## Export Pipeline

When the user clicks Export or Publish:

1. The editor sends timeline metadata to the backend.
2. The backend trims source clips with ffmpeg.
3. The backend stitches clips into a single output.
4. The final video is written to disk.

```text
/tmp/capi/<session-id>/export.mp4
```

> Prototype export should favor re-encoding for compatibility instead of relying on concat-copy optimizations.

## Process Model

```text
Parent Process
|-- Editor Web Server (Vite)
|-- API/WebSocket Server
|-- Filesystem Watcher
`-- On-demand screencapture subprocesses
```

## Prototype Stack

- Node.js
- React
- Vite
- Express or Fastify
- WebSocket
- chokidar
- ffmpeg
- macOS screencapture

## Directory Structure

Capi should be organized as a local Node runtime with a browser editor, not as a traditional distributed frontend/backend app.

```text
capi-capture/
  README.md
  docs/
    ubiquitous-language.md

  brand/
    brand-guide.html
    logo.png
    favicon.png
    branding.png
    current*.png

  apps/
    node/
    main.ts
    session/
      SessionRuntime.ts
      sessionPaths.ts
      cleanup.ts

    capture/
      CaptureService.ts
      ScreencaptureAdapter.ts

    sources/
      SourceRegistry.ts
      SourceWatcher.ts
      sourceMetadata.ts

    timeline/
      Timeline.ts
      timelineSchemas.ts

    export/
      ExportPlanner.ts
      FfmpegExporter.ts

    server/
      httpServer.ts
      routes.ts
      eventSocket.ts

    events/
      DomainEvents.ts
      EventBus.ts

    shared/
      schemas.ts
      types.ts

    editor/
      index.html
      src/
        App.tsx
        api/
          client.ts
          events.ts
        sources/
          SourceList.tsx
        timeline/
          TimelineView.tsx
        export/
          ExportButton.tsx

    sketchybar/
      capi.sh
```

`apps/node/` owns the local runtime: macOS capture, temporary files, source watching, API routes, WebSocket events, and ffmpeg export. `apps/editor/` owns the browser editing experience. Shared schemas and types define the contract between them.

## Session Lifecycle

### Startup

- Parent process starts services.
- Browser editor opens.
- Session directory is created.

### Recording

- User records clips incrementally.
- Clips automatically appear in the editor timeline.

### Export

- Timeline is exported through ffmpeg.

### Shutdown

- Closing the editor ends the session.
- Child processes terminate.
- Temporary session files may be cleaned up.

## Prototype Status

Capi is a prototype. The current implementation targets macOS and depends on the native `screencapture` command.
