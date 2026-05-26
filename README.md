
<style>
    :root {
      --bg: #0f1115;
      --panel: #171a21;
      --panel-2: #1f2430;
      --text: #eef1f6;
      --muted: #aab2c0;
      --border: #2b3140;
      --accent: #7aa2ff;
      --code-bg: #0a0c10;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: radial-gradient(circle at top, #1a2030 0, var(--bg) 42rem);
      color: var(--text);
      line-height: 1.6;
    }

    main {
      max-width: 960px;
      margin: 0 auto;
      padding: 48px 24px 80px;
    }

    header {
      margin-bottom: 40px;
      padding-bottom: 28px;
      border-bottom: 1px solid var(--border);
    }

    h1 {
      margin: 0 0 12px;
      font-size: clamp(2.5rem, 8vw, 5rem);
      line-height: 1;
      letter-spacing: -0.06em;
    }

    .subtitle {
      margin: 0;
      max-width: 720px;
      color: var(--muted);
      font-size: 1.1rem;
    }

    h2 {
      margin: 48px 0 16px;
      font-size: 1.75rem;
      letter-spacing: -0.03em;
    }

    h3 {
      margin: 28px 0 10px;
      font-size: 1.15rem;
    }

    p {
      margin: 0 0 16px;
    }

    ul, ol {
      margin: 0 0 20px;
      padding-left: 1.4rem;
    }

    li + li {
      margin-top: 6px;
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      color: #dce7ff;
      background: rgba(122, 162, 255, 0.12);
      padding: 0.15rem 0.35rem;
      border-radius: 6px;
    }

    pre {
      margin: 14px 0 24px;
      padding: 18px;
      overflow-x: auto;
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.18);
    }

    pre code {
      padding: 0;
      background: transparent;
      color: #e8edf8;
      border-radius: 0;
    }

    .card {
      margin: 20px 0;
      padding: 22px;
      background: linear-gradient(180deg, var(--panel), var(--panel-2));
      border: 1px solid var(--border);
      border-radius: 18px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin: 20px 0;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      margin: 4px 6px 4px 0;
      padding: 6px 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--muted);
      background: rgba(255,255,255,0.03);
      font-size: 0.92rem;
    }

    .note {
      border-left: 3px solid var(--accent);
      padding: 14px 16px;
      margin: 20px 0;
      background: rgba(122, 162, 255, 0.09);
      border-radius: 12px;
      color: #dfe7ff;
    }

    a {
      color: var(--accent);
    }

    footer {
      margin-top: 56px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-size: 0.95rem;
    }

  <main>
    <header>
      <h1>Capi</h1>
      <p class="subtitle">
        A prototype screen recording and editing tool for creating demos, walkthroughs,
        and guides using native macOS screen capture plus a browser-based editor.
      </p>
    </header>

    <section>
      <h2>Overview</h2>
      <p>
        Capi combines a parent orchestration process with a Vite-powered React editor.
        The parent process launches native macOS screen recordings, watches for completed
        clips, sends clip updates to the editor, and exports the final timeline with ffmpeg.
      </p>

      <p>
        Shared product and domain terms are defined in
        <a href="docs/ubiquitous-language.md">docs/ubiquitous-language.md</a>.
      </p>

      <div class="grid">
        <div class="card">
          <h3>Native capture</h3>
          <p>Uses <code>screencapture</code> to provide macOS-native recording UI.</p>
        </div>
        <div class="card">
          <h3>Browser editor</h3>
          <p>Uses Vite and React to preview, trim, arrange, and export clips.</p>
        </div>
        <div class="card">
          <h3>ffmpeg export</h3>
          <p>Trims and stitches clips into a single final video.</p>
        </div>
      </div>
    </section>

    <section>
      <h2>Branding</h2>
      <p>
        Capi's brand direction is documented in
        <a href="brand/brand-guide.html">brand/brand-guide.html</a>. The guide defines
        the product mark, color palette, typography, component styling, and brand
        personality for the prototype.
      </p>

      <p>Brand elements live in the <code>brand/</code> directory:</p>
      <ul>
        <li><a href="brand/brand-guide.html">brand/brand-guide.html</a> - visual brand system.</li>
        <li><a href="brand/logo.png">brand/logo.png</a> - app logo.</li>
        <li><a href="brand/favicon.png">brand/favicon.png</a> - favicon source.</li>
        <li><a href="brand/branding.png">brand/branding.png</a> - brand overview image.</li>
        <li><code>brand/current*.png</code> - current interface screenshots and visual references.</li>
      </ul>
    </section>

    <section>
      <h2>Prototype Architecture</h2>

      <h3>1. Parent Process</h3>
      <p>The parent process is responsible for lifecycle management of the entire session.</p>
      <pre><code>npm run capi</code></pre>
      <ul>
        <li>Create a session ID.</li>
        <li>Create a capture directory for the session.</li>
        <li>Start the editor web server.</li>
        <li>Start the WebSocket/API server.</li>
        <li>Start the filesystem watcher.</li>
        <li>Launch screen recording processes.</li>
        <li>Cleanly shut down child processes when the session ends.</li>
      </ul>

      <pre><code>/tmp/capi/&lt;session-id&gt;/</code></pre>

      <h3>2. Screen Capture</h3>
      <p>Screen recording uses the native macOS <code>screencapture</code> utility.</p>

      <pre><code>screencapture -i -U -Jvideo -v -g /tmp/capi/&lt;session-id&gt;/&lt;clip-id&gt;.mov</code></pre>

      <p>This provides:</p>
      <ul>
        <li>Native macOS recording UI.</li>
        <li>Interactive screen, window, or selection capture.</li>
        <li>Microphone audio capture.</li>
        <li>One recording per invocation.</li>
      </ul>

      <pre><code>/tmp/capi/abc123/
  1.mov
  2.mov
  3.mov</code></pre>

      <h3>Recording Flow</h3>
      <ol>
        <li>User clicks Record.</li>
        <li>Parent generates a new clip ID.</li>
        <li>Parent launches <code>screencapture</code>.</li>
        <li>User records.</li>
        <li><code>screencapture</code> exits.</li>
        <li>Clip becomes available to the editor.</li>
      </ol>
    </section>

    <section>
      <h2>Editor Web App</h2>
      <p>The editor is a Vite-based React application.</p>

      <ul>
        <li>Load recorded clips into the browser.</li>
        <li>Preview clips as normal video.</li>
        <li>Trim clip start and end.</li>
        <li>Place clips onto a master timeline.</li>
        <li>Adjust clip timestamps.</li>
        <li>Preview the composed timeline.</li>
        <li>Trigger export or publish.</li>
      </ul>

      <p>The editor communicates with the backend via WebSocket for real-time clip updates and HTTP for export operations.</p>
    </section>

    <section>
      <h2>Backend Server</h2>
      <p>The backend server supports the editor and export pipeline.</p>

      <ul>
        <li>Serve recorded clip files.</li>
        <li>Maintain WebSocket connections.</li>
        <li>Notify clients when new clips are added.</li>
        <li>Receive timeline export payloads.</li>
        <li>Execute ffmpeg export jobs.</li>
      </ul>

      <pre><code>GET  /sessions/:sessionId/clips/:filename
WS   /events
POST /export</code></pre>

      <h3>Example Export Payload</h3>
      <pre><code>{
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
}</code></pre>
    </section>

    <section>
      <h2>Watcher</h2>
      <p>A filesystem watcher monitors the session capture directory.</p>

      <pre><code>/tmp/capi/&lt;session-id&gt;/</code></pre>

      <p>On new <code>.mov</code> files, the watcher should:</p>
      <ul>
        <li>Detect completed file writes.</li>
        <li>Register the clip.</li>
        <li>Notify connected editor clients.</li>
        <li>Make the clip immediately available for editing.</li>
      </ul>

      <h3>Example WebSocket Event</h3>
      <pre><code>{
  "type": "clip-added",
  "clip": {
    "id": "2",
    "path": "/sessions/&lt;session-id&gt;/clips/2.mov"
  }
}</code></pre>
    </section>

    <section>
      <h2>Export Pipeline</h2>
      <p>When the user clicks Export or Publish:</p>
      <ol>
        <li>The editor sends timeline metadata to the backend.</li>
        <li>The backend trims source clips with ffmpeg.</li>
        <li>The backend stitches clips into a single output.</li>
        <li>The final video is written to disk.</li>
      </ol>

      <pre><code>/tmp/capi/&lt;session-id&gt;/export.mp4</code></pre>

      <div class="note">
        Prototype export should favor re-encoding for compatibility instead of relying on concat-copy optimizations.
      </div>
    </section>

    <section>
      <h2>Process Model</h2>
      <pre><code>Parent Process
├── Editor Web Server (Vite)
├── API/WebSocket Server
├── Filesystem Watcher
└── On-demand screencapture subprocesses</code></pre>
    </section>

    <section>
      <h2>Prototype Stack</h2>
      <div>
        <span class="pill">Node.js</span>
        <span class="pill">React</span>
        <span class="pill">Vite</span>
        <span class="pill">Express or Fastify</span>
        <span class="pill">WebSocket</span>
        <span class="pill">chokidar</span>
        <span class="pill">ffmpeg</span>
        <span class="pill">macOS screencapture</span>
      </div>
    </section>

    <section>
      <h2>Directory Structure</h2>
      <p>
        Capi should be organized as a local Node runtime with a browser editor,
        not as a traditional distributed frontend/backend app.
      </p>

      <pre><code>capi-capture/
  README.html
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
      capi.sh</code></pre>

      <p>
        <code>apps/node/</code> owns the local runtime: macOS capture, temporary files,
        source watching, API routes, WebSocket events, and ffmpeg export.
        <code>apps/editor/</code> owns the browser editing experience. Shared schemas
        and types define the contract between them.
      </p>
    </section>

    <section>
      <h2>Session Lifecycle</h2>

      <h3>Startup</h3>
      <ul>
        <li>Parent process starts services.</li>
        <li>Browser editor opens.</li>
        <li>Session directory is created.</li>
      </ul>

      <h3>Recording</h3>
      <ul>
        <li>User records clips incrementally.</li>
        <li>Clips automatically appear in the editor timeline.</li>
      </ul>

      <h3>Export</h3>
      <ul>
        <li>Timeline is exported through ffmpeg.</li>
      </ul>

      <h3>Shutdown</h3>
      <ul>
        <li>Closing the editor ends the session.</li>
        <li>Child processes terminate.</li>
        <li>Temporary session files may be cleaned up.</li>
      </ul>
    </section>

    <footer>
      Capi is a prototype. The current implementation targets macOS and depends on the native
      <code>screencapture</code> command.
    </footer>
  </main>
