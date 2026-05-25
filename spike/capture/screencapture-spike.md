# screencapture output location spike

Date: 2026-05-25
Host: macOS 15.1.1

## Question

Capi currently invokes:

```sh
screencapture -i -U -J video -v -g /tmp/capi/<session>/<clip>.mov
```

Completed recordings are appearing in `~/Downloads` instead of the requested
session capture directory.

## Relevant docs

Local `man screencapture` / `screencapture -h`:

- `files`: where to save the screen capture, one file per screen.
- `-i`: interactive capture.
- `-J <style>`: starting style for interactive capture, including `video`.
- `-v`: capture video.
- `-V <seconds>`: limit video capture duration.
- `-U`: show interactive toolbar in interactive mode.
- `-u`: present UI after capture; files passed on the command line are ignored.
- `-p`: use default capture settings; files argument is ignored.

Apple's Screenshot UI docs say the toolbar Options menu has its own `Save to`
setting for screenshots and screen recordings. On this machine:

```sh
defaults read com.apple.screencapture
```

showed:

```text
location = "~/Downloads";
location-last = "~/Downloads";
target = file;
video = 1;
```

## Experiments

All commands were run from the repo root.

### Still image with explicit path

```sh
mkdir -p spike/capture
rm -f spike/capture/image.png
screencapture -x "$(pwd)/spike/capture/image.png"
stat -f '%N %z bytes' spike/capture/image.png
```

Result:

```text
spike/capture/image.png 4351545 bytes
```

Conclusion: explicit file paths are valid, and the spike directory is writable.

### Relative image path

```sh
rm -f spike/capture/relative-image.png
(cd spike/capture && screencapture -x relative-image.png && stat -f '%N %z bytes' relative-image.png)
```

Result:

```text
relative-image.png 1558946 bytes
```

Conclusion: relative paths are honored relative to the process cwd.

### Non-interactive video, no toolbar

```sh
rm -f spike/capture/main-display-video.mov
screencapture -x -m -V 1 -v "$(pwd)/spike/capture/main-display-video.mov"
stat -f '%N %z bytes' spike/capture/main-display-video.mov
```

Result:

```text
spike/capture/main-display-video.mov 285853 bytes
```

`file spike/capture/main-display-video.mov` reports a QuickTime movie.

Conclusion: non-interactive video can honor an explicit output path.

### Non-interactive rectangle video

```sh
rm -f spike/capture/rect-video.mov
screencapture -x -R 0,0,800,600 -V 1 -v "$(pwd)/spike/capture/rect-video.mov"
stat -f '%N %z bytes' spike/capture/rect-video.mov
```

Result:

```text
spike/capture/rect-video.mov 47174 bytes
```

`file spike/capture/rect-video.mov` reports a QuickTime movie.

Conclusion: a rectangle recording can be saved directly to the requested path
without the Screenshot toolbar.

### Non-interactive video with `-U`

```sh
rm -f spike/capture/video-no-interactive-toolbar.mov
screencapture -x -U -J video -V 1 -v "$(pwd)/spike/capture/video-no-interactive-toolbar.mov"
stat -f '%N %z bytes' spike/capture/video-no-interactive-toolbar.mov
```

Result:

```text
spike/capture/video-no-interactive-toolbar.mov 523511 bytes
```

`file spike/capture/video-no-interactive-toolbar.mov` reports a QuickTime movie.

Conclusion: `-U` alone is not enough to force the default Screenshot save
location when no interactive selection is required.

### Direct video stop behavior

Direct video capture prints:

```text
type any character (or ctrl-c) to stop screen recording
```

Feeding stdin stopped the recording and finalized a valid movie:

```sh
rm -f spike/capture/stdin-stop.mov
(sleep 2; printf q) | screencapture -x -m -v "$(pwd)/spike/capture/stdin-stop.mov"
stat -f '%N %z bytes' spike/capture/stdin-stop.mov
file spike/capture/stdin-stop.mov
```

Result:

```text
spike/capture/stdin-stop.mov 1143840 bytes
spike/capture/stdin-stop.mov: ISO Media, Apple QuickTime movie, Apple QuickTime (.MOV/QT)
```

Sending `SIGINT` or `SIGTERM` to the direct `screencapture` process also left
valid QuickTime movies in this spike, but stdin is the clearest mechanism
advertised by the command itself.

Conclusion: Capi can own the primary stop control by keeping the child process
stdin open and writing a character when the user clicks Stop. macOS may still
show a native menu bar stop affordance while recording, but that should be a
fallback or secondary escape hatch, not the product's primary stop interaction.

### Full current-style interactive toolbar command

```sh
rm -f spike/capture/interactive-toolbar-limited.mov
screencapture -i -U -J video -V 1 -v "$(pwd)/spike/capture/interactive-toolbar-limited.mov"
```

Result:

- The process was still waiting after five seconds.
- `-V 1` did not begin timing until after the interactive choice.
- After killing it, no target file existed.
- Recent `~/Downloads/Screen Recording *.mov` files existed from toolbar-driven
  recordings.

Conclusion: this command path delegates meaningful control to the interactive
Screenshot toolbar. Given this machine's `com.apple.screencapture location` is
`~/Downloads`, that matches the observed behavior.

## Current conclusion

The CLI `files` argument is honored when `screencapture` owns the capture target
directly, as shown by still images and non-interactive video recordings.

The Capi command includes `-i -U`, which opens the Screenshot toolbar. In that
toolbar path, the user's Screenshot `Save to` preference can win, producing
`~/Downloads/Screen Recording ... .mov` instead of the requested session file.
The existing adapter's "adopt recent system recording" fallback is compensating
for this behavior by copying from the configured/default Screenshot location.

## Product implication

The safest product direction is for Capi to own capture setup instead of
delegating setup to the macOS Screenshot toolbar. Capi should let the user choose
the capture target in Capi's own UI, then call `screencapture` in a direct mode
that writes to the session source path.

That changes capture from "open the native toolbar and wait for the result" to:

1. Capi shows capture setup controls.
2. The user chooses the display or region to record.
3. The user chooses simple capture options, such as microphone and click
   visibility.
4. The runtime translates those choices into deterministic `screencapture`
   arguments.
5. `screencapture` writes directly to `/tmp/capi/<session>/<clip>.mov`.
6. The user stops recording from Capi, and the runtime stops the active
   `screencapture` process through its stdin.

This preserves the native macOS recording engine while avoiding the global
Screenshot toolbar save location. The tradeoff is that Capi must provide the
pre-capture selection and in-app recording controls itself.

## Likely implementation options

1. Preferred direction: avoid `-i -U`, own setup in Capi, and use a direct
   target:

   ```sh
   screencapture -x -m -v /tmp/capi/<session>/<clip>.mov
   screencapture -x -D 1 -v /tmp/capi/<session>/<clip>.mov
   screencapture -x -D 2 -v /tmp/capi/<session>/<clip>.mov
   screencapture -x -R x,y,w,h -v /tmp/capi/<session>/<clip>.mov
   ```

   Add `-V seconds` only for fixed-duration captures.

2. If user-selected recording is required, test whether dropping `-U` but
   keeping interactive video is sufficient:

   ```sh
   screencapture -i -J video -v /tmp/capi/<session>/<clip>.mov
   ```

   This needs a manual UI run to verify the completed recording lands at the
   requested path.

3. If the Screenshot toolbar is required, there may not be a reliable way to
   force a per-invocation output path. The robust approaches are either:

   - keep adopting the newly-created `Screen Recording ... .mov` from the
     configured Screenshot location, then move/copy it into the session, or
   - temporarily change `com.apple.screencapture location` to the session
     directory before launching the toolbar and restore the previous value
     afterward. This is global user state and has race/cleanup risks.
