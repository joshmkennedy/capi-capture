# Capi PRD

## Problem Statement

Makers often need to show proof of work quickly: a client feature that is ready
for review, several behavior options that need feedback, or a workflow that is
easier to explain by showing the screen than by writing a long message.

Generic screen recording tools capture video, but they make fast editing and
sharing feel heavier than the job requires. Professional editors are too broad
and too complex for this use case. Capi should help a user record a few focused
screen captures, trim them, arrange them into a simple timeline, and export a
shareable proof-of-work presentation with minimal ceremony.

The current prototype proves the editor and export path with mocked screen
captured `.mov` sources. The product now needs a clearer architecture so the
working proof of concept can grow into a local capture/edit/export tool without
collapsing runtime behavior, editor behavior, and domain concepts into one place.

## Solution

Capi will be a lightweight macOS-first tool for creating proof-of-work
presentations from screen captured `.mov` sources.

The user experience should stay simple:

1. The user chooses what to record, such as a display or focused region.
2. The user records screen captures.
3. The user stops recording from Capi when the focused work is complete.
4. Capi registers each completed recording as a source.
5. The browser editor shows available sources.
6. The user trims and arranges clips on a timeline.
7. The user previews the presentation.
8. The user exports a final shareable file.

The prototype will use a local Node runtime plus a browser editor. The local
runtime owns capture, source registration, source serving, session lifecycle,
and ffmpeg export. The browser editor owns preview, timeline interaction, trim
controls, source selection, and export initiation.

The editor must remain independently runnable during prototype development. A
developer should be able to run `cd apps/editor && npm run dev` and work against
mocked sources without starting the orchestrator. The full local app should run
through the root orchestrator command, `npm run capi`, which creates a session,
starts the editor server, mounts runtime routes, and opens the browser.

The boundary between these modes is an editor-facing `CapiClient` contract, not
the orchestrator implementation. The editor talks to a small API for listing
sources, starting capture, and exporting the current presentation. In standalone
mode that API is backed by mocked `.mov` sources. In runtime mode it is backed
by local HTTP routes such as `GET /sources`, `POST /captures`, and
`POST /export`.

Capture should remain a runtime responsibility, even though the editor is a
browser UI. Browser screen capture APIs are useful for browser-native sharing
and recording flows, but they do not match Capi's prototype architecture as the
primary capture path. Capi needs durable session sources that the runtime can
serve, inspect, register, and pass to ffmpeg export. A source should therefore
enter the system as a session-owned media file, not as an editor-owned browser
blob that later has to be uploaded, persisted, converted, or reconciled with the
runtime export pipeline.

Capi should not use Tauri or Electron. The browser editor is intentionally just
a browser editor served by the local runtime.

## User Stories

1. As a maker, I want to record my screen quickly, so that I can show recent work without setting up a complex video project.
2. As a maker, I want to capture one focused part of my workflow, so that my presentation stays concise.
3. As a maker, I want to record several separate captures, so that I can explain different parts of a feature in sequence.
4. As a maker, I want each completed capture to appear as a source, so that I can use it immediately in the editor.
5. As a maker, I want Capi to use native macOS screen capture, so that recording feels familiar and reliable.
6. As a maker, I want to choose which display or region Capi records before capture starts, so that the recording includes only the intended work.
7. As a maker, I want Capi to save each recording into the current session automatically, so that I do not have to find files in Downloads or Desktop.
8. As a maker, I want to stop recording from Capi, so that capture starts and ends in the same focused workflow.
9. As a maker, I want captured sources to remain unchanged, so that I can edit without damaging the original media.
10. As a maker, I want to see all sources for the current session, so that I can choose what belongs in the presentation.
11. As a maker, I want sources to show readable names, so that I can identify them quickly.
12. As a maker, I want sources to expose duration, so that I understand how much material I captured.
13. As a maker, I want to place part of a source on the timeline, so that I can include only the useful section.
14. As a maker, I want a clip to reference a source range, so that one source can be trimmed without changing the source itself.
15. As a maker, I want to trim the start of a clip, so that I can remove setup time.
16. As a maker, I want to trim the end of a clip, so that I can remove trailing noise.
17. As a maker, I want trims to respect minimum clip length, so that I do not accidentally create unusable clips.
18. As a maker, I want clips to sequence cleanly on the timeline, so that my presentation plays without confusing gaps.
19. As a maker, I want to reorder clips, so that I can tell the story in the right order.
20. As a maker, I want to nudge clip boundaries, so that I can adjust timing with small corrections.
21. As a maker, I want to preview the current timeline, so that I can verify the presentation before exporting.
22. As a maker, I want playback to move from clip to clip, so that preview reflects the exported result.
23. As a maker, I want the preview to show the correct source time for each clip, so that trims are easy to trust.
24. As a maker, I want to seek through the timeline, so that I can inspect specific moments.
25. As a maker, I want to jump to the start or end of the presentation, so that review is efficient.
26. As a maker, I want to see active clip details, so that I can understand what I am editing.
27. As a maker, I want to see source in and source out values, so that trim decisions are visible.
28. As a maker, I want to see timeline placement, so that I understand where a clip starts.
29. As a maker, I want to export the presentation, so that I can share it with a client, teammate, or stakeholder.
30. As a maker, I want export to stitch clips in timeline order, so that the final file matches my edit.
31. As a maker, I want export to re-encode for compatibility, so that the result plays reliably for recipients.
32. As a maker, I want export errors to be readable, so that I know what failed.
33. As a maker, I want a successful export to tell me where the file was saved, so that I can share it immediately.
34. As a maker, I want the current session to feel temporary, so that I can make quick presentations without managing projects.
35. As a maker, I want Capi to avoid professional editing jargon, so that the tool feels simple to learn.
36. As a maker, I want the interface to use terms like sources, clips, timeline, and presentation consistently, so that I build a correct mental model.
37. As a maker, I want mocked sources during prototype development, so that editor behavior can be improved before full capture integration exists.
38. As a developer, I want mocked sources behind the `CapiClient` boundary, so that real session sources can replace them later without changing editor components.
39. As a developer, I want sources and clips modeled separately, so that timeline edits do not corrupt source identity.
40. As a developer, I want the editor and runtime to share export contracts, so that payload drift does not break export.
41. As a developer, I want timeline behavior in a deep, testable module, so that trimming and sequencing can be changed safely.
42. As a developer, I want export planning separate from ffmpeg execution, so that validation can be tested without invoking external binaries.
43. As a developer, I want ffmpeg execution isolated behind a small boundary, so that external-process failure handling stays contained.
44. As a developer, I want the Vite config to mount runtime middleware without owning runtime implementation, so that the prototype can keep using Vite while preserving architecture.
45. As a developer, I want the local runtime to own capture setup, capture execution, stopping capture, and export, so that browser code does not learn about macOS processes or filesystem details.
46. As a developer, I want capture execution to write directly into the session capture directory, so that source registration does not depend on the user's global Screenshot save location.
47. As a developer, I want captured media to become a session-owned file before it is registered as a source, so that preview and export share the same source identity.
48. As a developer, I want the browser editor not to own raw captured blobs, so that large media lifecycle, crash recovery, and ffmpeg handoff stay in the runtime.
49. As a developer, I want the browser editor to own only editor interactions, so that UI changes do not affect capture and export internals.
50. As a developer, I want shared terminology documented, so that future agents and contributors name concepts consistently.
51. As a developer, I want a clear path from mocked sources to captured sources, so that the prototype can become useful without a rewrite.
52. As a developer, I want session lifecycle to be explicit, so that child processes and temporary files can be cleaned up correctly.
53. As a developer, I want source registration to be distinct from file watching, so that a completed `.mov` becomes available only after it is safe to edit.
54. As a developer, I want export output to be deterministic enough to debug, so that support issues can be traced from payload to file.
55. As a developer, I want runtime modules to expose small interfaces, so that tests can focus on behavior instead of internal helpers.
56. As a developer, I want architecture documentation to match the code, so that future implementation work does not restart the same decisions.

## Implementation Decisions

- Capi will use a local Node runtime with a browser editor.
- Capi will not use Tauri or Electron.
- The prototype remains macOS-first and depends on native macOS screen capture for real capture work.
- Capi should own capture setup rather than delegating setup to the macOS Screenshot toolbar.
- The user should choose the capture target in Capi, such as display or region, before recording starts.
- Runtime capture should call `screencapture` in a direct mode that honors an explicit session output path.
- Runtime capture should keep ownership of the active `screencapture` child process so Capi can stop recording from its own UI.
- Runtime capture should avoid the interactive Screenshot toolbar path when deterministic session output is required.
- Runtime capture must not depend on the user's global `com.apple.screencapture` save location for normal success.
- The browser Screen Capture API should not be the primary capture implementation for the prototype.
- Browser-produced `Blob` media should not be the primary source representation.
- A completed capture should become a session-owned file before source registration.
- Any browser capture spike must prove source persistence, metadata probing, preview serving, and ffmpeg export without weakening the runtime boundary.
- The browser editor will continue to use React and Vite.
- The runtime will own capture, source registration, source serving, session lifecycle, event delivery, and export.
- The editor will own source display, timeline interaction, preview playback, trim controls, reorder controls, and export initiation.
- A session is the top-level runtime concept for the prototype.
- A presentation is the assembled work that the user exports and shares.
- A source is an immutable screen captured `.mov` file.
- A clip is a timeline reference to a source range.
- A raw `.mov` file must not be modeled as a clip.
- Mocked `.mov` files are acceptable for the editor/export proof of concept.
- Mocked sources should be loaded through the editor-facing `CapiClient` boundary so runtime-backed sources can replace them later.
- The editor must not import orchestrator/session/capture implementations directly.
- The editor may choose between `mockCapiClient` and `runtimeCapiClient`, but editor components should depend only on the shared `CapiClient` interface.
- `mockCapiClient` keeps standalone editor development working with `apps/editor/mock-sources`.
- `runtimeCapiClient` talks to local runtime routes for session sources, capture, and export.
- Runtime source retrieval should be exposed through `GET /sources`.
- Runtime capture should be exposed through `POST /captures`.
- Runtime capture stop should be exposed through a runtime API rather than relying on the user to find the macOS menu bar stop control.
- The capture API may need to accept capture setup options, such as display ID, rectangle, microphone, and click visibility.
- Runtime export should be exposed through `POST /export`.
- Session source files should be served by the runtime through `/sessions/:sessionId/clips/:file`.
- Timeline behavior should be a deep editor module with a small interface for sequencing, trimming, finding clips by time, and applying source duration updates.
- Preview playback should be separated from the main editor component because it owns video element orchestration, source-time seeking, playback state, and clip transitions.
- Browser-side export should go through `CapiClient`; payload creation may remain a small editor helper, but the component should not know whether export is mocked or runtime-backed.
- Export payload types should be shared between editor and runtime.
- Runtime export should be split into planning and execution.
- Export planning should validate payloads, sort clips by timeline placement, resolve source paths, calculate durations, and choose output metadata.
- ffmpeg export should own external process execution, temporary trim files, concat list generation, stitching, output writing, and cleanup.
- The export route should own HTTP concerns: reading JSON, validating payload shape, invoking export, and returning JSON responses.
- Vite configuration may mount runtime middleware during the prototype, but runtime behavior should not live inside Vite configuration.
- Export should favor re-encoding trimmed clips for compatibility.
- Export should write a final presentation file to a local user-accessible destination during the prototype.
- The product language should stay simple and avoid professional editing terms that imply complexity.
- Branding assets and product language docs are part of the repo context and should guide future UI work.
- Documentation should remain concise and orientation-focused, with detailed behavior captured in tests and module interfaces.

## Capture Architecture

Capi should use native macOS `screencapture` directly through the local runtime.
The runtime should choose deterministic command modes from explicit capture
setup options and write the result into the active session capture directory.
Examples include recording a display, the main display, or a selected rectangle.

The current toolbar-driven path is not the desired end state. Commands that
delegate target selection to the interactive Screenshot toolbar can also
delegate output location to the user's global Screenshot settings. That creates
a product mismatch: Capi asks for a session source, but macOS may create a
`Screen Recording ... .mov` somewhere like Desktop or Downloads. Adopting that
recent system recording can be useful as a temporary compatibility bridge, but
it should not be the normal success path.

Capi should also own the primary stop interaction. Direct `screencapture` video
can be stopped through the command process itself, so the runtime should keep
the active process under session control and stop it when the user clicks Stop
in Capi. macOS may still show a native menu bar stop affordance during recording,
but that should be treated as a fallback rather than the intended product flow.

The browser editor may present capture setup controls and may call
`POST /captures`, but it should not perform primary capture with
`getDisplayMedia()` or store source media as browser-owned blobs. Browser
capture APIs require user selection through browser permission UI, cannot be
used to pre-limit all available capture choices, and produce media that must
still be reconciled with Capi's runtime-owned source model. Blob-first capture
would move large media lifecycle, persistence, metadata probing, and ffmpeg
handoff into the editor or into an upload bridge that the current product does
not otherwise need.

The source lifecycle should be:

1. The editor asks the user for simple setup choices, such as display or region.
2. The editor sends those choices to the runtime through `POST /captures`.
3. The runtime invokes direct native capture with an explicit session file path.
4. The editor sends a stop request when the user clicks Stop.
5. The runtime stops the active capture process and waits for the media file to finalize.
6. The runtime validates that the file exists and has media metadata.
7. The runtime registers the completed file as a source.
8. The editor receives the source through the same `CapiClient` contract used by mocked sources.

This keeps the product native where capture quality matters, web-based where
editing speed matters, and file-based where preview and export need stable media
identity.

## Testing Decisions

- Good tests should assert observable behavior at module boundaries, not implementation details.
- Tests should survive internal refactors of timeline, source, preview, and export internals.
- Timeline model tests should cover sequencing, clip length, timeline end calculation, finding the current clip at a time, finding the next clip, trim start, trim end, boundary movement, minimum clip length, and duration clamping.
- Source provider tests should cover stable source identity, title derivation, ordering, and `.mov` metadata assumptions where feasible.
- `CapiClient` adapter tests should cover standalone mock source loading, runtime source response parsing, capture response parsing, export response parsing, and error normalization.
- Export client tests should cover payload creation from sources and clips, missing source handling, response parsing, success output, and error normalization.
- Export planner tests should cover empty payload rejection, invalid source ranges, sorting by timeline start, source resolution, duration calculation, and output naming assumptions.
- ffmpeg exporter tests should avoid asserting internal command construction unless that command is the module contract. Prefer testing through an injected command runner or a local test double if the module is adjusted to support it.
- Export route tests should cover method rejection, invalid JSON, invalid payloads, successful export response, and runtime failure response.
- Preview behavior should be tested carefully because it depends on browser media APIs. Prefer integration or component tests around visible behavior if a browser test setup is introduced.
- Capture adapter tests should cover argument planning separately from process execution, including display, main-display, rectangle, and unsupported option cases.
- Capture route tests should cover setup payload parsing, one-active-capture enforcement, successful source registration, and readable capture failures.
- End-to-end verification for the prototype should confirm that mocked sources load, timeline preview works, trim/reorder controls still work, and export writes a presentation file.
- End-to-end capture verification should confirm that a direct native capture writes into the session capture directory and appears as a source without relying on Desktop or Downloads.
- The strongest early test investment is timeline behavior and export planning because those are pure or nearly pure domains with high regression risk.
- Existing prior art is minimal; new tests should establish the repo's testing style rather than conform to a large existing suite.

## Out of Scope

- Tauri integration.
- Electron integration.
- Cloud hosting.
- Multi-user collaboration.
- Saved and reopenable projects.
- A project file format.
- Non-macOS capture support.
- Imported non-capture media.
- Generated intros, outros, overlays, or camera layers.
- Delegating primary capture setup to the macOS Screenshot toolbar when it prevents deterministic session output.
- Browser `getDisplayMedia()` as the primary capture engine.
- Browser `Blob` storage as the primary source persistence model.
- Advanced professional editing concepts such as multitrack composition, keyframes, transitions, effects, color grading, or audio mixing.
- Publishing to external platforms.
- Account management.
- Long-term media asset library management.
- Full replacement of the current working editor UI.
- A complex monorepo or distributed web-app architecture.

## Further Notes

- Product and domain terms are defined in `docs/ubiquitous-language.md`.
- Agent-facing terminology guidance is mirrored in `AGENT.md`.
- The README documents the intended local-runtime/browser-editor architecture.
- Brand direction and visual references live under the brand assets directory.
