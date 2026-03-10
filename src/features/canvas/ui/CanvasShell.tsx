import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { CanvasEditor } from '../editor/CanvasEditor'
import { PixiCanvasApp } from '../renderer/PixiCanvasApp'
import { createId } from '../shared/createId'
import {
  createEmptyDocument,
  type ImageAsset,
  type CanvasDocument,
  type EditorSnapshot,
} from '../shared/types'
import { GenerationService } from '../../generation/application/GenerationService'
import { MockImageGenerationProvider } from '../../generation/providers/mockProvider'
import { OpenRouterImageGenerationProvider } from '../../generation/providers/OpenRouterImageGenerationProvider'
import {
  isProviderGenerationError,
  type ProviderGenerationError,
} from '../../generation/providers/errors'
import {
  isOpenRouterConfigured,
  loadProviderSettings,
  saveProviderSettings,
  type ProviderSettings,
} from '../../generation/providers/providerSettings'
import {
  clearCanvasReferenceImages,
  loadCanvasReferenceImages,
  saveCanvasReferenceImages,
} from '../../generation/providers/referenceImageSession'
import { BrowserIndexedDbAssetBlobStore } from '../../projects/storage/BrowserIndexedDbAssetBlobStore'
import type {
  ImageGenerationProvider,
  ReferenceImageInput,
} from '../../generation/providers/types'
import {
  ASSET_MANIFEST_SCHEMA_VERSION,
  WORKSPACE_SCHEMA_VERSION,
  createWorkspaceStorageSnapshot,
  type WorkspaceStorageSnapshot,
} from '../../projects/storage/schema'
import { BrowserHostBridge, type HostBridge } from '../../host/HostBridge'
import type { WorkspaceRepository } from '../../projects/storage/types'

const INITIAL_STATUS = [
  'React shell mounted',
  'CanvasEditor created',
  'Pixi runtime ready for mount',
  'Single-project workspace assumed',
]

export function CanvasShell() {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<CanvasEditor | null>(null)
  const pixiAppRef = useRef<PixiCanvasApp | null>(null)
  const hostBridgeRef = useRef<HostBridge | null>(null)
  const repositoryRef = useRef<WorkspaceRepository | null>(null)
  const assetBlobStoreRef = useRef<BrowserIndexedDbAssetBlobStore | null>(null)
  const referencePreviewUrlsRef = useRef<string[]>([])
  const assetStatusPreviewUrlsRef = useRef<string[]>([])
  const workspaceSnapshotRef = useRef<WorkspaceStorageSnapshot | null>(null)
  const migratingAssetIdsRef = useRef(new Set<string>())
  const attemptedRemoteCacheAssetIdsRef = useRef(new Set<string>())
  const derivingAssetIdsRef = useRef(new Set<string>())
  const lastGenerationRequestRef = useRef<{
    prompt: string
    overrides?: {
      count?: number
      aspectRatio?: string
      imageSize?: string
    }
    settingsOverride?: ProviderSettings
  } | null>(null)
  const deletedCanvasStackRef = useRef<
    Array<{
      canvasId: string
      canvasIndex: number
      canvasEnvelope: WorkspaceStorageSnapshot['canvases'][string]
      referenceImages: ReferenceImageInput[]
    }>
  >([])
  const hasHydratedRef = useRef(false)
  const settleInteractionTimeoutRef = useRef<number | null>(null)
  const pointerStateRef = useRef<{
    kind: 'pan' | 'drag-node' | 'marquee'
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    nodeId?: string
  } | null>(null)

  if (!editorRef.current) {
    editorRef.current = new CanvasEditor(createEmptyDocument())
  }

  if (!pixiAppRef.current) {
    pixiAppRef.current = new PixiCanvasApp(assetBlobStoreRef.current ?? undefined)
  }

  if (!hostBridgeRef.current) {
    hostBridgeRef.current = new BrowserHostBridge()
  }

  if (!repositoryRef.current) {
    repositoryRef.current = hostBridgeRef.current.createWorkspaceRepository()
  }

  if (!assetBlobStoreRef.current) {
    assetBlobStoreRef.current = new BrowserIndexedDbAssetBlobStore()
  }

  const editor = editorRef.current
  const pixiApp = pixiAppRef.current
  const hostBridge = hostBridgeRef.current
  const repository = repositoryRef.current
  const assetBlobStore = assetBlobStoreRef.current

  if (!assetBlobStore) {
    throw new Error('Asset blob store failed to initialize')
  }
  const [snapshot, setSnapshot] = useState<EditorSnapshot>(editor.getSnapshot())
  const [workspaceSnapshot, setWorkspaceSnapshot] =
    useState<WorkspaceStorageSnapshot | null>(null)
  const [canvasQuery, setCanvasQuery] = useState('')
  const [prompt, setPrompt] = useState('editorial poster with layered collage')
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(() =>
    loadProviderSettings(),
  )
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle')
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [failedGenerationError, setFailedGenerationError] =
    useState<ProviderGenerationError | null>(null)
  const [referenceImages, setReferenceImages] = useState<ReferenceImageInput[]>([])
  const [assetStatusPreviewMap, setAssetStatusPreviewMap] = useState<Record<string, string>>({})
  const [persistenceStatus, setPersistenceStatus] = useState<
    'hydrating' | 'ready' | 'saving' | 'error'
  >('hydrating')
  const [activePromptRecordId, setActivePromptRecordId] = useState<string | null>(null)
  const [deletedCanvasCount, setDeletedCanvasCount] = useState(0)
  const [marqueeRect, setMarqueeRect] = useState<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  const promptHistory = Object.values(snapshot.document.prompts ?? {}).sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )
  const selectedImageAssets = [
    ...new Map(
      snapshot.instance.selectedNodeIds
        .map((nodeId) => snapshot.document.nodes.find((node) => node.id === nodeId))
        .filter(
          (node): node is Extract<CanvasDocument['nodes'][number], { type: 'image' }> =>
            Boolean(node) && node.type === 'image',
        )
        .map((node) => snapshot.document.assets[node.assetId])
        .filter((asset): asset is ImageAsset => Boolean(asset))
        .map((asset) => [asset.id, asset]),
    ).values(),
  ]
  const selectedAssetSignature = selectedImageAssets
    .map((asset) => `${asset.id}:${asset.previewPath}:${asset.thumbnailPath}:${asset.originalPath}`)
    .join('|')
  const canvasIds = workspaceSnapshot?.project.canvasIds ?? [snapshot.document.id]
  const filteredCanvasIds = canvasIds.filter((canvasId) => {
    const canvasName =
      workspaceSnapshot?.canvases[canvasId]?.canvas.name?.toLowerCase() ?? canvasId

    return canvasName.includes(canvasQuery.trim().toLowerCase())
  })
  const activeCanvasPromptCount = Object.keys(snapshot.document.prompts ?? {}).length
  const referenceAssetCount = snapshot.document.referenceAssetIds?.length ?? 0
  const blobBackedAssetCount = Object.values(snapshot.document.assets).filter(
    (asset) => Boolean(asset.blobKey),
  ).length
  const blobBackedReferenceAssetCount = Object.values(snapshot.document.assets).filter(
    (asset) => asset.role === 'reference' && Boolean(asset.blobKey),
  ).length
  const blobBackedGeneratedAssetCount = Object.values(snapshot.document.assets).filter(
    (asset) => asset.role === 'generated' && Boolean(asset.blobKey),
  ).length
  const remoteAssetCount = Object.values(snapshot.document.assets).filter(
    (asset) => asset.storageState === 'remote-url',
  ).length
  const offlineReadyAssetCount = Object.values(snapshot.document.assets).filter(
    (asset) => asset.offlineAvailable,
  ).length
  const remoteCachePendingCount = Object.values(snapshot.document.assets).filter(
    (asset) => asset.remoteCacheStatus === 'pending',
  ).length
  const remoteCacheCachedCount = Object.values(snapshot.document.assets).filter(
    (asset) => asset.remoteCacheStatus === 'cached',
  ).length
  const remoteCacheFailedCount = Object.values(snapshot.document.assets).filter(
    (asset) => asset.remoteCacheStatus === 'failed',
  ).length
  const previewReadyCount = Object.values(snapshot.document.assets).filter(
    (asset) => asset.previewStatus === 'ready',
  ).length
  const previewFailedCount = Object.values(snapshot.document.assets).filter(
    (asset) => asset.previewStatus === 'failed',
  ).length
  const thumbnailReadyCount = Object.values(snapshot.document.assets).filter(
    (asset) => asset.thumbnailStatus === 'ready',
  ).length
  const thumbnailFailedCount = Object.values(snapshot.document.assets).filter(
    (asset) => asset.thumbnailStatus === 'failed',
  ).length
  const providerLabel =
    providerSettings.selectedProviderId === 'openrouter'
      ? `openrouter · ${providerSettings.openRouter.model || 'model pending'}`
      : 'mock'
  const openRouterReady = isOpenRouterConfigured(providerSettings)

  function commitWorkspaceSnapshot(nextSnapshot: WorkspaceStorageSnapshot) {
    workspaceSnapshotRef.current = nextSnapshot
    setWorkspaceSnapshot(nextSnapshot)
  }

  function updateProviderSettings(
    updater: (currentSettings: ProviderSettings) => ProviderSettings,
  ) {
    setProviderSettings((currentSettings) => {
      const nextSettings = updater(currentSettings)
      saveProviderSettings(nextSettings)
      return nextSettings
    })
  }

  function createGenerationProvider(
    settings: ProviderSettings = providerSettings,
  ): ImageGenerationProvider {
    if (settings.selectedProviderId === 'openrouter') {
      if (!isOpenRouterConfigured(settings)) {
        throw new Error('OpenRouter API Key 和 model 还没填完整')
      }

      return new OpenRouterImageGenerationProvider({
        apiKey: settings.openRouter.apiKey.trim(),
        model: settings.openRouter.model.trim(),
        appName: settings.openRouter.appName.trim(),
        aspectRatio: settings.openRouter.aspectRatio,
        imageSize: settings.openRouter.imageSize || undefined,
        referer: settings.openRouter.referer.trim() || window.location.origin,
      })
    }

    return new MockImageGenerationProvider()
  }

  function syncWorkspaceSnapshotDocument(
    baseSnapshot: WorkspaceStorageSnapshot,
    document: CanvasDocument,
  ): WorkspaceStorageSnapshot {
    const nextCanvasIds = Array.from(
      new Set([...baseSnapshot.project.canvasIds, document.id]),
    )

    return {
      ...baseSnapshot,
      activeCanvasId: document.id,
      project: {
        ...baseSnapshot.project,
        defaultCanvasId: document.id,
        canvasIds: nextCanvasIds,
      },
      canvases: {
        ...baseSnapshot.canvases,
        [document.id]: {
          schemaVersion: WORKSPACE_SCHEMA_VERSION,
          canvas: document,
        },
      },
    }
  }

  useEffect(() => {
    const unsubscribe = editor.subscribe(setSnapshot)
    return unsubscribe
  }, [editor])

  useEffect(() => {
    let cancelled = false

    void (repository.loadWorkspaceSnapshot
      ? repository.loadWorkspaceSnapshot()
      : Promise.resolve(null)
    )
      .then((loadedWorkspaceSnapshot) => {
        if (cancelled) {
          return
        }

        if (loadedWorkspaceSnapshot) {
          const activeCanvas =
            loadedWorkspaceSnapshot.canvases[loadedWorkspaceSnapshot.activeCanvasId]?.canvas

          if (activeCanvas) {
            editor.replaceDocument(activeCanvas)
          }

          commitWorkspaceSnapshot(loadedWorkspaceSnapshot)
          hasHydratedRef.current = true
          setPersistenceStatus('ready')
          return
        }

        return repository.loadCanvas().then((document) => {
          const nextWorkspaceSnapshot = createWorkspaceStorageSnapshot(
            document ?? createEmptyDocument(),
          )

          commitWorkspaceSnapshot(nextWorkspaceSnapshot)

          if (document) {
            editor.replaceDocument(document)
          }

          hasHydratedRef.current = true
          setPersistenceStatus('ready')
        })
      })
      .catch(() => {
        if (!cancelled) {
          const fallbackSnapshot = createWorkspaceStorageSnapshot(createEmptyDocument())
          commitWorkspaceSnapshot(fallbackSnapshot)
          hasHydratedRef.current = true
          setPersistenceStatus('error')
        }
      })

    return () => {
      cancelled = true
    }
  }, [editor, repository])

  useEffect(() => {
    const element = stageRef.current

    if (!element) {
      return
    }

    let cancelled = false

    void pixiApp.mount(element).then(() => {
      if (!cancelled) {
        const nextSnapshot = editor.getSnapshot()
        pixiApp.syncDocument(
          nextSnapshot.document,
          nextSnapshot.instance.selectedNodeIds,
        )
      }
    })

    return () => {
      cancelled = true
      pixiApp.destroy()
    }
  }, [editor, pixiApp])

  useEffect(() => {
    pixiApp.syncDocument(snapshot.document, snapshot.instance.selectedNodeIds)
  }, [pixiApp, snapshot.document, snapshot.instance.selectedNodeIds])

  useEffect(() => {
    return () => {
      if (settleInteractionTimeoutRef.current) {
        window.clearTimeout(settleInteractionTimeoutRef.current)
      }

      revokeReferencePreviewUrls()
      revokeAssetStatusPreviewUrls()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const documentReferenceImages = getReferenceImagesFromDocument(snapshot.document)
    const fallbackReferenceImages =
      documentReferenceImages.length > 0
        ? documentReferenceImages
        : loadCanvasReferenceImages(snapshot.document.id)

    void hydrateReferenceImages(fallbackReferenceImages).then((hydratedReferenceImages) => {
      if (cancelled) {
        return
      }

      setReferenceImages((currentImages) => {
        if (areReferenceImagesEqual(currentImages, hydratedReferenceImages)) {
          return currentImages
        }

        revokeReferencePreviewUrls()
        referencePreviewUrlsRef.current = hydratedReferenceImages
          .map((referenceImage) => referenceImage.previewUrl)
          .filter((previewUrl): previewUrl is string => Boolean(previewUrl))

        return hydratedReferenceImages
      })
    })

    return () => {
      cancelled = true
    }
  }, [
    snapshot.document.id,
    snapshot.document.assets,
    snapshot.document.referenceAssetIds,
  ])

  useEffect(() => {
    saveCanvasReferenceImages(
      snapshot.document.id,
      referenceImages.map(({ previewUrl, ...referenceImage }) =>
        serializeReferenceImage(referenceImage),
      ),
    )
    editor.replaceReferenceAssets(
      referenceImages.map((referenceImage) => createReferenceAsset(referenceImage)),
    )
  }, [editor, referenceImages, snapshot.document.id])

  useEffect(() => {
    let cancelled = false

    void hydrateAssetStatusPreviews(selectedImageAssets).then((nextPreviewMap) => {
      if (cancelled) {
        return
      }

      revokeAssetStatusPreviewUrls()
      assetStatusPreviewUrlsRef.current = Object.values(nextPreviewMap).filter((previewUrl) =>
        previewUrl.startsWith('blob:'),
      )
      setAssetStatusPreviewMap(nextPreviewMap)
    })

    return () => {
      cancelled = true
    }
  }, [assetBlobStore, selectedAssetSignature])

  useEffect(() => {
    const migratableAssets = Object.values(snapshot.document.assets).filter(
      (asset) =>
        (asset.role === 'reference' || asset.role === 'generated') &&
        !asset.blobKey &&
        asset.originalPath.startsWith('data:') &&
        !migratingAssetIdsRef.current.has(asset.id),
    )

    if (migratableAssets.length === 0) {
      return
    }

    migratableAssets.forEach((asset) => {
      migratingAssetIdsRef.current.add(asset.id)
    })

    void Promise.all(
      migratableAssets.map((asset) => materializeSingleAsset(asset)),
    )
      .then((materializedAssets) => {
        const successfulAssets = materializedAssets.filter(
          (asset): asset is ImageAsset => Boolean(asset),
        )

        if (successfulAssets.length === 0) {
          return
        }

        const nextAssets = { ...snapshot.document.assets }

        successfulAssets.forEach((asset) => {
          nextAssets[asset.id] = asset
        })

        editor.replaceDocument({
          ...snapshot.document,
          assets: nextAssets,
        })
      })
      .finally(() => {
        migratableAssets.forEach((asset) => {
          migratingAssetIdsRef.current.delete(asset.id)
        })
      })
  }, [assetBlobStore, editor, snapshot.document.assets, snapshot.document.id])

  useEffect(() => {
    const remoteGeneratedAssets = Object.values(snapshot.document.assets).filter(
      (asset) =>
        asset.role === 'generated' &&
        asset.storageState === 'remote-url' &&
        !asset.blobKey &&
        asset.remoteCacheStatus !== 'failed' &&
        !attemptedRemoteCacheAssetIdsRef.current.has(asset.id),
    )

    if (remoteGeneratedAssets.length === 0) {
      return
    }

    remoteGeneratedAssets.forEach((asset) => {
      attemptedRemoteCacheAssetIdsRef.current.add(asset.id)
    })

    void Promise.all(remoteGeneratedAssets.map((asset) => materializeSingleAsset(asset)))
      .then((materializedAssets) => {
        const successfulAssets = materializedAssets.filter(
          (asset): asset is ImageAsset => Boolean(asset),
        )
        const failedAssets = remoteGeneratedAssets.filter(
          (asset) =>
            !successfulAssets.some(
              (successfulAsset) => successfulAsset.id === asset.id,
            ),
        )

        if (successfulAssets.length === 0 && failedAssets.length === 0) {
          return
        }

        const nextAssets = { ...snapshot.document.assets }

        successfulAssets.forEach((asset) => {
          nextAssets[asset.id] = asset
        })
        failedAssets.forEach((asset) => {
          nextAssets[asset.id] = {
            ...asset,
            remoteCacheStatus: 'failed',
          }
        })

        editor.replaceDocument({
          ...snapshot.document,
          assets: nextAssets,
        })
      })
  }, [editor, snapshot.document.assets, snapshot.document.id])

  useEffect(() => {
    const assetsMissingDerivatives = Object.values(snapshot.document.assets).filter(
      (asset) =>
        asset.storageState === 'blob-backed' &&
        Boolean(asset.blobKey) &&
        (!asset.previewStatus || !asset.thumbnailStatus) &&
        !derivingAssetIdsRef.current.has(asset.id),
    )

    if (assetsMissingDerivatives.length === 0) {
      return
    }

    assetsMissingDerivatives.forEach((asset) => {
      derivingAssetIdsRef.current.add(asset.id)
    })

    void Promise.all(assetsMissingDerivatives.map((asset) => ensureDerivedAssetVariants(asset)))
      .then((updatedAssets) => {
        const successfulAssets = updatedAssets.filter(
          (asset): asset is ImageAsset => Boolean(asset),
        )

        if (successfulAssets.length === 0) {
          return
        }

        const nextAssets = { ...snapshot.document.assets }
        successfulAssets.forEach((asset) => {
          nextAssets[asset.id] = asset
        })

        editor.replaceDocument({
          ...snapshot.document,
          assets: nextAssets,
        })
      })
      .finally(() => {
        assetsMissingDerivatives.forEach((asset) => {
          derivingAssetIdsRef.current.delete(asset.id)
        })
      })
  }, [editor, snapshot.document.assets, snapshot.document.id])

  useEffect(() => {
    if (!hasHydratedRef.current) {
      return
    }

    const currentWorkspaceSnapshot =
      workspaceSnapshotRef.current ?? createWorkspaceStorageSnapshot(snapshot.document)
    const nextWorkspaceSnapshot = syncWorkspaceSnapshotDocument(
      currentWorkspaceSnapshot,
      snapshot.document,
    )

    commitWorkspaceSnapshot(nextWorkspaceSnapshot)
    setPersistenceStatus('saving')

    const timeoutId = window.setTimeout(() => {
      const saveOperation = repository.saveWorkspaceSnapshot
        ? repository.saveWorkspaceSnapshot(nextWorkspaceSnapshot)
        : repository.saveCanvas(snapshot.document)

      void saveOperation
        .then(() => setPersistenceStatus('ready'))
        .catch(() => setPersistenceStatus('error'))
    }, 150)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [repository, snapshot.document])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isMeta = event.metaKey || event.ctrlKey

      if (isMeta && event.key.toLowerCase() === 'z' && event.shiftKey) {
        event.preventDefault()
        editor.redo()
        return
      }

      if (isMeta && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        editor.undo()
        return
      }

      if (
        (event.key === 'Backspace' || event.key === 'Delete') &&
        snapshot.instance.selectedNodeIds.length > 0
      ) {
        event.preventDefault()
        editor.beginHistoryBatch()
        editor.removeSelectedNodes()
        editor.commitHistoryBatch()
        return
      }

      if (
        isMeta &&
        event.shiftKey &&
        event.key === 'Backspace' &&
        editor.canRestoreDeletedNode()
      ) {
        event.preventDefault()
        editor.beginHistoryBatch()
        editor.restoreLastDeletedNode()
        editor.commitHistoryBatch()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [editor, snapshot.instance.selectedNodeIds])

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault()
    markInteractive()

    const nextZoom = Math.min(
      3,
      Math.max(0.25, snapshot.document.camera.zoom - event.deltaY * 0.001),
    )

    editor.setCamera({
      zoom: nextZoom,
    })
    scheduleInteractionSettle()
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) {
      return
    }

    const hitNode = getTopmostNodeAtPoint(event)

    if (hitNode) {
      if (event.shiftKey) {
        editor.selectNode(hitNode.id, 'toggle')
        return
      }

      pointerStateRef.current = {
        kind: 'drag-node',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: hitNode.x,
        originY: hitNode.y,
        nodeId: hitNode.id,
      }

      editor.beginHistoryBatch()
      editor.selectNode(hitNode.id, 'replace')
      editor.setMode('dragging')
      markInteractive()
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }

    if (event.shiftKey) {
      const rect = event.currentTarget.getBoundingClientRect()
      const startLocalX = event.clientX - rect.left
      const startLocalY = event.clientY - rect.top

      pointerStateRef.current = {
        kind: 'marquee',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: 0,
        originY: 0,
      }

      setMarqueeRect({
        x: startLocalX,
        y: startLocalY,
        width: 0,
        height: 0,
      })
      editor.setMode('selecting')
      markInteractive()
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }

    pointerStateRef.current = {
      kind: 'pan',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: snapshot.document.camera.x,
      originY: snapshot.document.camera.y,
    }

    if (!event.shiftKey) {
      editor.selectNode(null)
    }
    editor.setMode('panning')
    markInteractive()
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const pointerState = pointerStateRef.current

    const hoveredNode = getTopmostNodeAtPoint(event)
    editor.setHoveredNode(hoveredNode?.id ?? null)

    if (!pointerState || pointerState.pointerId !== event.pointerId) {
      return
    }

    const deltaX = event.clientX - pointerState.startX
    const deltaY = event.clientY - pointerState.startY

    if (pointerState.kind === 'marquee') {
      const rect = event.currentTarget.getBoundingClientRect()
      const startLocalX = pointerState.startX - rect.left
      const startLocalY = pointerState.startY - rect.top
      const currentLocalX = event.clientX - rect.left
      const currentLocalY = event.clientY - rect.top

      const nextRect = {
        x: Math.min(startLocalX, currentLocalX),
        y: Math.min(startLocalY, currentLocalY),
        width: Math.abs(currentLocalX - startLocalX),
        height: Math.abs(currentLocalY - startLocalY),
      }

      setMarqueeRect(nextRect)
      editor.setSelectedNodes(getNodesIntersectingMarquee(nextRect).map((node) => node.id))
      return
    }

    if (pointerState.kind === 'drag-node' && pointerState.nodeId) {
      editor.updateNodePosition(pointerState.nodeId, {
        x: pointerState.originX + deltaX / snapshot.document.camera.zoom,
        y: pointerState.originY + deltaY / snapshot.document.camera.zoom,
      })
      return
    }

    editor.setCamera({
      x: pointerState.originX + deltaX,
      y: pointerState.originY + deltaY,
    })
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointerStateRef.current?.pointerId !== event.pointerId) {
      return
    }

    if (pointerStateRef.current.kind === 'marquee') {
      setMarqueeRect(null)
    }

    pointerStateRef.current = null
    editor.setMode('idle')
    editor.commitHistoryBatch()
    scheduleInteractionSettle()
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function getTopmostNodeAtPoint(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const localX = event.clientX - rect.left
    const localY = event.clientY - rect.top
    const worldX =
      (localX - snapshot.document.camera.x) / snapshot.document.camera.zoom
    const worldY =
      (localY - snapshot.document.camera.y) / snapshot.document.camera.zoom

    const nodes = [...snapshot.document.nodes].sort((a, b) => b.zIndex - a.zIndex)

    return (
      nodes.find(
        (node) =>
          !node.hidden &&
          worldX >= node.x &&
          worldX <= node.x + node.width &&
          worldY >= node.y &&
          worldY <= node.y + node.height,
      ) ?? null
    )
  }

  function getNodesIntersectingMarquee(rect: {
    x: number
    y: number
    width: number
    height: number
  }) {
    const worldX = (rect.x - snapshot.document.camera.x) / snapshot.document.camera.zoom
    const worldY = (rect.y - snapshot.document.camera.y) / snapshot.document.camera.zoom
    const worldWidth = rect.width / snapshot.document.camera.zoom
    const worldHeight = rect.height / snapshot.document.camera.zoom

    return snapshot.document.nodes.filter((node) => {
      if (node.hidden) {
        return false
      }

      return !(
        node.x + node.width < worldX ||
        node.x > worldX + worldWidth ||
        node.y + node.height < worldY ||
        node.y > worldY + worldHeight
      )
    })
  }

  async function runGeneration(
    nextPrompt: string,
    overrides?: {
      count?: number
      aspectRatio?: string
      imageSize?: string
    },
    settingsOverride?: ProviderSettings,
  ) {
    lastGenerationRequestRef.current = {
      prompt: nextPrompt,
      overrides,
      settingsOverride,
    }

    try {
      setGenerationError(null)
      setFailedGenerationError(null)
      setStatus('running')
      const effectiveSettings = settingsOverride ?? providerSettings
      const generationService = new GenerationService(
        editor,
        createGenerationProvider(effectiveSettings),
        {
          materializeAssets: materializeGeneratedAssets,
        },
      )
      const resolvedReferenceImages = await resolveReferenceImagesForGeneration(
        referenceImages,
      )
      const result = await generationService.generateFromPrompt({
        prompt: nextPrompt,
        count:
          overrides?.count ??
          (effectiveSettings.selectedProviderId === 'openrouter'
            ? effectiveSettings.openRouter.outputCount
            : 1),
        aspectRatio:
          overrides?.aspectRatio ??
          (effectiveSettings.selectedProviderId === 'openrouter'
            ? effectiveSettings.openRouter.aspectRatio
            : undefined),
        imageSize:
          overrides?.imageSize ??
          (effectiveSettings.selectedProviderId === 'openrouter'
            ? effectiveSettings.openRouter.imageSize || undefined
            : undefined),
        referenceImages: resolvedReferenceImages,
      })
      setActivePromptRecordId(result.promptRecord.id)
      setStatus('idle')
    } catch (error) {
      setStatus('error')
      setFailedGenerationError(
        isProviderGenerationError(error) ? error : null,
      )
      setGenerationError(buildGenerationErrorMessage(error))
    }
  }

  function buildGenerationErrorMessage(error: unknown) {
    if (isProviderGenerationError(error)) {
      const retryHint = error.retryable ? ' 可重试。' : ''
      const statusHint = error.status ? ` [${error.status}]` : ''
      return `${error.message}${statusHint}${retryHint}`
    }

    return error instanceof Error ? error.message : 'Generation failed'
  }

  function handleRetryFailedGeneration() {
    const lastRequest = lastGenerationRequestRef.current

    if (!lastRequest || status === 'running') {
      return
    }

    void runGeneration(
      lastRequest.prompt,
      lastRequest.overrides,
      lastRequest.settingsOverride,
    )
  }

  function handleRetryFailedRemoteAssets() {
    const failedAssets = Object.values(snapshot.document.assets).filter(
      (asset) => asset.remoteCacheStatus === 'failed',
    )

    if (failedAssets.length === 0) {
      return
    }

    failedAssets.forEach((asset) => {
      attemptedRemoteCacheAssetIdsRef.current.delete(asset.id)
    })

    const nextAssets = { ...snapshot.document.assets }

    failedAssets.forEach((asset) => {
      nextAssets[asset.id] = {
        ...asset,
        remoteCacheStatus: 'pending',
      }
    })

    editor.replaceDocument({
      ...snapshot.document,
      assets: nextAssets,
    })
  }

  function handleRetryFailedDerivatives() {
    const failedDerivativeAssets = Object.values(snapshot.document.assets).filter(
      (asset) => asset.previewStatus === 'failed' || asset.thumbnailStatus === 'failed',
    )

    if (failedDerivativeAssets.length === 0) {
      return
    }

    failedDerivativeAssets.forEach((asset) => {
      derivingAssetIdsRef.current.delete(asset.id)
    })

    const nextAssets = { ...snapshot.document.assets }

    failedDerivativeAssets.forEach((asset) => {
      nextAssets[asset.id] = {
        ...asset,
        previewStatus: asset.previewStatus === 'failed' ? undefined : asset.previewStatus,
        thumbnailStatus:
          asset.thumbnailStatus === 'failed' ? undefined : asset.thumbnailStatus,
      }
    })

    editor.replaceDocument({
      ...snapshot.document,
      assets: nextAssets,
    })
  }

  function handleRetryAssetRemoteCache(assetId: string) {
    const asset = snapshot.document.assets[assetId]

    if (!asset) {
      return
    }

    attemptedRemoteCacheAssetIdsRef.current.delete(assetId)
    editor.replaceDocument({
      ...snapshot.document,
      assets: {
        ...snapshot.document.assets,
        [assetId]: {
          ...asset,
          remoteCacheStatus: 'pending',
        },
      },
    })
  }

  function handleRetryAssetDerivatives(assetId: string) {
    const asset = snapshot.document.assets[assetId]

    if (!asset) {
      return
    }

    derivingAssetIdsRef.current.delete(assetId)
    editor.replaceDocument({
      ...snapshot.document,
      assets: {
        ...snapshot.document.assets,
        [assetId]: {
          ...asset,
          previewStatus: asset.previewStatus === 'failed' ? undefined : asset.previewStatus,
          thumbnailStatus:
            asset.thumbnailStatus === 'failed' ? undefined : asset.thumbnailStatus,
        },
      },
    })
  }

  function getAssetNodeIds(assetId: string) {
    return snapshot.document.nodes
      .filter((node) => node.type === 'image' && node.assetId === assetId)
      .map((node) => node.id)
  }

  function handleSelectAssetNodes(assetId: string) {
    const nodeIds = getAssetNodeIds(assetId)

    if (nodeIds.length === 0) {
      return
    }

    editor.setSelectedNodes(nodeIds)
  }

  function handleFrameAssetNodes(assetId: string) {
    const relatedNodes = snapshot.document.nodes.filter(
      (node) => node.type === 'image' && node.assetId === assetId,
    )

    if (relatedNodes.length === 0 || !stageRef.current) {
      return
    }

    const viewportRect = stageRef.current.getBoundingClientRect()
    const minX = Math.min(...relatedNodes.map((node) => node.x))
    const minY = Math.min(...relatedNodes.map((node) => node.y))
    const maxX = Math.max(...relatedNodes.map((node) => node.x + node.width))
    const maxY = Math.max(...relatedNodes.map((node) => node.y + node.height))
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const zoom = snapshot.document.camera.zoom

    editor.setSelectedNodes(relatedNodes.map((node) => node.id))
    editor.setCamera({
      x: viewportRect.width / 2 - centerX * zoom,
      y: viewportRect.height / 2 - centerY * zoom,
    })
  }

  function handleRemoveReferenceImage(referenceImageId: string) {
    setReferenceImages((currentImages) =>
      currentImages.filter((image) => image.id !== referenceImageId),
    )
  }

  function handleClearReferenceImages() {
    clearCanvasReferenceImages(snapshot.document.id)
    revokeReferencePreviewUrls()
    setReferenceImages([])
  }

  async function handleReferenceFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])

    if (files.length === 0) {
      return
    }

    const nextImages = await Promise.all(
      files
        .filter((file) => file.type.startsWith('image/'))
        .slice(0, 4)
        .map(readReferenceImageFile),
    )

    setReferenceImages((currentImages) => [...currentImages, ...nextImages].slice(0, 4))
    event.target.value = ''
  }

  async function handlePromptPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const imageFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)

    if (imageFiles.length === 0) {
      return
    }

    event.preventDefault()

    const nextImages = await Promise.all(
      imageFiles.slice(0, 4).map(readReferenceImageFile),
    )

    setReferenceImages((currentImages) => [...currentImages, ...nextImages].slice(0, 4))
  }

  async function handleRegeneratePromptRecord(promptRecordId: string) {
    const promptRecord = snapshot.document.prompts?.[promptRecordId]

    if (!promptRecord) {
      return
    }

    setPrompt(promptRecord.prompt)
    setActivePromptRecordId(promptRecord.id)
    const promptParameters = promptRecord.parameters

    if (promptRecord.providerId === 'openrouter') {
      const nextProviderSettings: ProviderSettings = {
        ...providerSettings,
        selectedProviderId: 'openrouter',
        openRouter: {
          ...providerSettings.openRouter,
          ...(promptParameters?.model ? { model: promptParameters.model } : {}),
          ...(promptParameters?.count ? { outputCount: promptParameters.count } : {}),
          ...(promptParameters?.aspectRatio
            ? { aspectRatio: promptParameters.aspectRatio }
            : {}),
          ...(promptParameters?.imageSize !== undefined
            ? { imageSize: promptParameters.imageSize }
            : {}),
        },
      }

      updateProviderSettings(() => nextProviderSettings)
      await runGeneration(
        promptRecord.prompt,
        {
          count: promptParameters?.count,
          aspectRatio: promptParameters?.aspectRatio,
          imageSize: promptParameters?.imageSize,
        },
        nextProviderSettings,
      )
      return
    }

    await runGeneration(promptRecord.prompt, {
      count: promptParameters?.count,
      aspectRatio: promptParameters?.aspectRatio,
      imageSize: promptParameters?.imageSize,
    })
  }

  function markInteractive() {
    if (settleInteractionTimeoutRef.current) {
      window.clearTimeout(settleInteractionTimeoutRef.current)
      settleInteractionTimeoutRef.current = null
    }

    pixiApp.setInteractionState('interactive')
  }

  function scheduleInteractionSettle() {
    if (settleInteractionTimeoutRef.current) {
      window.clearTimeout(settleInteractionTimeoutRef.current)
    }

    settleInteractionTimeoutRef.current = window.setTimeout(() => {
      pixiApp.setInteractionState('settled')
      pixiApp.syncDocument(snapshot.document, snapshot.instance.selectedNodeIds)
      settleInteractionTimeoutRef.current = null
    }, 180)
  }

  function handleRestoreLastDeleted() {
    if (!editor.canRestoreDeletedNode()) {
      return
    }

    editor.beginHistoryBatch()
    editor.restoreLastDeletedNode()
    editor.commitHistoryBatch()
  }

  async function handleOpenWorkspaceDirectory() {
    await hostBridge.openWorkspaceDirectory()
  }

  function handleSelectPromptRecord(promptRecordId: string) {
    const promptRecord = snapshot.document.prompts?.[promptRecordId]

    if (!promptRecord) {
      return
    }

    setActivePromptRecordId(promptRecord.id)
    setPrompt(promptRecord.prompt)

    const outputNodeIds = snapshot.document.nodes
      .filter(
        (node) =>
          node.type === 'image' && promptRecord.outputAssetIds.includes(node.assetId),
      )
      .map((node) => node.id)

    editor.setSelectedNodes(outputNodeIds)
  }

  function handleSwitchCanvas(canvasId: string) {
    const currentWorkspaceSnapshot =
      workspaceSnapshotRef.current ?? createWorkspaceStorageSnapshot(snapshot.document)
    const syncedWorkspaceSnapshot = syncWorkspaceSnapshotDocument(
      currentWorkspaceSnapshot,
      snapshot.document,
    )
    const nextCanvas = syncedWorkspaceSnapshot.canvases[canvasId]?.canvas

    if (!nextCanvas) {
      return
    }

    const nextWorkspaceSnapshot = {
      ...syncedWorkspaceSnapshot,
      activeCanvasId: canvasId,
      project: {
        ...syncedWorkspaceSnapshot.project,
        defaultCanvasId: canvasId,
      },
    }

    commitWorkspaceSnapshot(nextWorkspaceSnapshot)
    editor.replaceDocument(nextCanvas)
    setActivePromptRecordId(null)
  }

  function handleCreateCanvas() {
    const currentWorkspaceSnapshot =
      workspaceSnapshotRef.current ?? createWorkspaceStorageSnapshot(snapshot.document)
    const syncedWorkspaceSnapshot = syncWorkspaceSnapshotDocument(
      currentWorkspaceSnapshot,
      snapshot.document,
    )
    const nextCanvasId = createId('canvas')
    const nextCanvas: CanvasDocument = {
      ...createEmptyDocument(),
      id: nextCanvasId,
      name: `Canvas ${syncedWorkspaceSnapshot.project.canvasIds.length + 1}`,
    }

    const nextWorkspaceSnapshot = {
      ...syncedWorkspaceSnapshot,
      activeCanvasId: nextCanvasId,
      project: {
        ...syncedWorkspaceSnapshot.project,
        defaultCanvasId: nextCanvasId,
        canvasIds: [...syncedWorkspaceSnapshot.project.canvasIds, nextCanvasId],
      },
      canvases: {
        ...syncedWorkspaceSnapshot.canvases,
        [nextCanvasId]: {
          schemaVersion: WORKSPACE_SCHEMA_VERSION,
          canvas: nextCanvas,
        },
      },
    }

    commitWorkspaceSnapshot(nextWorkspaceSnapshot)
    editor.replaceDocument(nextCanvas)
    setActivePromptRecordId(null)
    setPrompt('editorial poster with layered collage')
  }

  function handleDuplicateCurrentCanvas() {
    const currentWorkspaceSnapshot =
      workspaceSnapshotRef.current ?? createWorkspaceStorageSnapshot(snapshot.document)
    const syncedWorkspaceSnapshot = syncWorkspaceSnapshotDocument(
      currentWorkspaceSnapshot,
      snapshot.document,
    )
    const nextCanvasId = createId('canvas')
    const nextCanvas: CanvasDocument = {
      ...snapshot.document,
      id: nextCanvasId,
      name: `${snapshot.document.name} Copy`,
    }

    const currentIndex = syncedWorkspaceSnapshot.project.canvasIds.indexOf(snapshot.document.id)
    const insertIndex = currentIndex >= 0 ? currentIndex + 1 : syncedWorkspaceSnapshot.project.canvasIds.length
    const nextCanvasIds = [...syncedWorkspaceSnapshot.project.canvasIds]
    nextCanvasIds.splice(insertIndex, 0, nextCanvasId)

    const nextWorkspaceSnapshot = {
      ...syncedWorkspaceSnapshot,
      activeCanvasId: nextCanvasId,
      project: {
        ...syncedWorkspaceSnapshot.project,
        defaultCanvasId: nextCanvasId,
        canvasIds: nextCanvasIds,
      },
      canvases: {
        ...syncedWorkspaceSnapshot.canvases,
        [nextCanvasId]: {
          schemaVersion: WORKSPACE_SCHEMA_VERSION,
          canvas: nextCanvas,
        },
      },
    }

    commitWorkspaceSnapshot(nextWorkspaceSnapshot)
    editor.replaceDocument(nextCanvas)
    setActivePromptRecordId(null)
  }

  function handleRenameCanvas(canvasId: string) {
    const currentWorkspaceSnapshot =
      workspaceSnapshotRef.current ?? createWorkspaceStorageSnapshot(snapshot.document)
    const currentCanvas = currentWorkspaceSnapshot.canvases[canvasId]?.canvas

    if (!currentCanvas) {
      return
    }

    const nextName = window.prompt('Rename canvas', currentCanvas.name)?.trim()

    if (!nextName || nextName === currentCanvas.name) {
      return
    }

    const nextCanvas = {
      ...currentCanvas,
      name: nextName,
    }
    const nextWorkspaceSnapshot = {
      ...currentWorkspaceSnapshot,
      canvases: {
        ...currentWorkspaceSnapshot.canvases,
        [canvasId]: {
          ...currentWorkspaceSnapshot.canvases[canvasId],
          canvas: nextCanvas,
        },
      },
    }

    commitWorkspaceSnapshot(nextWorkspaceSnapshot)

    if (snapshot.document.id === canvasId) {
      editor.replaceDocument(nextCanvas)
    }
  }

  function handleDeleteCanvas(canvasId: string) {
    const currentWorkspaceSnapshot =
      workspaceSnapshotRef.current ?? createWorkspaceStorageSnapshot(snapshot.document)
    const syncedWorkspaceSnapshot = syncWorkspaceSnapshotDocument(
      currentWorkspaceSnapshot,
      snapshot.document,
    )

    if (syncedWorkspaceSnapshot.project.canvasIds.length <= 1) {
      return
    }

    const confirmed = window.confirm('Delete this canvas?')

    if (!confirmed) {
      return
    }

    const nextCanvasIds = syncedWorkspaceSnapshot.project.canvasIds.filter(
      (currentCanvasId) => currentCanvasId !== canvasId,
    )
    const nextActiveCanvasId =
      syncedWorkspaceSnapshot.activeCanvasId === canvasId
        ? nextCanvasIds[0]
        : syncedWorkspaceSnapshot.activeCanvasId

    const nextCanvases = { ...syncedWorkspaceSnapshot.canvases }
    deletedCanvasStackRef.current.push({
      canvasId,
      canvasIndex: syncedWorkspaceSnapshot.project.canvasIds.indexOf(canvasId),
      canvasEnvelope: nextCanvases[canvasId],
      referenceImages: loadCanvasReferenceImages(canvasId),
    })
    setDeletedCanvasCount(deletedCanvasStackRef.current.length)
    clearCanvasReferenceImages(canvasId)
    delete nextCanvases[canvasId]

    const nextWorkspaceSnapshot = {
      ...syncedWorkspaceSnapshot,
      activeCanvasId: nextActiveCanvasId,
      project: {
        ...syncedWorkspaceSnapshot.project,
        defaultCanvasId: nextActiveCanvasId,
        canvasIds: nextCanvasIds,
      },
      canvases: nextCanvases,
    }

    commitWorkspaceSnapshot(nextWorkspaceSnapshot)

    if (snapshot.document.id === canvasId) {
      const nextCanvas = nextWorkspaceSnapshot.canvases[nextActiveCanvasId]?.canvas

      if (nextCanvas) {
        editor.replaceDocument(nextCanvas)
      }
    }
  }

  function handleRestoreDeletedCanvas() {
    const currentWorkspaceSnapshot =
      workspaceSnapshotRef.current ?? createWorkspaceStorageSnapshot(snapshot.document)
    const deletedCanvasRecord = deletedCanvasStackRef.current.pop()

    if (!deletedCanvasRecord) {
      return
    }

    const nextCanvasIds = [...currentWorkspaceSnapshot.project.canvasIds]
    nextCanvasIds.splice(
      Math.min(deletedCanvasRecord.canvasIndex, nextCanvasIds.length),
      0,
      deletedCanvasRecord.canvasId,
    )

    const nextWorkspaceSnapshot = {
      ...currentWorkspaceSnapshot,
      activeCanvasId: deletedCanvasRecord.canvasId,
      project: {
        ...currentWorkspaceSnapshot.project,
        defaultCanvasId: deletedCanvasRecord.canvasId,
        canvasIds: nextCanvasIds,
      },
      canvases: {
        ...currentWorkspaceSnapshot.canvases,
        [deletedCanvasRecord.canvasId]: deletedCanvasRecord.canvasEnvelope,
      },
    }

    setDeletedCanvasCount(deletedCanvasStackRef.current.length)
    commitWorkspaceSnapshot(nextWorkspaceSnapshot)
    saveCanvasReferenceImages(
      deletedCanvasRecord.canvasId,
      deletedCanvasRecord.referenceImages,
    )
    setReferenceImages(deletedCanvasRecord.referenceImages)
    editor.replaceDocument(deletedCanvasRecord.canvasEnvelope.canvas)
  }

  function handleMoveCanvas(canvasId: string, direction: 'up' | 'down') {
    const currentWorkspaceSnapshot =
      workspaceSnapshotRef.current ?? createWorkspaceStorageSnapshot(snapshot.document)
    const syncedWorkspaceSnapshot = syncWorkspaceSnapshotDocument(
      currentWorkspaceSnapshot,
      snapshot.document,
    )
    const currentIndex = syncedWorkspaceSnapshot.project.canvasIds.indexOf(canvasId)

    if (currentIndex === -1) {
      return
    }

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1

    if (
      targetIndex < 0 ||
      targetIndex >= syncedWorkspaceSnapshot.project.canvasIds.length
    ) {
      return
    }

    const nextCanvasIds = [...syncedWorkspaceSnapshot.project.canvasIds]
    const [movedCanvasId] = nextCanvasIds.splice(currentIndex, 1)
    nextCanvasIds.splice(targetIndex, 0, movedCanvasId)

    commitWorkspaceSnapshot({
      ...syncedWorkspaceSnapshot,
      project: {
        ...syncedWorkspaceSnapshot.project,
        canvasIds: nextCanvasIds,
      },
    })
  }

  function handleRenameProject() {
    const currentWorkspaceSnapshot =
      workspaceSnapshotRef.current ?? createWorkspaceStorageSnapshot(snapshot.document)
    const nextProjectName = window.prompt(
      'Rename project',
      currentWorkspaceSnapshot.project.projectName,
    )?.trim()

    if (!nextProjectName || nextProjectName === currentWorkspaceSnapshot.project.projectName) {
      return
    }

    commitWorkspaceSnapshot({
      ...currentWorkspaceSnapshot,
      project: {
        ...currentWorkspaceSnapshot.project,
        projectName: nextProjectName,
      },
    })
  }

  function handleRenameCurrentCanvas() {
    handleRenameCanvas(snapshot.document.id)
  }

  function createReferenceAsset(referenceImage: ReferenceImageInput): ImageAsset {
    const previewPlaceholder = createReferencePreviewPlaceholder(referenceImage.name)
    const storedOriginalPath = referenceImage.blobKey
      ? createBlobAssetPath(referenceImage.blobKey)
      : referenceImage.url

    return {
      id: referenceImage.id,
      name: referenceImage.name,
      width: 1024,
      height: 1024,
      thumbnailPath: referenceImage.blobKey ? previewPlaceholder : referenceImage.url,
      previewPath: referenceImage.blobKey ? previewPlaceholder : referenceImage.url,
      originalPath: storedOriginalPath,
      blobKey: referenceImage.blobKey,
      mimeType: referenceImage.mimeType,
      role: 'reference',
      source: referenceImage.name.toLowerCase().startsWith('pasted-')
        ? 'browser-paste'
        : 'browser-upload',
      estimatedTextureBytes: 1024 * 1024 * 4,
      storageState: referenceImage.blobKey ? 'blob-backed' : 'inline',
      offlineAvailable: true,
      remoteCacheStatus: 'cached',
      previewStatus: referenceImage.blobKey ? undefined : 'ready',
      thumbnailStatus: referenceImage.blobKey ? undefined : 'ready',
    }
  }

  function getReferenceImagesFromDocument(document: CanvasDocument): ReferenceImageInput[] {
    return (document.referenceAssetIds ?? [])
      .map((assetId) => document.assets[assetId])
      .filter((asset): asset is ImageAsset => Boolean(asset))
      .map((asset) => ({
        id: asset.id,
        name: asset.name,
        url: asset.originalPath,
        previewUrl: asset.previewPath,
        blobKey: asset.blobKey,
        mimeType: asset.mimeType,
      }))
  }

  function areReferenceImagesEqual(
    left: ReferenceImageInput[],
    right: ReferenceImageInput[],
  ) {
    return JSON.stringify(left) === JSON.stringify(right)
  }

  function revokeReferencePreviewUrls() {
    referencePreviewUrlsRef.current.forEach((previewUrl) => {
      if (previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl)
      }
    })
    referencePreviewUrlsRef.current = []
  }

  function revokeAssetStatusPreviewUrls() {
    assetStatusPreviewUrlsRef.current.forEach((previewUrl) => {
      if (previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl)
      }
    })
    assetStatusPreviewUrlsRef.current = []
  }

  async function hydrateAssetStatusPreviews(assets: ImageAsset[]) {
    const previewEntries = await Promise.all(
      assets.map(async (asset) => [asset.id, await resolveAssetStatusPreview(asset)] as const),
    )

    return Object.fromEntries(previewEntries)
  }

  async function resolveAssetStatusPreview(asset: ImageAsset) {
    const previewCandidates = [asset.thumbnailPath, asset.previewPath, asset.originalPath]

    for (const previewCandidate of previewCandidates) {
      if (previewCandidate.startsWith('asset://blob/')) {
        const blobKey = previewCandidate.replace('asset://blob/', '')
        const blob = await assetBlobStore.loadBlob(blobKey)

        if (blob) {
          return URL.createObjectURL(blob)
        }

        continue
      }

      if (
        previewCandidate.startsWith('data:') ||
        previewCandidate.startsWith('http://') ||
        previewCandidate.startsWith('https://')
      ) {
        return previewCandidate
      }
    }

    return asset.role === 'reference'
      ? createReferencePreviewPlaceholder(asset.name)
      : createGeneratedPreviewPlaceholder(asset.name)
  }

  function renderAssetStatusBadge(
    label: string,
    value: string,
    tone: 'neutral' | 'good' | 'warn' | 'bad' = 'neutral',
  ) {
    return (
      <span className={`asset-status-badge asset-status-badge--${tone}`}>
        {label}: {value}
      </span>
    )
  }

  function createBlobAssetPath(blobKey: string) {
    return `asset://blob/${blobKey}`
  }

  function createReferencePreviewPlaceholder(name: string) {
    const label = (name.trim() || 'Reference').slice(0, 18)
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
        <rect width="320" height="240" rx="18" fill="#231a14" />
        <rect x="18" y="18" width="284" height="204" rx="14" fill="#3a2a1f" />
        <text x="28" y="56" fill="#f4efe6" font-size="18" font-family="Arial, sans-serif">Reference</text>
        <text x="28" y="88" fill="#ffc48b" font-size="14" font-family="Arial, sans-serif">${label}</text>
      </svg>
    `.trim()

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  }

  function serializeReferenceImage(referenceImage: ReferenceImageInput): ReferenceImageInput {
    if (!referenceImage.blobKey) {
      return referenceImage
    }

    return {
      ...referenceImage,
      url: createBlobAssetPath(referenceImage.blobKey),
    }
  }

  async function hydrateReferenceImages(referenceImages: ReferenceImageInput[]) {
    const hydratedReferenceImages = await Promise.all(
      referenceImages.map(async (referenceImage) => {
        if (!referenceImage.blobKey) {
          return {
            ...referenceImage,
            previewUrl: referenceImage.url,
          }
        }

        const blob = await assetBlobStore.loadBlob(referenceImage.blobKey)

        if (!blob) {
          return {
            ...referenceImage,
            previewUrl: createReferencePreviewPlaceholder(referenceImage.name),
          }
        }

        return {
          ...referenceImage,
          previewUrl: URL.createObjectURL(blob),
          mimeType: blob.type || referenceImage.mimeType,
        }
      }),
    )

    return hydratedReferenceImages
  }

  async function resolveReferenceImagesForGeneration(
    currentReferenceImages: ReferenceImageInput[],
  ) {
    return Promise.all(
      currentReferenceImages.map(async (referenceImage) => {
        if (!referenceImage.blobKey) {
          return {
            ...referenceImage,
            url: referenceImage.url,
          }
        }

        const blob = await assetBlobStore.loadBlob(referenceImage.blobKey)

        if (!blob) {
          throw new Error(`Missing blob for reference image: ${referenceImage.name}`)
        }

        return {
          ...referenceImage,
          url: await readBlobAsDataUrl(blob),
          mimeType: blob.type || referenceImage.mimeType,
        }
      }),
    )
  }

  function readBlobAsDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()

      reader.onload = () => {
        if (typeof reader.result !== 'string') {
          reject(new Error('Failed to read blob'))
          return
        }

        resolve(reader.result)
      }

      reader.onerror = () => {
        reject(new Error('Failed to read blob'))
      }

      reader.readAsDataURL(blob)
    })
  }

  function createGeneratedPreviewPlaceholder(name: string) {
    const label = (name.trim() || 'Generated').slice(0, 18)
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
        <rect width="320" height="240" rx="18" fill="#1f1812" />
        <rect x="18" y="18" width="284" height="204" rx="14" fill="#2d2119" />
        <text x="28" y="56" fill="#f4efe6" font-size="18" font-family="Arial, sans-serif">Generated</text>
        <text x="28" y="88" fill="#ffc48b" font-size="14" font-family="Arial, sans-serif">${label}</text>
      </svg>
    `.trim()

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  }

  async function materializeGeneratedAssets(assets: ImageAsset[]) {
    return Promise.all(
      assets.map(async (asset) => {
        try {
          return (await materializeSingleAsset(asset)) ?? asset
        } catch {
          return asset
        }
      }),
    )
  }

  async function materializeSingleAsset(asset: ImageAsset) {
    if (asset.blobKey) {
      return asset
    }

    const blob = await loadGeneratedAssetBlob(asset)

    if (!blob) {
      return null
    }

    await assetBlobStore.saveBlob(asset.id, blob)
    const previewBlobKey = `${asset.id}:preview`
    const thumbnailBlobKey = `${asset.id}:thumbnail`
    const [previewBlob, thumbnailBlob] = await Promise.all([
      createDerivedImageBlob(blob, 960),
      createDerivedImageBlob(blob, 320),
    ])

    if (previewBlob) {
      await assetBlobStore.saveBlob(previewBlobKey, previewBlob)
    }

    if (thumbnailBlob) {
      await assetBlobStore.saveBlob(thumbnailBlobKey, thumbnailBlob)
    }

    const previewPlaceholder =
      asset.role === 'reference'
        ? createReferencePreviewPlaceholder(asset.name)
        : createGeneratedPreviewPlaceholder(asset.name)

    return {
      ...asset,
      originalPath: createBlobAssetPath(asset.id),
      previewPath: previewBlob ? createBlobAssetPath(previewBlobKey) : previewPlaceholder,
      thumbnailPath: thumbnailBlob
        ? createBlobAssetPath(thumbnailBlobKey)
        : previewPlaceholder,
      blobKey: asset.id,
      mimeType: blob.type || asset.mimeType,
      storageState: 'blob-backed',
      offlineAvailable: true,
      remoteCacheStatus: 'cached',
      previewStatus: previewBlob ? 'ready' : 'failed',
      thumbnailStatus: thumbnailBlob ? 'ready' : 'failed',
    }
  }

  async function ensureDerivedAssetVariants(asset: ImageAsset) {
    if (!asset.blobKey) {
      return asset
    }

    const originalBlob = await assetBlobStore.loadBlob(asset.blobKey)

    if (!originalBlob) {
      return {
        ...asset,
        previewStatus: asset.previewStatus ?? 'failed',
        thumbnailStatus: asset.thumbnailStatus ?? 'failed',
      }
    }

    const previewBlobKey = `${asset.id}:preview`
    const thumbnailBlobKey = `${asset.id}:thumbnail`
    const needsPreview = !asset.previewStatus
    const needsThumbnail = !asset.thumbnailStatus
    const [previewBlob, thumbnailBlob] = await Promise.all([
      needsPreview ? createDerivedImageBlob(originalBlob, 960) : Promise.resolve(null),
      needsThumbnail ? createDerivedImageBlob(originalBlob, 320) : Promise.resolve(null),
    ])

    if (previewBlob) {
      await assetBlobStore.saveBlob(previewBlobKey, previewBlob)
    }

    if (thumbnailBlob) {
      await assetBlobStore.saveBlob(thumbnailBlobKey, thumbnailBlob)
    }

    return {
      ...asset,
      previewPath:
        previewBlob || asset.previewStatus === 'ready'
          ? createBlobAssetPath(previewBlobKey)
          : asset.previewPath,
      thumbnailPath:
        thumbnailBlob || asset.thumbnailStatus === 'ready'
          ? createBlobAssetPath(thumbnailBlobKey)
          : asset.thumbnailPath,
      previewStatus:
        asset.previewStatus ?? (previewBlob ? 'ready' : 'failed'),
      thumbnailStatus:
        asset.thumbnailStatus ?? (thumbnailBlob ? 'ready' : 'failed'),
    }
  }

  async function loadGeneratedAssetBlob(asset: ImageAsset) {
    if (asset.originalPath.startsWith('data:')) {
      const response = await fetch(asset.originalPath)
      return response.blob()
    }

    if (/^https?:\/\//.test(asset.originalPath)) {
      try {
        const response = await fetch(asset.originalPath)

        if (!response.ok) {
          return null
        }

        return response.blob()
      } catch {
        return null
      }
    }

    return null
  }

  async function createDerivedImageBlob(blob: Blob, maxEdge: number) {
    try {
      const objectUrl = URL.createObjectURL(blob)
      const image = await loadImageElement(objectUrl)
      const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
      const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale))
      const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale))
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')

      if (!context) {
        URL.revokeObjectURL(objectUrl)
        return null
      }

      canvas.width = targetWidth
      canvas.height = targetHeight
      context.drawImage(image, 0, 0, targetWidth, targetHeight)

      const derivedBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(
          (result) => resolve(result),
          blob.type.startsWith('image/') ? blob.type : 'image/webp',
          0.86,
        )
      })

      URL.revokeObjectURL(objectUrl)
      return derivedBlob
    } catch {
      return null
    }
  }

  function loadImageElement(objectUrl: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()

      image.onload = () => {
        resolve(image)
      }

      image.onerror = () => {
        reject(new Error('Failed to load image for derivative generation'))
      }

      image.src = objectUrl
    })
  }

  function readReferenceImageFile(file: File): Promise<ReferenceImageInput> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      const referenceId = createId('reference')

      reader.onload = () => {
        if (typeof reader.result !== 'string') {
          reject(new Error(`Failed to read ${file.name}`))
          return
        }

        void assetBlobStore.saveBlob(referenceId, file).catch(() => {
          // Keep the data-url path as a fallback when IndexedDB is unavailable.
        })

        resolve({
          id: referenceId,
          name: file.name,
          url: reader.result,
          blobKey: referenceId,
          mimeType: file.type,
        })
      }

      reader.onerror = () => {
        reject(new Error(`Failed to read ${file.name}`))
      }

      reader.readAsDataURL(file)
    })
  }

  return (
    <main className="canvas-shell">
      <aside className="panel">
        <span className="badge">Workspace</span>
        <h1>{workspaceSnapshot?.project.projectName ?? 'Designboard'}</h1>
        <p className="muted">
          The first pass only establishes runtime boundaries. Rendering logic and
          persistence are still intentionally thin.
        </p>
        <p className="muted">Host: {hostBridge.platform}</p>
        <p className="muted">
          Native dialogs: {hostBridge.capabilities.workspaceDialogs ? 'ready' : 'pending'}
        </p>
        <button
          onClick={handleRenameProject}
          style={{ marginTop: 8, width: '100%', padding: '12px 14px' }}
          type="button"
        >
          Rename project
        </button>

        <div className="status-card">
          <h3>Active Canvas</h3>
          <p className="muted">Name: {snapshot.document.name}</p>
          <p className="muted">Nodes: {snapshot.document.nodes.length}</p>
          <p className="muted">Prompts: {activeCanvasPromptCount}</p>
          <p className="muted">Selected: {snapshot.instance.selectedNodeIds.length}</p>
          <button
            onClick={handleRenameCurrentCanvas}
            style={{ marginTop: 12, width: '100%', padding: '12px 14px' }}
            type="button"
          >
            Rename current canvas
          </button>
          <button
            onClick={handleDuplicateCurrentCanvas}
            style={{ marginTop: 12, width: '100%', padding: '12px 14px' }}
            type="button"
          >
            Duplicate current canvas
          </button>
        </div>

        <div className="status-card">
          <h3>Canvases</h3>
          <p className="muted">
            {canvasIds.length} canvas(es) · {deletedCanvasCount} deleted in session
          </p>
          <input
            className="sidebar-input"
            onChange={(event) => setCanvasQuery(event.target.value)}
            placeholder="Filter canvases"
            type="text"
            value={canvasQuery}
          />
          <ul className="canvas-list">
            {filteredCanvasIds.map((canvasId) => {
              const canvasName =
                workspaceSnapshot?.canvases[canvasId]?.canvas.name ?? canvasId
              const canvasIndex = canvasIds.indexOf(canvasId)

              return (
                <li key={canvasId}>
                  <div
                    className={`canvas-item${
                      workspaceSnapshot?.activeCanvasId === canvasId
                        ? ' canvas-item--active'
                        : ''
                    }`}
                  >
                    <button
                      className="canvas-item__main"
                      onClick={() => handleSwitchCanvas(canvasId)}
                      type="button"
                    >
                      {canvasName}
                    </button>
                    <div className="canvas-item__actions">
                      <button
                        className="canvas-item__action"
                        disabled={canvasIndex === 0}
                        onClick={() => handleMoveCanvas(canvasId, 'up')}
                        type="button"
                      >
                        Up
                      </button>
                      <button
                        className="canvas-item__action"
                        disabled={canvasIndex === canvasIds.length - 1}
                        onClick={() => handleMoveCanvas(canvasId, 'down')}
                        type="button"
                      >
                        Down
                      </button>
                      <button
                        className="canvas-item__action"
                        onClick={() => handleRenameCanvas(canvasId)}
                        type="button"
                      >
                        Rename
                      </button>
                      <button
                        className="canvas-item__action"
                        disabled={canvasIds.length <= 1}
                        onClick={() => handleDeleteCanvas(canvasId)}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
          {filteredCanvasIds.length === 0 ? (
            <p className="muted">No canvas matches the current filter.</p>
          ) : null}
          <button
            onClick={handleCreateCanvas}
            style={{ marginTop: 12, width: '100%', padding: '12px 14px' }}
            type="button"
          >
            New canvas
          </button>
          <button
            disabled={deletedCanvasCount === 0}
            onClick={handleRestoreDeletedCanvas}
            style={{ marginTop: 12, width: '100%', padding: '12px 14px' }}
            type="button"
          >
            Restore deleted canvas
          </button>
        </div>

        <ul className="status-list">
          {INITIAL_STATUS.map((item) => (
            <li className="status-card" key={item}>
              {item}
            </li>
          ))}
        </ul>

        <div className="status-card">
          <h3>Generation</h3>
          <p className="muted">Use the active prompt or a history item to iterate.</p>
          <p className="muted">Provider: {providerLabel}</p>
          <label className="field-label" htmlFor="provider-select">
            Provider
          </label>
          <select
            className="sidebar-input"
            id="provider-select"
            onChange={(event) =>
              updateProviderSettings((currentSettings) => ({
                ...currentSettings,
                selectedProviderId:
                  event.target.value === 'openrouter' ? 'openrouter' : 'mock',
              }))
            }
            value={providerSettings.selectedProviderId}
          >
            <option value="mock">Mock</option>
            <option value="openrouter">OpenRouter</option>
          </select>
          {providerSettings.selectedProviderId === 'openrouter' ? (
            <>
              <label className="field-label" htmlFor="openrouter-api-key">
                OpenRouter API Key
              </label>
              <input
                className="sidebar-input"
                id="openrouter-api-key"
                onChange={(event) =>
                  updateProviderSettings((currentSettings) => ({
                    ...currentSettings,
                    openRouter: {
                      ...currentSettings.openRouter,
                      apiKey: event.target.value,
                    },
                  }))
                }
                placeholder="sk-or-v1-..."
                type="password"
                value={providerSettings.openRouter.apiKey}
              />
              <label className="field-label" htmlFor="openrouter-model">
                Model
              </label>
              <input
                className="sidebar-input"
                id="openrouter-model"
                onChange={(event) =>
                  updateProviderSettings((currentSettings) => ({
                    ...currentSettings,
                    openRouter: {
                      ...currentSettings.openRouter,
                      model: event.target.value,
                    },
                  }))
                }
                placeholder="e.g. openai/gpt-image-1"
                type="text"
                value={providerSettings.openRouter.model}
              />
              <label className="field-label" htmlFor="openrouter-app-name">
                App title header
              </label>
              <input
                className="sidebar-input"
                id="openrouter-app-name"
                onChange={(event) =>
                  updateProviderSettings((currentSettings) => ({
                    ...currentSettings,
                    openRouter: {
                      ...currentSettings.openRouter,
                      appName: event.target.value,
                    },
                  }))
                }
                placeholder="Designboard"
                type="text"
                value={providerSettings.openRouter.appName}
              />
              <label className="field-label" htmlFor="openrouter-output-count">
                Output count
              </label>
              <select
                className="sidebar-input"
                id="openrouter-output-count"
                onChange={(event) =>
                  updateProviderSettings((currentSettings) => ({
                    ...currentSettings,
                    openRouter: {
                      ...currentSettings.openRouter,
                      outputCount: Number(event.target.value),
                    },
                  }))
                }
                value={providerSettings.openRouter.outputCount}
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </select>
              <label className="field-label" htmlFor="openrouter-aspect-ratio">
                Aspect ratio
              </label>
              <select
                className="sidebar-input"
                id="openrouter-aspect-ratio"
                onChange={(event) =>
                  updateProviderSettings((currentSettings) => ({
                    ...currentSettings,
                    openRouter: {
                      ...currentSettings.openRouter,
                      aspectRatio: event.target.value,
                    },
                  }))
                }
                value={providerSettings.openRouter.aspectRatio}
              >
                <option value="1:1">1:1</option>
                <option value="2:3">2:3</option>
                <option value="3:2">3:2</option>
                <option value="3:4">3:4</option>
                <option value="4:3">4:3</option>
                <option value="4:5">4:5</option>
                <option value="5:4">5:4</option>
                <option value="9:16">9:16</option>
                <option value="16:9">16:9</option>
                <option value="21:9">21:9</option>
              </select>
              <label className="field-label" htmlFor="openrouter-image-size">
                Image size
              </label>
              <select
                className="sidebar-input"
                id="openrouter-image-size"
                onChange={(event) =>
                  updateProviderSettings((currentSettings) => ({
                    ...currentSettings,
                    openRouter: {
                      ...currentSettings.openRouter,
                      imageSize: event.target.value,
                    },
                  }))
                }
                value={providerSettings.openRouter.imageSize}
              >
                <option value="">Default</option>
                <option value="1K">1K</option>
                <option value="2K">2K</option>
                <option value="4K">4K</option>
              </select>
              <label className="field-label" htmlFor="openrouter-referer">
                HTTP-Referer header
              </label>
              <input
                className="sidebar-input"
                id="openrouter-referer"
                onChange={(event) =>
                  updateProviderSettings((currentSettings) => ({
                    ...currentSettings,
                    openRouter: {
                      ...currentSettings.openRouter,
                      referer: event.target.value,
                    },
                  }))
                }
                placeholder={window.location.origin}
                type="text"
                value={providerSettings.openRouter.referer}
              />
              <p className="muted">
                OpenRouter key 目前只保存在浏览器本地，适合开发调试，不适合正式发布。
              </p>
              <p className="muted">
                `image_size` 目前只保证部分模型支持，尤其是 Gemini 系列。
              </p>
              <label className="field-label" htmlFor="openrouter-reference-images">
                Reference images
              </label>
              <input
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sidebar-input"
                id="openrouter-reference-images"
                multiple
                onChange={(event) => void handleReferenceFileSelection(event)}
                type="file"
              />
              <p className="muted">
                也可以直接把图片粘贴到下方 prompt 输入框里。当前会按 canvas 存到浏览器 session，不落盘。
              </p>
              {referenceImages.length > 0 ? (
                <div className="reference-image-list">
                  {referenceImages.map((referenceImage) => (
                    <div className="reference-image-card" key={referenceImage.id}>
                      <img
                        alt={referenceImage.name}
                        className="reference-image-card__preview"
                        src={referenceImage.previewUrl ?? referenceImage.url}
                      />
                      <div className="reference-image-card__meta">
                        <span className="muted">{referenceImage.name}</span>
                        <button
                          onClick={() => handleRemoveReferenceImage(referenceImage.id)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                  <button onClick={handleClearReferenceImages} type="button">
                    Clear reference images
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
          <textarea
            onPaste={(event) => void handlePromptPaste(event)}
            rows={5}
            style={{ width: '100%', resize: 'vertical' }}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <button
            onClick={() => void runGeneration(prompt)}
            disabled={
              status === 'running' ||
              prompt.trim().length === 0 ||
              (providerSettings.selectedProviderId === 'openrouter' && !openRouterReady)
            }
            style={{ marginTop: 12, width: '100%', padding: '12px 14px' }}
          >
            {status === 'running'
              ? 'Generating...'
              : providerSettings.selectedProviderId === 'openrouter'
                ? 'Generate with OpenRouter'
                : 'Generate mock image'}
          </button>
          {generationError ? <p className="field-error">{generationError}</p> : null}
          {failedGenerationError?.retryable ? (
            <button
              onClick={handleRetryFailedGeneration}
              style={{ marginTop: 12, width: '100%', padding: '12px 14px' }}
              type="button"
            >
              Retry failed request
            </button>
          ) : null}
          <button
            onClick={() => void handleOpenWorkspaceDirectory()}
            disabled={!hostBridge.capabilities.workspaceDialogs}
            style={{ marginTop: 12, width: '100%', padding: '12px 14px' }}
          >
            Open workspace directory
          </button>
          <button
            onClick={handleRestoreLastDeleted}
            disabled={!editor.canRestoreDeletedNode()}
            style={{ marginTop: 12, width: '100%', padding: '12px 14px' }}
          >
            Restore last deleted
          </button>
        </div>
      </aside>

      <section className="canvas-stage">
        <div
          className="canvas-stage__surface"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          ref={stageRef}
        />
        {marqueeRect ? (
          <div
            className="canvas-stage__marquee"
            style={{
              left: marqueeRect.x,
              top: marqueeRect.y,
              width: marqueeRect.width,
              height: marqueeRect.height,
            }}
          />
        ) : null}
      </section>

      <aside className="panel">
        <span className="badge">Runtime Snapshot</span>
        <h2>{snapshot.document.name}</h2>
        <p className="muted">Nodes: {snapshot.document.nodes.length}</p>
        <p className="muted">
          Assets: {Object.keys(snapshot.document.assets).length}
        </p>
        <p className="muted">Trash: {snapshot.document.trash?.length ?? 0}</p>
        <p className="muted">Reference assets: {referenceAssetCount}</p>
        <p className="muted">Blob-backed assets: {blobBackedAssetCount}</p>
        <p className="muted">
          Blob-backed generated: {blobBackedGeneratedAssetCount}
        </p>
        <p className="muted">
          Blob-backed reference: {blobBackedReferenceAssetCount}
        </p>
        <p className="muted">Remote assets: {remoteAssetCount}</p>
        <p className="muted">Offline-ready assets: {offlineReadyAssetCount}</p>
        <p className="muted">Remote cache pending: {remoteCachePendingCount}</p>
        <p className="muted">Remote cache cached: {remoteCacheCachedCount}</p>
        <p className="muted">Remote cache failed: {remoteCacheFailedCount}</p>
        <p className="muted">Preview ready: {previewReadyCount}</p>
        <p className="muted">Preview failed: {previewFailedCount}</p>
        <p className="muted">Thumbnail ready: {thumbnailReadyCount}</p>
        <p className="muted">Thumbnail failed: {thumbnailFailedCount}</p>
        {previewFailedCount + thumbnailFailedCount > 0 ? (
          <button
            onClick={handleRetryFailedDerivatives}
            style={{ marginTop: 12, width: '100%', padding: '12px 14px' }}
            type="button"
          >
            Retry failed derivatives
          </button>
        ) : null}
        {remoteCacheFailedCount > 0 ? (
          <button
            onClick={handleRetryFailedRemoteAssets}
            style={{ marginTop: 12, width: '100%', padding: '12px 14px' }}
            type="button"
          >
            Retry failed remote cache
          </button>
        ) : null}
        <p className="muted">
          Selected: {snapshot.instance.selectedNodeIds.length}
        </p>
        <p className="muted">Zoom: {snapshot.document.camera.zoom.toFixed(2)}</p>
        <p className="muted">Mode: {snapshot.instance.mode}</p>
        <p className="muted">Tool: {snapshot.instance.activeTool}</p>
        <p className="muted">Generation: {status}</p>
        <p className="muted">Persistence: {persistenceStatus}</p>
        <p className="muted">Storage schema: v{WORKSPACE_SCHEMA_VERSION}</p>
        <p className="muted">
          Asset manifest schema: v{ASSET_MANIFEST_SCHEMA_VERSION}
        </p>
        <p className="muted">
          Interaction policy: {pixiApp.getDebugState().interactionState}
        </p>
        <p className="muted">Resource level: {pixiApp.getDebugState().resourceLevel}</p>
        <p className="muted">
          Visible nodes: {pixiApp.getDebugState().visibleNodeCount}
        </p>
        <p className="muted">Near nodes: {pixiApp.getDebugState().nearNodeCount}</p>
        <p className="muted">
          Cached textures: {pixiApp.getDebugState().cachedTextureCount}
        </p>
        <p className="muted">
          Texture bytes: {Math.round(pixiApp.getDebugState().estimatedTextureBytes / 1024)} KB
        </p>
        <p className="muted">
          Pending upgrades: {pixiApp.getDebugState().pendingUpgradeCount}
        </p>
        <p className="muted">
          Upgraded assets: {pixiApp.getDebugState().upgradedAssetCount}
        </p>
        <p className="muted">
          History: undo {editor.canUndo() ? 'ready' : 'empty'} / redo{' '}
          {editor.canRedo() ? 'ready' : 'empty'}
        </p>
        <p className="muted">
          Hint: Shift+Click toggle, Shift+Drag marquee, Delete removes.
        </p>

        <div className="status-card">
          <h3>Generation History</h3>
          {promptHistory.length === 0 ? (
            <p className="muted">No prompt records yet.</p>
          ) : (
            <ul className="history-list">
              {promptHistory.map((promptRecord) => (
                <li key={promptRecord.id}>
                  <div
                    className={`history-card${
                      activePromptRecordId === promptRecord.id ? ' history-card--active' : ''
                    }`}
                  >
                    <button
                      className="history-card__main"
                      onClick={() => handleSelectPromptRecord(promptRecord.id)}
                      type="button"
                    >
                      <strong>{promptRecord.prompt}</strong>
                      <span className="muted">
                        {promptRecord.outputAssetIds.length} output(s) ·{' '}
                        {new Date(promptRecord.createdAt).toLocaleTimeString()}
                      </span>
                      <span className="muted">
                        {promptRecord.providerId}
                        {promptRecord.parameters?.model
                          ? ` · ${promptRecord.parameters.model}`
                          : ''}
                        {promptRecord.parameters?.count
                          ? ` · ${promptRecord.parameters.count}x`
                          : ''}
                        {promptRecord.parameters?.aspectRatio
                          ? ` · ${promptRecord.parameters.aspectRatio}`
                          : ''}
                        {promptRecord.parameters?.imageSize
                          ? ` · ${promptRecord.parameters.imageSize}`
                          : ''}
                        {promptRecord.parameters?.referenceImageCount
                          ? ` · ref ${promptRecord.parameters.referenceImageCount}`
                          : ''}
                      </span>
                    </button>
                    <button
                      className="history-card__action"
                      onClick={() => void handleRegeneratePromptRecord(promptRecord.id)}
                      type="button"
                    >
                      Generate again
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="status-card">
          <h3>Asset Status</h3>
          {selectedImageAssets.length === 0 ? (
            <p className="muted">Select one or more image nodes to inspect asset status.</p>
          ) : (
            <ul className="asset-status-list">
              {selectedImageAssets.map((asset) => (
                <li className="asset-status-card" key={asset.id}>
                  <img
                    alt={asset.name}
                    className="asset-status-card__preview"
                    src={assetStatusPreviewMap[asset.id] ?? createGeneratedPreviewPlaceholder(asset.name)}
                  />
                  <strong>{asset.name}</strong>
                  <div className="asset-status-badges">
                    {renderAssetStatusBadge('Role', asset.role ?? 'unknown')}
                    {renderAssetStatusBadge('Storage', asset.storageState ?? 'unknown')}
                    {renderAssetStatusBadge(
                      'Offline',
                      asset.offlineAvailable ? 'ready' : 'pending',
                      asset.offlineAvailable ? 'good' : 'warn',
                    )}
                    {renderAssetStatusBadge(
                      'Remote cache',
                      asset.remoteCacheStatus ?? 'n/a',
                      asset.remoteCacheStatus === 'cached'
                        ? 'good'
                        : asset.remoteCacheStatus === 'failed'
                          ? 'bad'
                          : asset.remoteCacheStatus === 'pending'
                            ? 'warn'
                            : 'neutral',
                    )}
                    {renderAssetStatusBadge(
                      'Preview',
                      asset.previewStatus ?? 'pending',
                      asset.previewStatus === 'ready'
                        ? 'good'
                        : asset.previewStatus === 'failed'
                          ? 'bad'
                          : 'warn',
                    )}
                    {renderAssetStatusBadge(
                      'Thumbnail',
                      asset.thumbnailStatus ?? 'pending',
                      asset.thumbnailStatus === 'ready'
                        ? 'good'
                        : asset.thumbnailStatus === 'failed'
                          ? 'bad'
                          : 'warn',
                    )}
                  </div>
                  <span className="muted">
                    Blob key: {asset.blobKey ?? 'none'}
                  </span>
                  <div className="asset-status-card__actions">
                    {getAssetNodeIds(asset.id).length > 0 ? (
                      <button
                        onClick={() => handleSelectAssetNodes(asset.id)}
                        type="button"
                      >
                        Select nodes
                      </button>
                    ) : null}
                    {getAssetNodeIds(asset.id).length > 0 ? (
                      <button
                        onClick={() => handleFrameAssetNodes(asset.id)}
                        type="button"
                      >
                        Frame on canvas
                      </button>
                    ) : null}
                    {asset.remoteCacheStatus === 'failed' ? (
                      <button
                        onClick={() => handleRetryAssetRemoteCache(asset.id)}
                        type="button"
                      >
                        Retry remote cache
                      </button>
                    ) : null}
                    {asset.previewStatus === 'failed' || asset.thumbnailStatus === 'failed' ? (
                      <button
                        onClick={() => handleRetryAssetDerivatives(asset.id)}
                        type="button"
                      >
                        Retry derivatives
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </main>
  )
}
