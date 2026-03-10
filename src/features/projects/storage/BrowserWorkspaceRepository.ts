import type { CanvasDocument } from '../../canvas/shared/types'
import type { WorkspaceRepository } from './types'
import {
  createCanvasAssetManifest,
  createWorkspaceStorageSnapshot,
  normalizeCanvasAssetManifest,
  type CanvasAssetManifest,
  type WorkspaceStorageSnapshot,
} from './schema'

const STORAGE_KEY = 'designboard:workspace:canvas'

export class BrowserWorkspaceRepository implements WorkspaceRepository {
  async loadCanvas(): Promise<CanvasDocument | null> {
    const snapshot = await this.loadWorkspaceSnapshot()

    if (!snapshot) {
      return null
    }

    return snapshot.canvases[snapshot.activeCanvasId]?.canvas ?? null
  }

  async loadWorkspaceSnapshot(): Promise<WorkspaceStorageSnapshot | null> {
    const raw = window.localStorage.getItem(STORAGE_KEY)

    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as WorkspaceStorageSnapshot | CanvasDocument

    if ('canvases' in parsed && 'project' in parsed && 'activeCanvasId' in parsed) {
      return parsed
    }

    if ('canvas' in parsed && 'project' in parsed) {
      return {
        project: {
          ...parsed.project,
          canvasIds: [parsed.project.defaultCanvasId],
        },
        activeCanvasId: parsed.project.defaultCanvasId,
        canvases: {
          [parsed.project.defaultCanvasId]: parsed.canvas,
        },
      }
    }

    return createWorkspaceStorageSnapshot(parsed)
  }

  async saveCanvas(document: CanvasDocument): Promise<void> {
    const currentSnapshot =
      (await this.loadWorkspaceSnapshot()) ?? createWorkspaceStorageSnapshot(document)
    const snapshot: WorkspaceStorageSnapshot = {
      ...currentSnapshot,
      activeCanvasId: document.id,
      project: {
        ...currentSnapshot.project,
        defaultCanvasId: document.id,
        canvasIds: Array.from(
          new Set([...currentSnapshot.project.canvasIds, document.id]),
        ),
      },
      canvases: {
        ...currentSnapshot.canvases,
        [document.id]: {
          schemaVersion: currentSnapshot.project.schemaVersion,
          canvas: document,
        },
      },
    }

    await this.saveWorkspaceSnapshot(snapshot)
  }

  async saveWorkspaceSnapshot(snapshot: WorkspaceStorageSnapshot): Promise<void> {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  }

  async loadCanvasAssetManifest(canvasId: string): Promise<CanvasAssetManifest | null> {
    const snapshot = await this.loadWorkspaceSnapshot()
    const canvas = snapshot?.canvases[canvasId]?.canvas

    if (!canvas) {
      return null
    }

    return normalizeCanvasAssetManifest(createCanvasAssetManifest(canvas))
  }

  async saveCanvasAssetManifest(
    canvasId: string,
    assetManifest: CanvasAssetManifest,
  ): Promise<void> {
    const snapshot = await this.loadWorkspaceSnapshot()

    if (!snapshot) {
      return
    }

    const canvasEnvelope = snapshot.canvases[canvasId]

    if (!canvasEnvelope) {
      return
    }

    const normalizedAssetManifest = normalizeCanvasAssetManifest(assetManifest)
    const nextCanvas = {
      ...canvasEnvelope.canvas,
      assets: Object.fromEntries(
        Object.values(normalizedAssetManifest.assets).map((assetRecord) => [
          assetRecord.assetId,
          {
            id: assetRecord.assetId,
            name: assetRecord.name,
            width: assetRecord.width,
            height: assetRecord.height,
            originalPath: assetRecord.originalPath,
            previewPath: assetRecord.previewPath,
            thumbnailPath: assetRecord.thumbnailPath,
            blobKey: assetRecord.blobKey,
            mimeType: assetRecord.mimeType,
            storageState: assetRecord.storageState,
            offlineAvailable: assetRecord.offlineAvailable,
            remoteCacheStatus: assetRecord.remoteCacheStatus,
            previewStatus: assetRecord.previewStatus,
            thumbnailStatus: assetRecord.thumbnailStatus,
            role: assetRecord.role,
            source: assetRecord.source,
            estimatedTextureBytes: assetRecord.estimatedTextureBytes,
          },
        ]),
      ),
      referenceAssetIds: normalizedAssetManifest.referenceAssetIds,
    }

    await this.saveWorkspaceSnapshot({
      ...snapshot,
      canvases: {
        ...snapshot.canvases,
        [canvasId]: {
          ...canvasEnvelope,
          canvas: nextCanvas,
        },
      },
    })
  }
}
