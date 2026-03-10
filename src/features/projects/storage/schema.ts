import type { CanvasDocument, ImageAsset } from '../../canvas/shared/types'

export const WORKSPACE_SCHEMA_VERSION = 1
export const ASSET_MANIFEST_SCHEMA_VERSION = 1

export const WORKSPACE_PATHS = {
  projectManifest: 'project.json',
  canvasesDir: 'canvases',
  canvasDocument: 'canvas.json',
  assetsDir: 'assets',
  assetManifest: 'assets/manifest.json',
  originalsDir: 'assets/original',
  referenceOriginalsDir: 'assets/reference',
  previewsDir: 'assets/preview',
  thumbnailsDir: 'assets/thumbnail',
  trashDir: 'trash',
} as const

export type ProjectManifest = {
  schemaVersion: number
  projectId: string
  projectName: string
  defaultCanvasId: string
  canvasIds: string[]
}

export type CanvasStorageEnvelope = {
  schemaVersion: number
  canvas: CanvasDocument
}

export type AssetStorageRecord = {
  assetId: string
  name: string
  width: number
  height: number
  originalPath: string
  previewPath: string
  thumbnailPath: string
  blobKey?: string
  mimeType?: string
  storageState?: ImageAsset['storageState']
  offlineAvailable?: boolean
  remoteCacheStatus?: ImageAsset['remoteCacheStatus']
  previewStatus?: ImageAsset['previewStatus']
  thumbnailStatus?: ImageAsset['thumbnailStatus']
  role?: ImageAsset['role']
  source?: ImageAsset['source']
  estimatedTextureBytes?: number
}

export type CanvasAssetManifest = {
  schemaVersion: number
  referenceAssetIds: string[]
  assets: Record<string, AssetStorageRecord>
}

export type WorkspaceStorageSnapshot = {
  project: ProjectManifest
  activeCanvasId: string
  canvases: Record<string, CanvasStorageEnvelope>
}

export function createProjectManifest(input: {
  projectId: string
  projectName: string
  defaultCanvasId: string
  canvasIds: string[]
}): ProjectManifest {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    projectId: input.projectId,
    projectName: input.projectName,
    defaultCanvasId: input.defaultCanvasId,
    canvasIds: input.canvasIds,
  }
}

export function createCanvasEnvelope(
  canvas: CanvasDocument,
): CanvasStorageEnvelope {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    canvas,
  }
}

export function createCanvasAssetManifest(
  canvas: CanvasDocument,
): CanvasAssetManifest {
  return {
    schemaVersion: ASSET_MANIFEST_SCHEMA_VERSION,
    referenceAssetIds: canvas.referenceAssetIds ?? [],
    assets: Object.fromEntries(
      Object.values(canvas.assets).map((asset) => [
        asset.id,
        {
          assetId: asset.id,
          name: asset.name,
          width: asset.width,
          height: asset.height,
          originalPath: asset.originalPath,
          previewPath: asset.previewPath,
          thumbnailPath: asset.thumbnailPath,
          blobKey: asset.blobKey,
          mimeType: asset.mimeType,
          storageState: asset.storageState,
          offlineAvailable: asset.offlineAvailable,
          remoteCacheStatus: asset.remoteCacheStatus,
          previewStatus: asset.previewStatus,
          thumbnailStatus: asset.thumbnailStatus,
          role: asset.role,
          source: asset.source,
          estimatedTextureBytes: asset.estimatedTextureBytes,
        },
      ]),
    ),
  }
}

export function normalizeCanvasAssetManifest(
  assetManifest: CanvasAssetManifest,
): CanvasAssetManifest {
  return {
    schemaVersion: ASSET_MANIFEST_SCHEMA_VERSION,
    referenceAssetIds: assetManifest.referenceAssetIds ?? [],
    assets: Object.fromEntries(
      Object.entries(assetManifest.assets ?? {}).map(([assetId, assetRecord]) => [
        assetId,
        {
          ...assetRecord,
          assetId: assetRecord.assetId ?? assetId,
          storageState:
            assetRecord.storageState ??
            (assetRecord.blobKey
              ? 'blob-backed'
              : /^https?:\/\//.test(assetRecord.originalPath)
                ? 'remote-url'
                : 'inline'),
          offlineAvailable:
            assetRecord.offlineAvailable ??
            (assetRecord.blobKey
              ? true
              : !/^https?:\/\//.test(assetRecord.originalPath)),
          remoteCacheStatus:
            assetRecord.remoteCacheStatus ??
            (assetRecord.blobKey
              ? 'cached'
              : /^https?:\/\//.test(assetRecord.originalPath)
                ? 'pending'
                : undefined),
          previewStatus:
            assetRecord.previewStatus ??
            (assetRecord.previewPath.startsWith('asset://blob/') ? 'ready' : undefined),
          thumbnailStatus:
            assetRecord.thumbnailStatus ??
            (assetRecord.thumbnailPath.startsWith('asset://blob/') ? 'ready' : undefined),
        },
      ]),
    ),
  }
}

export function applyCanvasAssetManifest(
  canvas: CanvasDocument,
  assetManifest: CanvasAssetManifest,
): CanvasDocument {
  const assets = Object.fromEntries(
    Object.values(assetManifest.assets).map((assetRecord) => [
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
  )

  return {
    ...canvas,
    assets,
    referenceAssetIds: assetManifest.referenceAssetIds,
  }
}

export function createWorkspaceStorageSnapshot(
  canvas: CanvasDocument,
): WorkspaceStorageSnapshot {
  return {
    project: createProjectManifest({
      projectId: 'local-project',
      projectName: 'Designboard Local Project',
      defaultCanvasId: canvas.id,
      canvasIds: [canvas.id],
    }),
    activeCanvasId: canvas.id,
    canvases: {
      [canvas.id]: createCanvasEnvelope(canvas),
    },
  }
}
