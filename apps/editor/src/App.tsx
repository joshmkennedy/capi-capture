import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Calendar,
  Clock,
  Download,
  EllipsisVertical,
  FolderOpen,
  GripVertical,
  Loader2,
  Pause,
  Play,
  Plus,
  Scissors,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  Video,
  Volume2,
  VolumeX,
} from "lucide-react"
import { capiClient, capiClientMode } from "@/api/capiClient"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { createExportPayload } from "@/export/exportClient"
import { useTimelinePreview } from "@/preview/useTimelinePreview"
import type { Source } from "@/sources/sourceModel"
import type { Clip } from "@/timeline/clipModel"
import type { CaptureDisplay, CaptureSettings } from "../../node/shared/types"
import { clipLength, timelineEnd } from "@/timeline/clipModel"
import type { SessionSummary } from "../../node/shared/types"
import {
  applyClipDuration,
  clamp,
  MIN_CLIP_SECONDS,
  panClipSourceWindow,
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

type CaptureOptionsState =
  | { status: "idle"; displays: CaptureDisplay[] }
  | { status: "loading"; displays: CaptureDisplay[] }
  | { status: "ready"; displays: CaptureDisplay[] }
  | { status: "error"; displays: CaptureDisplay[]; message: string }

type AppRoute =
  | { view: "grid" }
  | { view: "editor"; sessionId: string | null }

const PIXELS_PER_SECOND = 44
const CLIP_COLORS = ["#d99f3d", "#4f9a9a", "#c46f5e", "#7a83c8"]
const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  target: "display",
  displayId: 1,
  microphone: true,
  showClicks: true,
}

function clipForSource(source: Source, index: number, options: { demoTrimmed?: boolean } = {}): Clip {
  const sourceStart = options.demoTrimmed ? (index === 0 ? 0.8 : index === 2 ? 0 : 1.2) : 0
  const sourceEnd = options.demoTrimmed
    ? Math.max(sourceStart + MIN_CLIP_SECONDS, source.duration - 1)
    : Math.max(0, source.duration)
  const timelineDuration = sourceEnd - sourceStart

  return {
    id: `clip-${index + 1}`,
    sourceId: source.id,
    sourceStart,
    sourceEnd,
    timelineStart: 0,
    timelineDuration,
    color: CLIP_COLORS[index % CLIP_COLORS.length],
  }
}

function clipsForSources(sources: Source[]) {
  return sequenceClips(
    sources.map((source, index) =>
      clipForSource(source, index, { demoTrimmed: capiClientMode !== "runtime" }),
    ),
  )
}

function parseAppRoute(): AppRoute {
  const { pathname, searchParams } = new URL(window.location.href)
  const sessionMatch = pathname.match(/^\/app\/sessions\/([^/]+)$/)

  if (pathname === "/app/sessions" || searchParams.get("view") === "grid") {
    return { view: "grid" }
  }

  if (sessionMatch) {
    return { view: "editor", sessionId: decodeURIComponent(sessionMatch[1]) }
  }

  const querySessionId = searchParams.get("sessionId")
  return { view: "editor", sessionId: querySessionId }
}

function sessionUrl(sessionId: string) {
  return `/app/sessions/${encodeURIComponent(sessionId)}`
}

function App() {
  const [route, setRoute] = useState<AppRoute>(() => parseAppRoute())

  const navigate = useCallback((url: string) => {
    window.history.pushState(null, "", url)
    setRoute(parseAppRoute())
  }, [])

  useEffect(() => {
    const handlePopState = () => setRoute(parseAppRoute())
    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [])

  if (route.view === "grid") {
    return <SessionGrid onOpenSession={(sessionId) => navigate(sessionUrl(sessionId))} />
  }

  return (
    <EditorView
      key={route.sessionId ?? "standalone"}
      sessionId={route.sessionId}
      onOpenSessions={() => navigate("/app/sessions")}
      onSessionDeleted={() => navigate("/app/sessions")}
    />
  )
}

function EditorView({
  sessionId,
  onOpenSessions,
  onSessionDeleted,
}: {
  sessionId: string | null
  onOpenSessions: () => void
  onSessionDeleted: () => void
}) {
  const [sources, setSources] = useState<Source[]>([])
  const [clips, setClips] = useState<Clip[]>([])
  const [activeClipId, setActiveClipId] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false)
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" })
  const [captureState, setCaptureState] = useState<CaptureState>({ status: "idle" })
  const [captureSettings, setCaptureSettings] = useState<CaptureSettings | null>(null)
  const [draftCaptureSettings, setDraftCaptureSettings] = useState<CaptureSettings>(
    DEFAULT_CAPTURE_SETTINGS,
  )
  const [captureOptionsState, setCaptureOptionsState] = useState<CaptureOptionsState>({
    status: "idle",
    displays: [],
  })
  const [captureDialogMode, setCaptureDialogMode] = useState<"record" | "settings">("settings")
  const [isCaptureDialogOpen, setIsCaptureDialogOpen] = useState(false)
  const [isPreviewMuted, setIsPreviewMuted] = useState(true)
  const [exportState, setExportState] = useState<ExportState>({ status: "idle" })
  const [deleteState, setDeleteState] = useState<"idle" | "deleting">("idle")
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const timelineScrollerRef = useRef<HTMLDivElement | null>(null)
  const clipsRef = useRef<Clip[]>([])
  const saveEditorStateRef = useRef<number | null>(null)
  const hasLoadedEditorStateRef = useRef(false)

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
  const panningClip =
    drag?.mode === "move" ? orderedClips.find((clip) => clip.id === drag.clipId) ?? null : null
  const presentationDuration = Math.max(...clips.map(timelineEnd), 0)
  const totalSeconds = Math.max(
    55,
    ...clips.map((clip) => clip.timelineStart + clipLength(clip) + 4),
  )
  const timelineWidth = totalSeconds * PIXELS_PER_SECOND

  const persistClips = useCallback((nextClips: Clip[]) => {
    clipsRef.current = nextClips
    if (capiClientMode !== "runtime" || !hasLoadedEditorStateRef.current) {
      return
    }

    if (saveEditorStateRef.current !== null) {
      window.clearTimeout(saveEditorStateRef.current)
    }

    saveEditorStateRef.current = window.setTimeout(() => {
      saveEditorStateRef.current = null
      void capiClient.saveSessionEditorState({ clips: sortClips(clipsRef.current) }, sessionId).catch(() => {
        // Editing can continue offline; the next successful change will retry persistence.
      })
    }, 100)
  }, [sessionId])

  const commitClips = useCallback((nextClips: Clip[] | ((current: Clip[]) => Clip[])) => {
    setClips((current) => {
      const resolvedClips = typeof nextClips === "function" ? nextClips(current) : nextClips
      persistClips(resolvedClips)
      return resolvedClips
    })
  }, [persistClips])

  const flushEditorState = useCallback(() => {
    if (capiClientMode !== "runtime" || !hasLoadedEditorStateRef.current) {
      return
    }

    if (saveEditorStateRef.current !== null) {
      window.clearTimeout(saveEditorStateRef.current)
      saveEditorStateRef.current = null
    }

    const clipsToSave = sortClips(clipsRef.current)
    if (navigator.sendBeacon) {
      const body = JSON.stringify({ state: { clips: clipsToSave } })
      const url = sessionId
        ? `/sessions/${encodeURIComponent(sessionId)}/editor-state`
        : "/session/editor-state"
      if (navigator.sendBeacon(url, new Blob([body], { type: "application/json" }))) {
        return
      }
    }

    void capiClient.saveSessionEditorState({ clips: clipsToSave }, sessionId).catch(() => undefined)
  }, [sessionId])

  useEffect(() => {
    let isCurrent = true
    hasLoadedEditorStateRef.current = false

    async function loadSources() {
      try {
        if (capiClientMode === "runtime" && sessionId) {
          await capiClient.openSession(sessionId)
        }

        const loadedSources = await capiClient.listSources()
        if (!isCurrent) return

        const editorState =
          capiClientMode === "runtime" ? await capiClient.getSessionEditorState(sessionId) : null
        if (!isCurrent) return

        const sourceIds = new Set(loadedSources.map((source) => source.id))
        const restoredClips = editorState?.clips.filter((clip) => sourceIds.has(clip.sourceId)) ?? []
        const loadedClips = restoredClips.length > 0 ? restoredClips : clipsForSources(loadedSources)
        clipsRef.current = loadedClips
        setSources(loadedSources)
        setClips(loadedClips)
        setActiveClipId(loadedClips[0]?.id ?? null)
        hasLoadedEditorStateRef.current = true
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
  }, [sessionId])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushEditorState()
      }
    }

    window.addEventListener("pagehide", flushEditorState)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      flushEditorState()
      window.removeEventListener("pagehide", flushEditorState)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [flushEditorState])

  useEffect(() => {
    let isCurrent = true

    async function loadCaptureSettings() {
      try {
        const settings = await capiClient.getCaptureSettings()
        if (!isCurrent || !settings) return

        setCaptureSettings(settings)
        setDraftCaptureSettings(settings)
      } catch (error) {
        if (!isCurrent) return

        setCaptureState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load capture settings.",
        })
      }
    }

    void loadCaptureSettings()

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
    commitClips((current) => applyClipDuration(sortClips(current), clipId, duration))
  }, [clips, commitClips])

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

    commitClips(() => {
      if (drag.mode === "move") {
        return panClipSourceWindow(drag.initialClips, drag.clipId, -deltaSeconds, sourceDurationForClip)
      }

      if (drag.mode === "trim-start") {
        return trimClipStart(drag.initialClips, drag.clipId, deltaSeconds)
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

    commitClips(sequenceClips(nextOrder))
  }

  function nudgeClip(clipId: string, amount: number) {
    commitClips((current) => panClipSourceWindow(sortClips(current), clipId, amount, sourceDurationForClip))
  }

  function jumpPreviewToTrim(edge: "start" | "end") {
    if (!activeClip) return
    setPreviewTime(edge === "start" ? activeClip.timelineStart : timelineEnd(activeClip))
  }

  async function performCapture(settings: CaptureSettings) {
    setCaptureState({ status: "capturing" })

    const source = await capiClient.startCapture(settings)

    setSources((current) => {
      const withoutDuplicate = current.filter((item) => item.id !== source.id)
      return [...withoutDuplicate, source]
    })
    commitClips((current) => {
      const nextClip = clipForSource(source, current.length)
      setActiveClipId(nextClip.id)
      return sequenceClips([...current, nextClip])
    })
    setCaptureState({ status: "idle" })
  }

  async function stopCapture() {
    await capiClient.stopCapture()
  }

  function handleCapture() {
    if (captureState.status === "capturing") {
      void stopCapture().catch((error) => {
        setCaptureState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not stop capture.",
        })
      })
      return
    }

    if (!captureSettings) {
      setDraftCaptureSettings(DEFAULT_CAPTURE_SETTINGS)
      setCaptureDialogMode("record")
      setIsCaptureDialogOpen(true)
      void loadCaptureOptions(DEFAULT_CAPTURE_SETTINGS)
      return
    }

    void performCapture(captureSettings).catch((error) => {
      setCaptureState({
        status: "error",
        message: error instanceof Error ? error.message : "Capture failed.",
      })
    })
  }

  function openCaptureSettings() {
    setDraftCaptureSettings(captureSettings ?? DEFAULT_CAPTURE_SETTINGS)
    setCaptureDialogMode("settings")
    setIsCaptureDialogOpen(true)
    void loadCaptureOptions(captureSettings ?? DEFAULT_CAPTURE_SETTINGS)
  }

  async function loadCaptureOptions(settings: CaptureSettings) {
    setCaptureOptionsState((current) => ({ status: "loading", displays: current.displays }))

    try {
      const options = await capiClient.listCaptureOptions()
      const displays = options.displays.length > 0 ? options.displays : [{ id: 1, name: "Display 1" }]
      const selectedDisplay = displays.some((display) => display.id === settings.displayId)
        ? settings.displayId
        : displays[0].id

      setDraftCaptureSettings((current) => ({
        ...current,
        target: "display",
        displayId: selectedDisplay,
      }))
      setCaptureOptionsState({ status: "ready", displays })
    } catch (error) {
      setCaptureOptionsState({
        status: "error",
        displays: [{ id: settings.displayId, name: `Display ${settings.displayId}` }],
        message: error instanceof Error ? error.message : "Could not load capture options.",
      })
    }
  }

  async function persistDraftCaptureSettings() {
    const savedSettings = await capiClient.saveCaptureSettings(draftCaptureSettings)
    setCaptureSettings(savedSettings)
    setDraftCaptureSettings(savedSettings)
    setIsCaptureDialogOpen(false)
    return savedSettings
  }

  function handleCaptureSettingsSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void persistDraftCaptureSettings()
      .then((settings) => {
        if (captureDialogMode === "record") {
          return performCapture(settings)
        }

        return undefined
      })
      .catch((error) => {
        setCaptureState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not save capture settings.",
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

  async function deleteCurrentSession() {
    if (!sessionId) {
      return
    }

    setDeleteState("deleting")
    try {
      await capiClient.deleteSession(sessionId)
      onSessionDeleted()
    } catch (error) {
      setDeleteState("idle")
      setIsDeleteDialogOpen(false)
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not delete session.",
      })
    }
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
                {capiClientMode === "runtime" && sessionId
                  ? `Session ${sessionId.slice(0, 8)}`
                  : capiClientMode === "runtime"
                    ? "Capi session"
                    : "Standalone editor, mock sources"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={capiClientMode !== "runtime"}
              onClick={onOpenSessions}
              title="Open sessions"
            >
              <FolderOpen />
              Sessions
            </Button>
            <Button
              variant="outline"
              disabled={capiClientMode !== "runtime" || !sessionId || deleteState === "deleting"}
              onClick={() => setIsDeleteDialogOpen(true)}
              title="Delete session"
            >
              {deleteState === "deleting" ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Delete
            </Button>
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
            <div className="inline-flex h-9 overflow-hidden rounded-md bg-secondary shadow-sm ring-1 ring-border">
              <Button
                variant="secondary"
                disabled={capiClientMode !== "runtime"}
                onClick={handleCapture}
                title={capiClientMode === "runtime" ? "Record source" : "Capture is available in a Capi session"}
                className="h-9 rounded-none shadow-none ring-0"
              >
                {captureState.status === "capturing" ? <Square /> : <Video />}
                {captureState.status === "capturing" ? "Stop" : "Record"}
              </Button>
              <Button
                variant="secondary"
                size="icon"
                disabled={capiClientMode !== "runtime" || captureState.status === "capturing"}
                onClick={openCaptureSettings}
                title="Capture settings"
                className="h-9 w-8 rounded-none border-l border-border/80 px-0 shadow-none ring-0"
              >
                <EllipsisVertical />
              </Button>
            </div>
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
                      muted={isPreviewMuted}
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
                  <div className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] items-center gap-2">
                    <Button variant="secondary" size="icon" onClick={togglePlayback} title={isPlaying ? "Pause" : "Play"}>
                      {isPlaying ? <Pause /> : <Play />}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setIsPreviewMuted((muted) => !muted)}
                      title={isPreviewMuted ? "Unmute preview" : "Mute preview"}
                    >
                      {isPreviewMuted ? <VolumeX /> : <Volume2 />}
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
                            timelineDuration: Number(clip.timelineDuration.toFixed(2)),
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
                  Drag blocks to pan source media. Drag edges to ripple trim.
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
                    const source = sourceForClip(clip)
                    const left = clip.timelineStart * PIXELS_PER_SECOND
                    const width = Math.max(clipLength(clip) * PIXELS_PER_SECOND, 32)
                    const top = 78
                    const isPanningClip = panningClip?.id === clip.id

                    return (
                      <div
                        key={clip.id}
                        className={cn(
                          "absolute h-11 cursor-grab select-none overflow-hidden rounded-md border shadow-sm active:cursor-grabbing",
                          activeClip?.id === clip.id
                            ? "z-10 border-primary ring-2 ring-primary/40"
                            : "border-black/30",
                          isPanningClip ? "opacity-0" : "opacity-100",
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
                          type="button"
                          className="absolute left-0 top-0 z-30 grid h-full w-5 cursor-ew-resize place-items-center rounded-l-md bg-black/45"
                          onPointerDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            beginDrag(event, clip, "trim-start")
                          }}
                          onClick={(event) => event.stopPropagation()}
                          title="Trim start"
                        >
                          <GripVertical className="size-3 text-white" />
                        </button>
                        <div className="relative z-10 flex h-full min-w-0 items-center gap-2 px-5 text-left text-xs font-semibold text-white">
                          <Play className="size-3 shrink-0" />
                          <span className="truncate">{source.file}</span>
                          <span className="ml-auto shrink-0 font-mono text-[11px]">
                            {seconds(clipLength(clip))}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="absolute right-0 top-0 z-30 grid h-full w-5 cursor-ew-resize place-items-center rounded-r-md bg-black/45"
                          onPointerDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            beginDrag(event, clip, "trim-end")
                          }}
                          onClick={(event) => event.stopPropagation()}
                          title="Trim end"
                        >
                          <GripVertical className="size-3 text-white" />
                        </button>
                      </div>
                    )
                  })}

                  {panningClip ? (
                    <PanningSourceOverlay
                      clip={panningClip}
                      source={sourceForClip(panningClip)}
                      pixelsPerSecond={PIXELS_PER_SECOND}
                    />
                  ) : null}
                </div>
              </div>
            </footer>
          </section>
        </section>
      </div>
      {isCaptureDialogOpen ? (
        <CaptureSettingsDialog
          mode={captureDialogMode}
          settings={draftCaptureSettings}
          optionsState={captureOptionsState}
          disabled={captureState.status === "capturing"}
          onChange={setDraftCaptureSettings}
          onCancel={() => setIsCaptureDialogOpen(false)}
          onSubmit={handleCaptureSettingsSubmit}
        />
      ) : null}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete session {sessionId?.slice(0, 8)} and all recorded videos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteState === "deleting"}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteState === "deleting"}
              onClick={(event) => {
                event.preventDefault()
                void deleteCurrentSession()
              }}
            >
              {deleteState === "deleting" ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

function SessionGrid({ onOpenSession }: { onOpenSession: (sessionId: string) => void }) {
  const [sessionsResponse, setSessionsResponse] = useState<{
    sessions: SessionSummary[]
    activeSessionId: string | null
    lastSessionId: string | null
  } | null>(null)
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" })
  const [busySessionId, setBusySessionId] = useState<string | null>(null)
  const [pendingDeleteSession, setPendingDeleteSession] = useState<SessionSummary | null>(null)

  const loadSessions = useCallback(async () => {
    setLoadState({ status: "loading" })
    try {
      const response = await capiClient.listSessions()
      setSessionsResponse(response)
      setLoadState({ status: "ready" })
    } catch (error) {
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not load sessions.",
      })
    }
  }, [])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  async function createSession() {
    setBusySessionId("new")
    try {
      const response = await capiClient.createSession()
      onOpenSession(response.session.id)
    } catch (error) {
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not create session.",
      })
    } finally {
      setBusySessionId(null)
    }
  }

  async function openSession(sessionId: string) {
    setBusySessionId(sessionId)
    try {
      const response = await capiClient.openSession(sessionId)
      onOpenSession(response.session.id)
    } catch (error) {
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not open session.",
      })
      setBusySessionId(null)
    }
  }

  async function deleteSession() {
    if (!pendingDeleteSession) {
      return
    }

    setBusySessionId(pendingDeleteSession.id)
    try {
      await capiClient.deleteSession(pendingDeleteSession.id)
      setPendingDeleteSession(null)
      await loadSessions()
    } catch (error) {
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not delete session.",
      })
    } finally {
      setBusySessionId(null)
    }
  }

  const sessions = sessionsResponse?.sessions ?? []

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-5">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary text-sm font-black text-primary-foreground">
              C
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-normal">Capi Sessions</h1>
              <p className="text-xs text-muted-foreground">
                {sessions.length} saved {sessions.length === 1 ? "session" : "sessions"}
              </p>
            </div>
          </div>
          <Button
            disabled={capiClientMode !== "runtime" || busySessionId !== null}
            onClick={createSession}
            title={capiClientMode === "runtime" ? "Create session" : "Sessions are available in a Capi runtime"}
          >
            {busySessionId === "new" ? <Loader2 className="animate-spin" /> : <Plus />}
            New Session
          </Button>
        </header>

        {loadState.status === "error" ? (
          <div className="mt-5 rounded-md border border-destructive/50 bg-card p-3 text-sm text-destructive">
            {loadState.message}
          </div>
        ) : null}

        {loadState.status === "loading" ? (
          <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
            Loading sessions...
          </div>
        ) : null}

        {loadState.status === "ready" && sessions.length === 0 ? (
          <div className="grid flex-1 place-items-center">
            <div className="max-w-sm text-center">
              <div className="text-sm font-medium">No sessions yet.</div>
              <p className="mt-2 text-sm text-muted-foreground">
                Create a session to start recording sources.
              </p>
            </div>
          </div>
        ) : null}

        {loadState.status === "ready" && sessions.length > 0 ? (
          <section className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 py-5">
            {sessions.map((session) => {
              const isActive = session.id === sessionsResponse?.activeSessionId
              const isLast = session.id === sessionsResponse?.lastSessionId
              const isBusy = busySessionId === session.id

              return (
                <Card
                  key={session.id}
                  className={cn(
                    "overflow-hidden",
                    isActive ? "border-primary ring-1 ring-primary/60" : null,
                  )}
                >
                  <div className="relative aspect-video overflow-hidden bg-muted">
                    <img
                      src={`/sessions/${encodeURIComponent(session.id)}/image`}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute left-3 top-3 flex gap-2">
                      {isActive ? <SessionBadge>Active</SessionBadge> : null}
                      {isLast ? <SessionBadge>Last</SessionBadge> : null}
                    </div>
                  </div>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-3">
                      <span className="truncate">Session {session.id.slice(0, 8)}</span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {session.id.slice(-6)}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-2 text-xs text-muted-foreground">
                      <SessionMeta icon={<Calendar className="size-3.5" />} label="Created" value={formatDate(session.createdAt)} />
                      <SessionMeta icon={<Clock className="size-3.5" />} label="Opened" value={formatDate(session.lastOpenedAt)} />
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <Button
                        className="w-full"
                        disabled={isBusy}
                        onClick={() => void openSession(session.id)}
                        title="Open session"
                      >
                        {isBusy ? <Loader2 className="animate-spin" /> : <FolderOpen />}
                        Open
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        disabled={isBusy}
                        onClick={() => setPendingDeleteSession(session)}
                        title="Delete session"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </section>
        ) : null}
      </div>
      <AlertDialog
        open={pendingDeleteSession !== null}
        onOpenChange={(open) => {
          if (!open && busySessionId === null) {
            setPendingDeleteSession(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete session {pendingDeleteSession?.id.slice(0, 8)} and all recorded videos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busySessionId !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={busySessionId !== null}
              onClick={(event) => {
                event.preventDefault()
                void deleteSession()
              }}
            >
              {busySessionId !== null ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

function SessionBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-primary/50 bg-background/85 px-2 py-1 text-[11px] font-semibold text-primary shadow-sm backdrop-blur">
      {children}
    </span>
  )
}

function SessionMeta({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="grid grid-cols-[auto_64px_minmax(0,1fr)] items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
      <span className="min-w-0 truncate text-right text-foreground">{value}</span>
    </div>
  )
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

function PanningSourceOverlay({
  clip,
  source,
  pixelsPerSecond,
}: {
  clip: Clip
  source: Source
  pixelsPerSecond: number
}) {
  const sourceDuration = Math.max(source.duration, clip.sourceEnd, MIN_CLIP_SECONDS)
  const sourceLeft = (clip.timelineStart - clip.sourceStart) * pixelsPerSecond
  const sourceWidth = sourceDuration * pixelsPerSecond
  const windowLeft = clip.timelineStart * pixelsPerSecond
  const windowWidth = Math.max(clipLength(clip) * pixelsPerSecond, 32)

  return (
    <div className="pointer-events-none absolute left-0 top-[72px] z-30 h-[60px]">
      <div
        className="absolute top-3 h-11 rounded-md border-2 shadow-lg"
        style={{
          left: sourceLeft,
          width: sourceWidth,
          minWidth: windowWidth,
          borderColor: clip.color,
          backgroundColor: clip.color,
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.24) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.18), rgba(0,0,0,0.28))",
          backgroundSize: `${pixelsPerSecond}px 100%, 100% 100%`,
          opacity: 0.78,
        }}
      >
        <div className="flex h-full min-w-0 items-center gap-2 px-5 text-xs font-semibold text-white">
          <Play className="size-3 shrink-0" />
          <span className="truncate">{source.file}</span>
          <span className="ml-auto shrink-0 font-mono text-[11px]">{seconds(sourceDuration)}</span>
        </div>
      </div>
      <div
        className="absolute top-1 z-10 h-[54px] rounded-md border-2 border-white bg-white/5 shadow-[0_0_0_1px_rgba(0,0,0,0.65),0_10px_24px_rgba(0,0,0,0.35)]"
        style={{
          left: windowLeft,
          width: windowWidth,
        }}
      />
    </div>
  )
}

function CaptureSettingsDialog({
  mode,
  settings,
  optionsState,
  disabled,
  onChange,
  onCancel,
  onSubmit,
}: {
  mode: "record" | "settings"
  settings: CaptureSettings
  optionsState: CaptureOptionsState
  disabled: boolean
  onChange: (settings: CaptureSettings) => void
  onCancel: () => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <form
        className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl"
        onSubmit={onSubmit}
      >
        <div className="mb-5">
          <h2 className="text-base font-semibold">
            {mode === "record" ? "Capture Settings" : "Update Capture Settings"}
          </h2>
        </div>

        <div className="space-y-4">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Screen</span>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              value={settings.displayId}
              disabled={disabled || optionsState.status === "loading"}
              onChange={(event) => onChange({
                ...settings,
                target: "display",
                displayId: Number(event.currentTarget.value),
              })}
            >
              {optionsState.status === "loading" && optionsState.displays.length === 0 ? (
                <option value={settings.displayId}>Loading displays...</option>
              ) : null}
              {optionsState.displays.map((display) => (
                <option key={display.id} value={display.id}>
                  {display.name}
                </option>
              ))}
            </select>
            {optionsState.status === "error" ? (
              <span className="text-xs text-destructive">{optionsState.message}</span>
            ) : null}
          </label>

          <label className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted p-3 text-sm">
            <span className="font-medium">Microphone</span>
            <input
              className="size-4 accent-primary"
              type="checkbox"
              checked={settings.microphone}
              onChange={(event) => onChange({ ...settings, microphone: event.currentTarget.checked })}
            />
          </label>

          <label className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted p-3 text-sm">
            <span className="font-medium">Show Clicks</span>
            <input
              className="size-4 accent-primary"
              type="checkbox"
              checked={settings.showClicks}
              onChange={(event) => onChange({ ...settings, showClicks: event.currentTarget.checked })}
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={disabled} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={disabled}>
            {mode === "record" ? "Save and Record" : "Save"}
          </Button>
        </div>
      </form>
    </div>
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
