import { useEffect, useMemo, useRef, useState } from "react"
import type { Source } from "../sources/sourceModel"
import type { Clip } from "../timeline/clipModel"
import { timelineEnd } from "../timeline/clipModel"
import { clamp, findClipAtTime, findNextClip } from "../timeline/timelineModel"

type UseTimelinePreviewParams = {
  orderedClips: Clip[]
  presentationDuration: number
  sourceForClip: (clip: Clip) => Source
  updateClipDuration: (clipId: string, duration: number) => void
}

function otherSlot(slot: 0 | 1): 0 | 1 {
  return slot === 0 ? 1 : 0
}

function seekVideo(video: HTMLVideoElement, time: number) {
  if (Number.isFinite(time)) {
    try {
      video.currentTime = time
    } catch {
      // Some browsers reject seeks before media metadata is fully available.
    }
  }
}

export function useTimelinePreview({
  orderedClips,
  presentationDuration,
  sourceForClip,
  updateClipDuration,
}: UseTimelinePreviewParams) {
  const [previewTime, setPreviewTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [displayedPreviewSlot, setDisplayedPreviewSlot] = useState<0 | 1>(0)
  const [displayedPreviewPath, setDisplayedPreviewPath] = useState<string | null>(null)
  const [isPreviewSwitching, setIsPreviewSwitching] = useState(false)
  const previewVideoRefs = useRef<Array<HTMLVideoElement | null>>([null, null])
  const loadedPreviewPathsRef = useRef<Array<string | null>>([null, null])
  const latestPreviewSourceTimeRef = useRef(0)
  const lastFrameTimeRef = useRef<number | null>(null)

  const previewClip = useMemo(
    () => findClipAtTime(orderedClips, previewTime),
    [orderedClips, previewTime],
  )
  const previewSource = previewClip ? sourceForClip(previewClip) : null
  const previewSourceTime = previewClip
    ? previewClip.sourceStart + (previewTime - previewClip.timelineStart)
    : 0
  const nextPreviewClip = previewClip
    ? findNextClip(orderedClips, timelineEnd(previewClip) + 0.001)
    : findNextClip(orderedClips, previewTime)

  latestPreviewSourceTimeRef.current = previewSourceTime

  useEffect(() => {
    if (!previewClip) {
      previewVideoRefs.current.forEach((video) => video?.pause())
      setIsPreviewSwitching(false)
      return
    }

    if (previewSource && displayedPreviewPath === previewSource.path) {
      return
    }

    const targetSlot = otherSlot(displayedPreviewSlot)
    const targetVideo = previewVideoRefs.current[targetSlot]
    const displayedVideo = previewVideoRefs.current[displayedPreviewSlot]
    if (!targetVideo) return
    const preparedVideo = targetVideo
    const preparedClip = previewClip
    const preparedSource = sourceForClip(preparedClip)

    let cancelled = false
    setIsPreviewSwitching(true)
    displayedVideo?.pause()

    if (loadedPreviewPathsRef.current[targetSlot] !== preparedSource.path) {
      preparedVideo.src = preparedSource.path
      preparedVideo.preload = "auto"
      loadedPreviewPathsRef.current[targetSlot] = preparedSource.path
      preparedVideo.load()
    }

    function activatePreparedVideo() {
      if (cancelled) return

      seekVideo(preparedVideo, latestPreviewSourceTimeRef.current)
      setDisplayedPreviewSlot(targetSlot)
      setDisplayedPreviewPath(preparedSource.path)
      setIsPreviewSwitching(false)

      if (isPlaying) {
        void preparedVideo.play().catch(() => setIsPlaying(false))
      }
    }

    const handleMetadata = () => {
      updateClipDuration(preparedClip.id, preparedVideo.duration)
      seekVideo(preparedVideo, latestPreviewSourceTimeRef.current)
    }

    preparedVideo.addEventListener("loadedmetadata", handleMetadata, { once: true })
    preparedVideo.addEventListener("canplay", activatePreparedVideo, { once: true })

    if (preparedVideo.readyState >= 3) {
      activatePreparedVideo()
    } else if (preparedVideo.readyState >= 1) {
      seekVideo(preparedVideo, latestPreviewSourceTimeRef.current)
    }

    return () => {
      cancelled = true
      preparedVideo.removeEventListener("loadedmetadata", handleMetadata)
      preparedVideo.removeEventListener("canplay", activatePreparedVideo)
    }
  }, [
    displayedPreviewPath,
    displayedPreviewSlot,
    isPlaying,
    previewClip,
    previewSource,
    sourceForClip,
    updateClipDuration,
  ])

  useEffect(() => {
    if (!previewClip || !previewSource || displayedPreviewPath !== previewSource.path) {
      return
    }

    const video = previewVideoRefs.current[displayedPreviewSlot]
    if (!video) return

    if (Math.abs(video.currentTime - previewSourceTime) > 0.08) {
      seekVideo(video, previewSourceTime)
    }

    if (isPlaying && video.paused) {
      void video.play().catch(() => setIsPlaying(false))
    }

    if (!isPlaying && !video.paused) {
      video.pause()
    }
  }, [displayedPreviewPath, displayedPreviewSlot, isPlaying, previewClip, previewSource, previewSourceTime])

  useEffect(() => {
    const nextPreviewSource = nextPreviewClip ? sourceForClip(nextPreviewClip) : null
    if (
      !nextPreviewClip ||
      !nextPreviewSource ||
      isPreviewSwitching ||
      displayedPreviewPath === nextPreviewSource.path ||
      (previewSource && displayedPreviewPath !== previewSource.path)
    ) {
      return
    }

    const preloadSlot = otherSlot(displayedPreviewSlot)
    const video = previewVideoRefs.current[preloadSlot]
    if (!video || loadedPreviewPathsRef.current[preloadSlot] === nextPreviewSource.path) {
      return
    }

    video.src = nextPreviewSource.path
    video.preload = "auto"
    loadedPreviewPathsRef.current[preloadSlot] = nextPreviewSource.path
    video.load()
  }, [
    displayedPreviewPath,
    displayedPreviewSlot,
    isPreviewSwitching,
    nextPreviewClip,
    previewSource,
    sourceForClip,
  ])

  useEffect(() => {
    if (!isPlaying) {
      lastFrameTimeRef.current = null
      return
    }

    let frameId = 0

    function tick(frameTime: number) {
      const previousFrameTime = lastFrameTimeRef.current ?? frameTime
      const elapsedSeconds = (frameTime - previousFrameTime) / 1000
      lastFrameTimeRef.current = frameTime

      setPreviewTime((currentTime) => {
        const nextTime = currentTime + elapsedSeconds
        const nextClip = findClipAtTime(orderedClips, nextTime) ?? findNextClip(orderedClips, nextTime)

        if (nextTime >= presentationDuration || !nextClip) {
          setIsPlaying(false)
          return presentationDuration
        }

        return Math.max(nextTime, nextClip.timelineStart)
      })

      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [isPlaying, orderedClips, presentationDuration])

  useEffect(() => {
    if (previewTime > presentationDuration) {
      setPreviewTime(presentationDuration)
    }
  }, [presentationDuration, previewTime])

  function seekPreview(time: number) {
    setPreviewTime(clamp(time, 0, presentationDuration))
  }

  function togglePlayback() {
    if (isPlaying) {
      setIsPlaying(false)
      return
    }

    setPreviewTime((currentTime) => (currentTime >= presentationDuration ? 0 : currentTime))
    setIsPlaying(true)
  }

  return {
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
  }
}
