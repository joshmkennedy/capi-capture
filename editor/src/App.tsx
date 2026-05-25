import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Download,
  GripVertical,
  Loader2,
  Pause,
  Play,
  Scissors,
  SkipBack,
  SkipForward,
  Video,
} from "lucide-react"
import { capiClient, capiClientMode } from "@/api/capiClient"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { createExportPayload } from "@/export/exportClient"
import { useTimelinePreview } from "@/preview/useTimelinePreview"
import type { Source } from "@/sources/sourceModel"
import type { Clip } from "@/timeline/clipModel"
import { clipLength, timelineEnd } from "@/timeline/clipModel"
import {
  applyClipDuration,
  clamp,
  findNextClip,
  MIN_CLIP_SECONDS,
  moveClipBoundary,
  seconds,
  sequenceClips,
  sortClips,
  trimClipEnd,
  trimClipStart,
  type DragState,
} from "@/timeline/timelineModel"

type ExportState =
  | { status: "idle" }
  | { status: "exporting" }
  | { status: "done"; message: string }
  | { status: "error"; message: string }

type LoadState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string }

type CaptureState =
  | { status: "idle" }
  | { status: "capturing" }
  | { status: "error"; message: string }

const PIXELS_PER_SECOND = 44
const CLIP_COLORS = ["#d99f3d", "#4f9a9a", "#c46f5e", "#7a83c8"]

function clipForSource(source: Source, index: number): Clip {
  const sourceStart = index === 0 ? 0.8 : index === 2 ? 0 : 1.2
  const sourceEnd = Math.max(sourceStart + MIN_CLIP_SECONDS, source.duration - 1)

  return {
    id: `clip-${index + 1}`,
    sourceId: source.id,
    sourceStart,
    sourceEnd,
    timelineStart: 0,
    color: CLIP_COLORS[index % CLIP_COLORS.length],
  }
}

function clipsForSources(sources: Source[]) {
  return sequenceClips(sources.map(clipForSource))
}

function App() {
  const [sources, setSources] = useState<Source[]>([])
  const [clips, setClips] = useState<Clip[]>([])
  const [activeClipId, setActiveClipId] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false)
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" })
  const [captureState, setCaptureState] = useState<CaptureState>({ status: "idle" })
  const [exportState, setExportState] = useState<ExportState>({ status: "idle" })
  const timelineScrollerRef = useRef<HTMLDivElement | null>(null)

  const sourcesById = useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources],
  )
  const sourceForClip = useCallback((clip: Clip) => {
    const source = sourcesById.get(clip.sourceId)
    if (!source) {
      throw new Error(`Source not found for clip ${clip.id}.`)
    }

    return source
  }, [sourcesById])
  const sourceDurationForClip = useCallback((clip: Clip) => sourceForClip(clip).duration, [sourceForClip])
  const activeClip = (activeClipId ? clips.find((clip) => clip.id === activeClipId) : null) ?? clips[0] ?? null
  const activeSource = activeClip ? sourceForClip(activeClip) : null
  const orderedClips = useMemo(() => sortClips(clips), [clips])
  const presentationDuration = Math.max(...clips.map(timelineEnd), 0)
  const totalSeconds = Math.max(
    55,
    ...clips.map((clip) => clip.timelineStart + clipLength(clip) + 4),
  )
  const timelineWidth = totalSeconds * PIXELS_PER_SECOND

  useEffect(() => {
    let isCurrent = true

    async function loadSources() {
      try {
        const loadedSources = await capiClient.listSources()
        if (!isCurrent) return

        const loadedClips = clipsForSources(loadedSources)
        setSources(loadedSources)
        setClips(loadedClips)
        setActiveClipId(loadedClips[0]?.id ?? null)
        setLoadState({ status: "ready" })
      } catch (error) {
        if (!isCurrent) return

        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load sources.",
        })
      }
    }

    void loadSources()

    return () => {
      isCurrent = false
    }
  }, [])

  const updateClipDuration = useCallback((clipId: string, duration: number) => {
    const clip = clips.find((item) => item.id === clipId)
    if (clip) {
      setSources((current) =>
        current.map((source) => (source.id === clip.sourceId ? { ...source, duration } : source)),
      )
    }
    setClips((current) => applyClipDuration(sortClips(current), clipId, duration))
  }, [clips])

  const {
    displayedPreviewSlot,
    isPlaying,
    isPreviewSwitching,
    loadedPreviewPathsRef,
    previewClip,
    previewSource,
    previewTime,
    previewVideoRefs,
    seekPreview,
    setIsPlaying,
    setPreviewTime,
    togglePlayback,
  } = useTimelinePreview({
    orderedClips,
    presentationDuration,
    sourceForClip,
    updateClipDuration,
  })
  const playheadLeft = Math.min(previewTime, totalSeconds) * PIXELS_PER_SECOND

  useEffect(() => {
    if (previewClip && activeClipId !== previewClip.id) {
      setActiveClipId(previewClip.id)
    }
  }, [activeClipId, previewClip])

  function beginDrag(
    event: React.PointerEvent,
    clip: Clip,
    mode: DragState["mode"],
  ) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setActiveClipId(clip.id)
    setPreviewTime(clip.timelineStart)
    setDrag({
      clipId: clip.id,
      mode,
      startX: event.clientX,
      initialClips: orderedClips,
    })
  }

  function updateDrag(event: React.PointerEvent) {
    if (!drag) return

    const deltaSeconds = (event.clientX - drag.startX) / PIXELS_PER_SECOND

    setClips(() => {
      if (drag.mode === "move") {
        return moveClipBoundary(drag.initialClips, drag.clipId, deltaSeconds, sourceDurationForClip)
      }

      if (drag.mode === "trim-start") {
        return trimClipStart(drag.initialClips, drag.clipId, deltaSeconds, sourceDurationForClip)
      }

      return trimClipEnd(drag.initialClips, drag.clipId, deltaSeconds, sourceDurationForClip)
    })
  }

  function getTimelinePointerTime(event: React.PointerEvent) {
    const scroller = timelineScrollerRef.current
    if (!scroller) return previewTime

    const rect = scroller.getBoundingClientRect()
    const pointerX = event.clientX - rect.left + scroller.scrollLeft

    return clamp(pointerX / PIXELS_PER_SECOND, 0, presentationDuration)
  }

  function beginPlayheadDrag(event: React.PointerEvent) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsPlaying(false)
    setIsDraggingPlayhead(true)
    seekPreview(getTimelinePointerTime(event))
  }

  function updatePlayheadDrag(event: React.PointerEvent) {
    if (!isDraggingPlayhead) return

    event.preventDefault()
    seekPreview(getTimelinePointerTime(event))
  }

  function endPlayheadDrag() {
    setIsDraggingPlayhead(false)
  }

  function reorderClip(clipId: string, direction: -1 | 1) {
    const index = orderedClips.findIndex((clip) => clip.id === clipId)
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= orderedClips.length) return

    const nextOrder = [...orderedClips]
    const [clip] = nextOrder.splice(index, 1)
    nextOrder.splice(targetIndex, 0, clip)

    setClips(sequenceClips(nextOrder))
  }

  function nudgeClip(clipId: string, amount: number) {
    setClips((current) => moveClipBoundary(sortClips(current), clipId, amount, sourceDurationForClip))
  }

  function jumpPreviewToTrim(edge: "start" | "end") {
    if (!activeClip) return
    setPreviewTime(edge === "start" ? activeClip.timelineStart : timelineEnd(activeClip))
  }

  async function performCapture() {
    setCaptureState({ status: "capturing" })

    const source = await capiClient.startCapture()

    setSources((current) => {
      const withoutDuplicate = current.filter((item) => item.id !== source.id)
      return [...withoutDuplicate, source]
    })
    setClips((current) => {
      const nextClip = clipForSource(source, current.length)
      setActiveClipId(nextClip.id)
      return sequenceClips([...current, nextClip])
    })
    setCaptureState({ status: "idle" })
  }

  function handleCapture() {
    void performCapture().catch((error) => {
      setCaptureState({
        status: "error",
        message: error instanceof Error ? error.message : "Capture failed.",
      })
    })
  }

  async function performExport() {
    setExportState({ status: "exporting" })

    const result = await capiClient.exportPresentation(createExportPayload(orderedClips, sourcesById))

    setExportState({
      status: "done",
      message: result.outputPath ? `Saved to ${result.outputPath}` : "Saved to Downloads.",
    })
  }

  function handleExport() {
    void performExport().catch((error) => {
      setExportState({
        status: "error",
        message: error instanceof Error ? error.message : "Export failed.",
      })
    })
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-5">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary text-sm font-black text-primary-foreground">
              C
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-normal">Capi Editor</h1>
              <p className="text-xs text-muted-foreground">
                {capiClientMode === "runtime" ? "Capi session" : "Standalone editor, mock sources"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden min-w-0 max-w-96 text-right text-xs text-muted-foreground md:block">
              {exportState.status === "done" || exportState.status === "error" ? (
                <span
                  className={cn(
                    "block truncate",
                    exportState.status === "error" ? "text-destructive" : "text-muted-foreground",
                  )}
                  title={exportState.message}
                >
                  {exportState.message}
                </span>
              ) : (
                <span>
                  {sources.length} sources
                  <span className="mx-2 inline-block h-4 w-px translate-y-1 bg-border" />
                  {seconds(totalSeconds)} timeline
                </span>
              )}
            </div>
            <Button
              disabled={exportState.status === "exporting" || orderedClips.length === 0}
              onClick={handleExport}
              title="Export presentation"
            >
              {exportState.status === "exporting" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Download />
              )}
              {exportState.status === "exporting" ? "Exporting" : "Export"}
            </Button>
            <Button
              variant="secondary"
              disabled={capiClientMode !== "runtime" || captureState.status === "capturing"}
              onClick={handleCapture}
              title={capiClientMode === "runtime" ? "Record source" : "Capture is available in a Capi session"}
            >
              {captureState.status === "capturing" ? <Loader2 className="animate-spin" /> : <Video />}
              {captureState.status === "capturing" ? "Recording" : "Record"}
            </Button>
          </div>
        </header>

        <section className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] overflow-hidden">
          <aside className="min-h-0 overflow-y-auto border-r border-border bg-card/50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Sources</h2>
              <span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
                .mov
              </span>
            </div>
            <div className="space-y-2">
              {loadState.status === "loading" ? (
                <div className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
                  Loading sources...
                </div>
              ) : null}
              {loadState.status === "error" ? (
                <div className="rounded-lg border border-destructive/50 bg-card p-3 text-sm text-destructive">
                  {loadState.message}
                </div>
              ) : null}
              {captureState.status === "error" ? (
                <div className="rounded-lg border border-destructive/50 bg-card p-3 text-sm text-destructive">
                  {captureState.message}
                </div>
              ) : null}
              {loadState.status === "ready" && orderedClips.length === 0 ? (
                <div className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
                  No sources yet.
                </div>
              ) : null}
              {orderedClips.map((clip, index) => {
                const source = sourceForClip(clip)

                return (
                  <button
                    key={clip.id}
                    className={cn(
                      "grid w-full grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                      activeClip?.id === clip.id
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:bg-secondary",
                    )}
                    onClick={() => {
                      setActiveClipId(clip.id)
                      seekPreview(clip.timelineStart)
                    }}
                  >
                    <span
                      className="h-full min-h-12 rounded-sm"
                      style={{ backgroundColor: clip.color }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{source.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {source.sourcePath}
                      </span>
                      <span className="mt-2 flex gap-2 text-xs text-muted-foreground">
                        <span>{seconds(clip.sourceStart)}</span>
                        <span>to</span>
                        <span>{seconds(clip.sourceEnd)}</span>
                      </span>
                    </span>
                    <span className="grid gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={index === 0}
                        onClick={(event) => {
                          event.stopPropagation()
                          reorderClip(clip.id, -1)
                        }}
                        title="Move earlier"
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={index === orderedClips.length - 1}
                        onClick={(event) => {
                          event.stopPropagation()
                          reorderClip(clip.id, 1)
                        }}
                        title="Move later"
                      >
                        <ArrowDown />
                      </Button>
                    </span>
                  </button>
                )
              })}
            </div>
          </aside>

          <section className="grid min-h-0 grid-rows-[minmax(0,1fr)_300px]">
            <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_300px] gap-4 overflow-hidden p-4">
              <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-border bg-black">
                <div className="relative h-full min-h-80 overflow-hidden bg-black">
                  {[0, 1].map((slot) => (
                    <video
                      key={slot}
                      ref={(element) => {
                        previewVideoRefs.current[slot] = element
                      }}
                      className={cn(
                        "absolute inset-0 h-full w-full bg-black object-contain transition-opacity duration-150",
                        displayedPreviewSlot === slot && previewClip
                          ? "opacity-100"
                          : "pointer-events-none opacity-0",
                      )}
                      playsInline
                      muted
                      preload="auto"
                      onLoadedMetadata={(event) => {
                        const loadedPath = loadedPreviewPathsRef.current[slot]
                        const loadedClip = orderedClips.find(
                          (clip) => sourceForClip(clip).path === loadedPath,
                        )
                        if (loadedClip) {
                          updateClipDuration(loadedClip.id, event.currentTarget.duration)
                        }
                      }}
                      onEnded={(event) => {
                        if (event.currentTarget !== previewVideoRefs.current[displayedPreviewSlot]) {
                          return
                        }

                        const nextClip = findNextClip(orderedClips, previewTime + 0.01)
                        if (!nextClip) {
                          setIsPlaying(false)
                          setPreviewTime(presentationDuration)
                          return
                        }

                        setPreviewTime(nextClip.timelineStart)
                      }}
                    />
                  ))}
                  {!previewClip ? (
                    <div className="absolute inset-0 grid place-items-center bg-black text-sm text-muted-foreground">
                      No clip at {seconds(previewTime)}
                    </div>
                  ) : null}
                  {isPreviewSwitching ? (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-primary/50" />
                  ) : null}
                </div>

                <div className="border-t border-border bg-[#111318] p-3">
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="font-mono text-foreground">{seconds(previewTime)}</span>
                    <span className="min-w-0 truncate">
                      {previewSource ? previewSource.title : "Timeline gap"}
                    </span>
                    <span className="font-mono">{seconds(presentationDuration)}</span>
                  </div>
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2">
                    <Button variant="secondary" size="icon" onClick={togglePlayback} title={isPlaying ? "Pause" : "Play"}>
                      {isPlaying ? <Pause /> : <Play />}
                    </Button>
                    <input
                      className="h-2 min-w-0 accent-primary"
                      type="range"
                      min={0}
                      max={Math.max(presentationDuration, MIN_CLIP_SECONDS)}
                      step={0.01}
                      value={previewTime}
                      onChange={(event) => seekPreview(Number(event.currentTarget.value))}
                      aria-label="Timeline position"
                    />
                    <Button variant="outline" size="icon" onClick={() => seekPreview(0)} title="Start">
                      <SkipBack />
                    </Button>
                    <Button variant="outline" size="icon" onClick={() => seekPreview(presentationDuration)} title="End">
                      <SkipForward />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="min-h-0 space-y-4 overflow-y-auto">
                <Card>
                  <CardHeader>
                    <CardTitle>Active Clip</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="truncate text-sm font-medium">{activeSource?.title ?? "No active clip"}</div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {activeSource?.sourcePath ?? "Load or record a source to begin."}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <Metric label="Source in" value={activeClip ? seconds(activeClip.sourceStart) : "--"} />
                      <Metric label="Source out" value={activeClip ? seconds(activeClip.sourceEnd) : "--"} />
                      <Metric label="Timeline" value={activeClip ? seconds(activeClip.timelineStart) : "--"} />
                      <Metric label="Length" value={activeClip ? seconds(clipLength(activeClip)) : "--"} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" size="sm" disabled={!activeClip} onClick={() => jumpPreviewToTrim("start")}>
                        <SkipBack />
                        In
                      </Button>
                      <Button variant="outline" size="sm" disabled={!activeClip} onClick={() => jumpPreviewToTrim("end")}>
                        <SkipForward />
                        Out
                      </Button>
                      <Button variant="secondary" size="sm" disabled={!activeClip} onClick={() => activeClip ? nudgeClip(activeClip.id, -0.5) : undefined}>
                        <ArrowLeft />
                        0.5s
                      </Button>
                      <Button variant="secondary" size="sm" disabled={!activeClip} onClick={() => activeClip ? nudgeClip(activeClip.id, 0.5) : undefined}>
                        <ArrowRight />
                        0.5s
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Editor State</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="max-h-60 overflow-auto rounded-md bg-[#0b0d11] p-3 text-xs text-muted-foreground">
                      {JSON.stringify(
                        {
                          clips: orderedClips.map((clip) => ({
                            file: sourceForClip(clip).file,
                            sourcePath: sourceForClip(clip).sourcePath,
                            sourceStart: Number(clip.sourceStart.toFixed(2)),
                            sourceEnd: Number(clip.sourceEnd.toFixed(2)),
                            timelineStart: Number(clip.timelineStart.toFixed(2)),
                          })),
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </CardContent>
                </Card>
              </div>
            </div>

            <footer className="min-w-0 border-t border-border bg-[#151820]">
              <div className="flex h-11 items-center justify-between border-b border-border px-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Scissors className="size-4 text-primary" />
                  Timeline
                </div>
                <div className="text-xs text-muted-foreground">
                  Drag blocks to change the previous cut. Drag edges to ripple trim.
                </div>
              </div>

              <div
                ref={timelineScrollerRef}
                className="h-[256px] overflow-auto"
                onPointerMove={(event) => {
                  updateDrag(event)
                  updatePlayheadDrag(event)
                }}
                onPointerUp={() => {
                  setDrag(null)
                  endPlayheadDrag()
                }}
                onPointerCancel={() => {
                  setDrag(null)
                  endPlayheadDrag()
                }}
              >
                <div className="relative h-full" style={{ width: timelineWidth }}>
                  <TimelineRuler seconds={totalSeconds} />
                  <div className="absolute left-0 right-0 top-12 h-px bg-border" />
                  <div className="absolute left-0 right-0 top-12 h-[96px] bg-[linear-gradient(to_right,rgba(255,255,255,0.055)_1px,transparent_1px)] bg-[length:44px_100%]" />
                  <div
                    className="absolute left-0 right-0 top-0 z-10 h-14 cursor-ew-resize"
                    onPointerDown={beginPlayheadDrag}
                    onPointerMove={updatePlayheadDrag}
                    onPointerUp={endPlayheadDrag}
                    onPointerCancel={endPlayheadDrag}
                    title="Seek timeline"
                  />
                  <div
                    className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-primary"
                    style={{ left: playheadLeft }}
                    role="slider"
                    aria-label="Timeline playhead"
                    aria-valuemin={0}
                    aria-valuemax={presentationDuration}
                    aria-valuenow={previewTime}
                    tabIndex={0}
                  >
                    <div className="absolute -left-2 top-10 h-0 w-0 border-x-8 border-t-8 border-x-transparent border-t-primary" />
                  </div>

                  {orderedClips.map((clip) => {
                    const left = clip.timelineStart * PIXELS_PER_SECOND
                    const width = Math.max(clipLength(clip) * PIXELS_PER_SECOND, 32)
                    const top = 78

                    return (
                      <div
                        key={clip.id}
                        className={cn(
                          "absolute h-11 cursor-grab select-none rounded-md border shadow-sm active:cursor-grabbing",
                          activeClip?.id === clip.id
                            ? "border-primary ring-2 ring-primary/40"
                            : "border-black/30",
                        )}
                        style={{
                          left,
                          top,
                          width,
                          backgroundColor: clip.color,
                        }}
                        onPointerDown={(event) => beginDrag(event, clip, "move")}
                        onClick={() => {
                          setActiveClipId(clip.id)
                          seekPreview(clip.timelineStart)
                        }}
                      >
                        <button
                          className="absolute left-0 top-0 flex h-full w-4 cursor-ew-resize items-center justify-center rounded-l-md bg-black/30"
                          onPointerDown={(event) => {
                            event.stopPropagation()
                            beginDrag(event, clip, "trim-start")
                          }}
                          title="Trim start"
                        >
                          <GripVertical className="size-3 text-white" />
                        </button>
                        <div className="flex h-full min-w-0 items-center gap-2 px-5 text-left text-xs font-semibold text-white">
                          <Play className="size-3 shrink-0" />
                          <span className="truncate">{sourceForClip(clip).file}</span>
                          <span className="ml-auto shrink-0 font-mono text-[11px]">
                            {seconds(clipLength(clip))}
                          </span>
                        </div>
                        <button
                          className="absolute right-0 top-0 flex h-full w-4 cursor-ew-resize items-center justify-center rounded-r-md bg-black/30"
                          onPointerDown={(event) => {
                            event.stopPropagation()
                            beginDrag(event, clip, "trim-end")
                          }}
                          title="Trim end"
                        >
                          <GripVertical className="size-3 text-white" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </footer>
          </section>
        </section>
      </div>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted p-3">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm text-foreground">{value}</div>
    </div>
  )
}

function TimelineRuler({ seconds: totalSeconds }: { seconds: number }) {
  const ticks = Array.from({ length: Math.ceil(totalSeconds / 5) + 1 }, (_, i) => i * 5)

  return (
    <div className="absolute left-0 top-0 h-12">
      {ticks.map((tick) => (
        <div
          key={tick}
          className="absolute top-0 h-12 border-l border-border pl-2 pt-3 text-xs text-muted-foreground"
          style={{ left: tick * PIXELS_PER_SECOND }}
        >
          {seconds(tick)}
        </div>
      ))}
    </div>
  )
}

export { App }
