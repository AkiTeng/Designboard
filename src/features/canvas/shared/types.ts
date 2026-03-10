export type ResourceLevel = 'thumbnail' | 'preview' | 'original'

export type CameraState = {
  x: number
  y: number
  zoom: number
}

export type BaseNode = {
  id: string
  type: 'image' | 'designDraft' | 'effect'
  x: number
  y: number
  width: number
  height: number
  rotation: number
  zIndex: number
  locked?: boolean
  hidden?: boolean
}

export type ImageNode = BaseNode & {
  type: 'image'
  assetId: string
  renderMode: 'cover' | 'contain' | 'stretch'
}

export type DesignDraftNode = BaseNode & {
  type: 'designDraft'
  snapshotAssetId?: string
  draftData: Record<string, unknown>
}

export type EffectNode = BaseNode & {
  type: 'effect'
  effectType: string
  effectConfig: Record<string, unknown>
}

export type CanvasNode = ImageNode | DesignDraftNode | EffectNode

export type ImageAsset = {
  id: string
  name: string
  width: number
  height: number
  thumbnailPath: string
  previewPath: string
  originalPath: string
  blobKey?: string
  mimeType?: string
  storageState?: 'inline' | 'blob-backed' | 'remote-url'
  offlineAvailable?: boolean
  remoteCacheStatus?: 'pending' | 'cached' | 'failed'
  previewStatus?: 'ready' | 'failed'
  thumbnailStatus?: 'ready' | 'failed'
  role?: 'generated' | 'reference' | 'imported'
  source?: 'mock' | 'openrouter' | 'browser-upload' | 'browser-paste'
  estimatedTextureBytes?: number
}

export type PromptRecord = {
  id: string
  prompt: string
  createdAt: string
  providerId: string
  outputAssetIds: string[]
  parameters?: {
    count: number
    model?: string
    aspectRatio?: string
    imageSize?: string
    referenceImageCount?: number
  }
}

export type TrashItem = {
  id: string
  node: CanvasNode
  deletedAt: string
}

export type CanvasDocument = {
  id: string
  name: string
  camera: CameraState
  nodes: CanvasNode[]
  assets: Record<string, ImageAsset>
  referenceAssetIds?: string[]
  prompts?: Record<string, PromptRecord>
  trash?: TrashItem[]
}

export type CanvasInstanceState = {
  selectedNodeIds: string[]
  hoveredNodeId: string | null
  activeTool: 'select' | 'pan'
  mode: 'idle' | 'panning' | 'dragging' | 'selecting'
}

export type EditorSnapshot = {
  document: CanvasDocument
  instance: CanvasInstanceState
}

export function createEmptyDocument(): CanvasDocument {
  return {
    id: 'canvas-root',
    name: 'Untitled Canvas',
    camera: {
      x: 0,
      y: 0,
      zoom: 1,
    },
    nodes: [],
    assets: {},
    referenceAssetIds: [],
    prompts: {},
    trash: [],
  }
}

export function createInitialInstanceState(): CanvasInstanceState {
  return {
    selectedNodeIds: [],
    hoveredNodeId: null,
    activeTool: 'select',
    mode: 'idle',
  }
}
