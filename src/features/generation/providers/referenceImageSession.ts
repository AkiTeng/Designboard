import type { ReferenceImageInput } from './types'

const REFERENCE_IMAGE_SESSION_KEY = 'designboard.reference-images.v1'

type ReferenceImageSessionSnapshot = Record<string, ReferenceImageInput[]>

function loadReferenceImageSnapshot(): ReferenceImageSessionSnapshot {
  if (typeof window === 'undefined') {
    return {}
  }

  const rawValue = window.sessionStorage.getItem(REFERENCE_IMAGE_SESSION_KEY)

  if (!rawValue) {
    return {}
  }

  try {
    return JSON.parse(rawValue) as ReferenceImageSessionSnapshot
  } catch {
    return {}
  }
}

function saveReferenceImageSnapshot(snapshot: ReferenceImageSessionSnapshot) {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.setItem(
    REFERENCE_IMAGE_SESSION_KEY,
    JSON.stringify(snapshot),
  )
}

export function loadCanvasReferenceImages(canvasId: string) {
  return loadReferenceImageSnapshot()[canvasId] ?? []
}

export function saveCanvasReferenceImages(
  canvasId: string,
  referenceImages: ReferenceImageInput[],
) {
  const nextSnapshot = loadReferenceImageSnapshot()
  nextSnapshot[canvasId] = referenceImages
  saveReferenceImageSnapshot(nextSnapshot)
}

export function clearCanvasReferenceImages(canvasId: string) {
  const nextSnapshot = loadReferenceImageSnapshot()
  delete nextSnapshot[canvasId]
  saveReferenceImageSnapshot(nextSnapshot)
}
