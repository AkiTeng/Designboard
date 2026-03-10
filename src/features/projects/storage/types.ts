import type { CanvasDocument } from '../../canvas/shared/types'
import type {
  CanvasAssetManifest,
  WorkspaceStorageSnapshot,
} from './schema'

export interface WorkspaceRepository {
  loadCanvas(): Promise<CanvasDocument | null>
  saveCanvas(document: CanvasDocument): Promise<void>
  loadWorkspaceSnapshot?(): Promise<WorkspaceStorageSnapshot | null>
  saveWorkspaceSnapshot?(snapshot: WorkspaceStorageSnapshot): Promise<void>
  loadCanvasAssetManifest?(canvasId: string): Promise<CanvasAssetManifest | null>
  saveCanvasAssetManifest?(
    canvasId: string,
    assetManifest: CanvasAssetManifest,
  ): Promise<void>
}
