import type { CanvasDocument } from '../../canvas/shared/types'
import {
  WORKSPACE_PATHS,
  applyCanvasAssetManifest,
  createCanvasAssetManifest,
  normalizeCanvasAssetManifest,
  type CanvasAssetManifest,
  createWorkspaceStorageSnapshot,
  type CanvasStorageEnvelope,
  type ProjectManifest,
  type WorkspaceStorageSnapshot,
} from './schema'
import type { FileSystemAdapter } from './fs-adapter'
import type { WorkspaceRepository } from './types'

export class FileSystemRepository implements WorkspaceRepository {
  constructor(
    private readonly adapter: FileSystemAdapter,
    private readonly canvasId: string,
  ) {}

  async loadCanvas(): Promise<CanvasDocument | null> {
    const snapshot = await this.loadWorkspaceSnapshot()
    if (!snapshot) {
      return null
    }

    return snapshot.canvases[snapshot.activeCanvasId]?.canvas ?? null
  }

  async saveCanvas(document: CanvasDocument): Promise<void> {
    await this.saveWorkspaceSnapshot(createWorkspaceStorageSnapshot(document))
  }

  async loadWorkspaceSnapshot(): Promise<WorkspaceStorageSnapshot | null> {
    try {
      const projectRaw = await this.adapter.readTextFile(WORKSPACE_PATHS.projectManifest)
      const project = JSON.parse(projectRaw) as ProjectManifest
      const canvases = Object.fromEntries(
        await Promise.all(
          project.canvasIds.map(async (canvasId) => {
            const layout = this.getPlannedLayout(canvasId)
            const canvasRaw = await this.adapter.readTextFile(layout.canvasDocumentPath)
            const canvasEnvelope = JSON.parse(canvasRaw) as CanvasStorageEnvelope
            const assetManifest = await this.loadCanvasAssetManifest(canvasId)
            return [
              canvasId,
              assetManifest
                ? {
                    ...canvasEnvelope,
                    canvas: applyCanvasAssetManifest(
                      canvasEnvelope.canvas,
                      normalizeCanvasAssetManifest(assetManifest),
                    ),
                  }
                : canvasEnvelope,
            ]
          }),
        ),
      )

      return {
        project,
        activeCanvasId: project.defaultCanvasId,
        canvases,
      }
    } catch {
      return null
    }
  }

  async saveWorkspaceSnapshot(snapshot: WorkspaceStorageSnapshot): Promise<void> {
    await this.adapter.ensureDir(WORKSPACE_PATHS.canvasesDir)

    await this.adapter.writeTextFile(
      WORKSPACE_PATHS.projectManifest,
      JSON.stringify(snapshot.project, null, 2),
    )

    for (const canvasId of Object.keys(snapshot.canvases)) {
      const layout = this.getPlannedLayout(canvasId)
      await this.adapter.ensureDir(layout.canvasDirectory)
      await this.adapter.ensureDir(layout.originalsDirectory)
      await this.adapter.ensureDir(layout.referenceOriginalsDirectory)
      await this.adapter.ensureDir(layout.previewsDirectory)
      await this.adapter.ensureDir(layout.thumbnailsDirectory)
      await this.adapter.ensureDir(layout.trashDirectory)
      await this.adapter.writeTextFile(
        layout.canvasDocumentPath,
        JSON.stringify(snapshot.canvases[canvasId], null, 2),
      )
      await this.saveCanvasAssetManifest(
        canvasId,
        createCanvasAssetManifest(snapshot.canvases[canvasId].canvas),
      )
    }
  }

  async loadCanvasAssetManifest(canvasId: string): Promise<CanvasAssetManifest | null> {
    try {
      const layout = this.getPlannedLayout(canvasId)
      const assetManifestRaw = await this.adapter.readTextFile(layout.assetManifestPath)
      return normalizeCanvasAssetManifest(
        JSON.parse(assetManifestRaw) as CanvasAssetManifest,
      )
    } catch {
      return null
    }
  }

  async saveCanvasAssetManifest(
    canvasId: string,
    assetManifest: CanvasAssetManifest,
  ): Promise<void> {
    const layout = this.getPlannedLayout(canvasId)
    await this.adapter.ensureDir(layout.assetsDirectory)
    await this.adapter.writeTextFile(
      layout.assetManifestPath,
      JSON.stringify(normalizeCanvasAssetManifest(assetManifest), null, 2),
    )
  }

  getPlannedLayout(canvasId: string) {
    return {
      projectManifestPath: WORKSPACE_PATHS.projectManifest,
      canvasDirectory: `${WORKSPACE_PATHS.canvasesDir}/${canvasId}`,
      canvasDocumentPath: `${WORKSPACE_PATHS.canvasesDir}/${canvasId}/${WORKSPACE_PATHS.canvasDocument}`,
      assetsDirectory: `${WORKSPACE_PATHS.canvasesDir}/${canvasId}/${WORKSPACE_PATHS.assetsDir}`,
      assetManifestPath: `${WORKSPACE_PATHS.canvasesDir}/${canvasId}/${WORKSPACE_PATHS.assetManifest}`,
      originalsDirectory: `${WORKSPACE_PATHS.canvasesDir}/${canvasId}/${WORKSPACE_PATHS.originalsDir}`,
      referenceOriginalsDirectory: `${WORKSPACE_PATHS.canvasesDir}/${canvasId}/${WORKSPACE_PATHS.referenceOriginalsDir}`,
      previewsDirectory: `${WORKSPACE_PATHS.canvasesDir}/${canvasId}/${WORKSPACE_PATHS.previewsDir}`,
      thumbnailsDirectory: `${WORKSPACE_PATHS.canvasesDir}/${canvasId}/${WORKSPACE_PATHS.thumbnailsDir}`,
      trashDirectory: `${WORKSPACE_PATHS.canvasesDir}/${canvasId}/${WORKSPACE_PATHS.trashDir}`,
    }
  }
}
