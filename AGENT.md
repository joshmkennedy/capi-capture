# Agent Guidance

All agents working in this repository should use the Capi ubiquitous language
below when naming concepts, editing UI copy, writing code, or creating docs.

Source of truth: [docs/ubiquitous-language.md](docs/ubiquitous-language.md)

# Capi Ubiquitous Language

Capi is a simple tool for making proof-of-work presentations from screen captured
`.mov` sources. The product should feel fast and approachable, so domain language
should stay close to how users think about showing work, asking questions, and
sharing progress.

## Core Terms

### Session

An active runtime workspace created when Capi starts.

A session owns the session ID, capture directory, sources, timeline state, editor
connection, export jobs, child processes, and shutdown lifecycle.

Use `Session` for the current prototype. Reserve `Project` for a future saved and
reopenable artifact.

### Presentation

The thing the user is assembling and sharing.

A presentation is built from sources arranged on a timeline. It may be exported
as a video file, but the domain object is the presentation, not the video.

### Record

The user-facing action that starts screen recording.

Use `Record` for buttons, menu items, and ordinary UI text.

### Capture

The system action that invokes native macOS screen capture and produces one
source `.mov`.

Use `Capture` in code and system language when referring to the acquisition step.

### Source

A screen captured `.mov` file created during the session by macOS
`screencapture`.

A source is immutable session media. Timeline edits reference sources; they do
not edit source files directly.

For this prototype, sources are only screen captured `.mov` files. Imported or
generated media may become sources later, but they are outside the current scope.

### Timeline

The ordered editing surface for a presentation.

The timeline contains clips, determines playback order and timing, and is the
source of truth for export.

### Clip

A placed reference to a source range on the timeline.

A clip references a source and defines which part of that source is used and
where it starts on the timeline. A raw `.mov` file is not a clip.

### Trim

The selected start and end range of a source used by a clip.

### Placement

Where a clip starts on the timeline.

## Prototype Scope

Capi currently targets macOS and depends on the native `screencapture` command.
The prototype deals with screen captured `.mov` sources, a browser editor, a
parent orchestration process, a filesystem watcher, and an `ffmpeg` export
pipeline.

## Preferred Language

- Say `Record` in user-facing controls.
- Say `Capture` when describing the system process that creates a source.
- Say `Source` for the captured `.mov`.
- Say `Clip` only for an item on the timeline.
- Say `Presentation` for the assembled work.
- Say `Export` for producing the final shareable file.

## Terms To Avoid For Now

### Project

Avoid until Capi supports saved, reopenable work.

### Composition

Avoid because it makes the app feel like professional editing software and
suggests complexity beyond the prototype.

### Recording

Avoid as a core noun. It is understandable in casual speech, but `Source` better
describes how the captured file is used by the editor.

### Video

Avoid as the domain object. The exported file may be a video, but the user is
creating a presentation.
