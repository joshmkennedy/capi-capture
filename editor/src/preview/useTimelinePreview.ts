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

function clipAfter<T extends Clip>(clips: T[], clip: T) {
  const index = clips.findIndex((item) => item.id === clip.id)
  return index >= 0 ? clips[index + 1] ?? null : null
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
  const slotClipIdsRef = useRef<Array<string | null>>([null, null])
  const slotTokensRef = useRef([0, 0])
  const tokenCounterRef = useRef(0)
  const activeRequestRef = useRef<{ clipId: string; slot: 0 | 1; token: number } | null>(null)
  const latestPreviewSourceTimeRef = useRef(0)
  const lastGapFrameTimeRef = useRef<number | null>(null)

  const previewClip = useMemo(
    () => findClipAtTime(orderedClips, previewTime),
    [orderedClips, previewTime],
  )
  const previewSource = previewClip ? sourceForClip(previewClip) : null
  const previewSourceTime = previewClip
    ? previewClip.sourceStart + (previewTime - previewClip.timelineStart)
    : 0
  const nextPreviewClip = previewClip
    ? clipAfter(orderedClips, previewClip)
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

    const existingSlot = slotClipIdsRef.current.findIndex((clipId) => clipId === previewClip.id)
    const targetSlot = existingSlot === 0 || existingSlot === 1
      ? existingSlot
      : otherSlot(displayedPreviewSlot)
    const targetVideo = previewVideoRefs.current[targetSlot]
    const displayedVideo = previewVideoRefs.current[displayedPreviewSlot]
    if (!targetVideo) return
    const preparedVideo = targetVideo
    const preparedClip = previewClip
    const preparedSource = sourceForClip(preparedClip)
    const preparedSourceTime = latestPreviewSourceTimeRef.current
    const token = tokenCounterRef.current + 1
    tokenCounterRef.current = token
    slotTokensRef.current[targetSlot] = token
    slotClipIdsRef.current[targetSlot] = preparedClip.id
    activeRequestRef.current = { clipId: preparedClip.id, slot: targetSlot, token }

    let cancelled = false
    let seekRequested = false
    setIsPreviewSwitching(true)
    if (targetSlot !== displayedPreviewSlot) {
      displayedVideo?.pause()
    }

    if (loadedPreviewPathsRef.current[targetSlot] !== preparedSource.path) {
      preparedVideo.src = preparedSource.path
      preparedVideo.preload = "auto"
      loadedPreviewPathsRef.current[targetSlot] = preparedSource.path
      preparedVideo.load()
    }

    function isCurrentRequest() {
      const request = activeRequestRef.current
      return (
        !cancelled &&
        request?.clipId === preparedClip.id &&
        request.slot === targetSlot &&
        request.token === token &&
        slotTokensRef.current[targetSlot] === token
      )
    }

    function isAtPreparedTime() {
      return Math.abs(preparedVideo.currentTime - preparedSourceTime) <= 0.08
    }

    function activatePreparedVideo() {
      if (!isCurrentRequest() || preparedVideo.readyState < 2) return

      if (!isAtPreparedTime()) {
        if (preparedVideo.readyState >= 1 && !seekRequested) {
          seekRequested = true
          seekVideo(preparedVideo, preparedSourceTime)
        }
        return
      }

      setDisplayedPreviewSlot(targetSlot)
      setDisplayedPreviewPath(preparedSource.path)
      setIsPreviewSwitching(false)

      if (isPlaying) {
        void preparedVideo.play().catch(() => setIsPlaying(false))
      }
    }

    const handleMetadata = () => {
      if (!isCurrentRequest()) return
      updateClipDuration(preparedClip.id, preparedVideo.duration)
      if (!isAtPreparedTime() && !seekRequested) {
        seekRequested = true
        seekVideo(preparedVideo, preparedSourceTime)
      }
      activatePreparedVideo()
    }

    preparedVideo.addEventListener("loadedmetadata", handleMetadata, { once: true })
    preparedVideo.addEventListener("loadeddata", activatePreparedVideo)
    preparedVideo.addEventListener("canplay", activatePreparedVideo, { once: true })
    preparedVideo.addEventListener("seeked", activatePreparedVideo)

    if (preparedVideo.readyState >= 2) {
      activatePreparedVideo()
    } else if (preparedVideo.readyState >= 1) {
      seekVideo(preparedVideo, latestPreviewSourceTimeRef.current)
    }

    return () => {
      cancelled = true
      preparedVideo.removeEventListener("loadedmetadata", handleMetadata)
      preparedVideo.removeEventListener("loadeddata", activatePreparedVideo)
      preparedVideo.removeEventListener("canplay", activatePreparedVideo)
      preparedVideo.removeEventListener("seeked", activatePreparedVideo)
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

    if (!isPlaying && Math.abs(video.currentTime - previewSourceTime) > 0.08) {
      seekVideo(video, previewSourceTime)
    }

    if (isPlaying && Math.abs(video.currentTime - previewSourceTime) > 0.35) {
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

    const token = tokenCounterRef.current + 1
    tokenCounterRef.current = token
    slotTokensRef.current[preloadSlot] = token
    slotClipIdsRef.current[preloadSlot] = nextPreviewClip.id
    video.src = nextPreviewSource.path
    video.preload = "auto"
    loadedPreviewPathsRef.current[preloadSlot] = nextPreviewSource.path
    video.load()

    const handleMetadata = () => {
      if (slotTokensRef.current[preloadSlot] !== token) return
      updateClipDuration(nextPreviewClip.id, video.duration)
      seekVideo(video, nextPreviewClip.sourceStart)
    }

    video.addEventListener("loadedmetadata", handleMetadata, { once: true })
    return () => {
      video.removeEventListener("loadedmetadata", handleMetadata)
    }
  }, [
    displayedPreviewPath,
    displayedPreviewSlot,
    isPreviewSwitching,
    nextPreviewClip,
    previewSource,
    sourceForClip,
    updateClipDuration,
  ])

  useEffect(() => {
    if (!isPlaying) {
      lastGapFrameTimeRef.current = null
      return
    }

    let frameId = 0

    function tick(frameTime: number) {
      const video = previewVideoRefs.current[displayedPreviewSlot]

      if (previewClip && previewSource && displayedPreviewPath === previewSource.path && video) {
        lastGapFrameTimeRef.current = null

        const clipEnd = timelineEnd(previewClip)
        const nextTime = previewClip.timelineStart + (video.currentTime - previewClip.sourceStart)

        if (nextTime >= clipEnd - 0.02) {
          const nextClip = clipAfter(orderedClips, previewClip)
          if (!nextClip) {
            setIsPlaying(false)
            setPreviewTime(presentationDuration)
          } else {
            setPreviewTime(nextClip.timelineStart)
          }

          return
        }

        setPreviewTime(clamp(nextTime, previewClip.timelineStart, clipEnd))
        frameId = requestAnimationFrame(tick)
        return
      }

      if (previewClip) {
        lastGapFrameTimeRef.current = null
        frameId = requestAnimationFrame(tick)
        return
      }

      const previousFrameTime = lastGapFrameTimeRef.current ?? frameTime
      const elapsedSeconds = (frameTime - previousFrameTime) / 1000
      lastGapFrameTimeRef.current = frameTime

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
  }, [
    displayedPreviewPath,
    displayedPreviewSlot,
    isPlaying,
    orderedClips,
    presentationDuration,
    previewClip,
    previewSource,
  ])

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

    const shouldRestart = previewTime >= presentationDuration
    const nextTime = shouldRestart ? 0 : previewTime
    const nextClip = findClipAtTime(orderedClips, nextTime) ?? findNextClip(orderedClips, nextTime)
    const nextSource = nextClip ? sourceForClip(nextClip) : null
    const video = previewVideoRefs.current[displayedPreviewSlot]
    const targetTime = nextClip ? nextClip.sourceStart + (nextTime - nextClip.timelineStart) : 0

    if (
      nextClip &&
      nextSource &&
      video &&
      displayedPreviewPath === nextSource.path &&
      Math.abs(video.currentTime - targetTime) <= 0.12
    ) {
      void video.play().then(
        () => setIsPlaying(true),
        () => setIsPlaying(false),
      )
      if (shouldRestart) {
        setPreviewTime(0)
      }
      return
    }

    if (nextClip && nextSource) {
      const targetSlot = otherSlot(displayedPreviewSlot)
      const targetVideo = previewVideoRefs.current[targetSlot]

      if (targetVideo) {
        const token = tokenCounterRef.current + 1
        tokenCounterRef.current = token
        slotTokensRef.current[targetSlot] = token
        slotClipIdsRef.current[targetSlot] = nextClip.id
        activeRequestRef.current = { clipId: nextClip.id, slot: targetSlot, token }

        if (loadedPreviewPathsRef.current[targetSlot] !== nextSource.path) {
          targetVideo.src = nextSource.path
          targetVideo.preload = "auto"
          loadedPreviewPathsRef.current[targetSlot] = nextSource.path
          targetVideo.load()
        }

        if (targetVideo.readyState >= 1) {
          seekVideo(targetVideo, targetTime)
        } else {
          targetVideo.addEventListener("loadedmetadata", () => seekVideo(targetVideo, targetTime), { once: true })
        }

        void targetVideo.play().then(
          () => setIsPlaying(true),
          () => setIsPlaying(false),
        )
      }
    }

    setPreviewTime(nextTime)
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
