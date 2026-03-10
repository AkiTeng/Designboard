import {
  type CameraState,
  type CanvasDocument,
  type CanvasInstanceState,
  type CanvasNode,
  type EditorSnapshot,
  type ImageAsset,
  type PromptRecord,
  type TrashItem,
  createEmptyDocument,
  createInitialInstanceState,
} from '../shared/types'
import { createId } from '../shared/createId'

type EditorListener = (snapshot: EditorSnapshot) => void
type SelectionMode = 'replace' | 'add' | 'toggle'

function cloneSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  return {
    document: JSON.parse(JSON.stringify(snapshot.document)) as CanvasDocument,
    instance: JSON.parse(JSON.stringify(snapshot.instance)) as CanvasInstanceState,
  }
}

export class CanvasEditor {
  private document: CanvasDocument
  private instance: CanvasInstanceState
  private listeners = new Set<EditorListener>()
  private undoStack: EditorSnapshot[] = []
  private redoStack: EditorSnapshot[] = []
  private historyBatchSnapshot: EditorSnapshot | null = null

  constructor(document: CanvasDocument = createEmptyDocument()) {
    this.document = document
    this.instance = createInitialInstanceState()
  }

  getSnapshot(): EditorSnapshot {
    return {
      document: this.document,
      instance: this.instance,
    }
  }

  subscribe(listener: EditorListener): () => void {
    this.listeners.add(listener)
    listener(this.getSnapshot())

    return () => {
      this.listeners.delete(listener)
    }
  }

  setCamera(camera: Partial<CameraState>) {
    const nextCamera = {
      ...this.document.camera,
      ...camera,
    }

    if (
      nextCamera.x === this.document.camera.x &&
      nextCamera.y === this.document.camera.y &&
      nextCamera.zoom === this.document.camera.zoom
    ) {
      return
    }

    this.document = {
      ...this.document,
      camera: nextCamera,
    }
    this.emit()
  }

  setMode(mode: CanvasInstanceState['mode']) {
    if (this.instance.mode === mode) {
      return
    }

    this.instance = {
      ...this.instance,
      mode,
    }
    this.emit()
  }

  setActiveTool(activeTool: CanvasInstanceState['activeTool']) {
    if (this.instance.activeTool === activeTool) {
      return
    }

    this.instance = {
      ...this.instance,
      activeTool,
    }
    this.emit()
  }

  replaceDocument(document: CanvasDocument) {
    this.document = document
    this.emit()
  }

  beginHistoryBatch() {
    if (this.historyBatchSnapshot) {
      return
    }

    this.historyBatchSnapshot = cloneSnapshot(this.getSnapshot())
  }

  commitHistoryBatch() {
    if (!this.historyBatchSnapshot) {
      return
    }

    const before = this.historyBatchSnapshot
    this.historyBatchSnapshot = null

    if (JSON.stringify(before.document) === JSON.stringify(this.document)) {
      return
    }

    this.undoStack.push(before)
    this.redoStack = []
    this.emit()
  }

  undo() {
    const previous = this.undoStack.pop()

    if (!previous) {
      return
    }

    this.redoStack.push(cloneSnapshot(this.getSnapshot()))
    this.restoreSnapshot(previous)
  }

  redo() {
    const next = this.redoStack.pop()

    if (!next) {
      return
    }

    this.undoStack.push(cloneSnapshot(this.getSnapshot()))
    this.restoreSnapshot(next)
  }

  canUndo() {
    return this.undoStack.length > 0
  }

  canRedo() {
    return this.redoStack.length > 0
  }

  insertNodes(nodes: CanvasNode[]) {
    this.captureHistoryIfNeeded()
    this.document = {
      ...this.document,
      nodes: [...this.document.nodes, ...nodes],
    }
    this.emit()
  }

  upsertAssets(assets: ImageAsset[]) {
    this.captureHistoryIfNeeded()
    const nextAssets = { ...this.document.assets }

    assets.forEach((asset) => {
      nextAssets[asset.id] = asset
    })

    this.document = {
      ...this.document,
      assets: nextAssets,
    }
    this.emit()
  }

  replaceReferenceAssets(referenceAssets: ImageAsset[]) {
    const currentReferenceAssetIds = this.document.referenceAssetIds ?? []
    const currentReferenceAssets = currentReferenceAssetIds
      .map((assetId) => this.document.assets[assetId])
      .filter((asset): asset is ImageAsset => Boolean(asset))
    const nextReferenceAssetIds = referenceAssets.map((asset) => asset.id)

    if (
      JSON.stringify(currentReferenceAssets) === JSON.stringify(referenceAssets) &&
      JSON.stringify(currentReferenceAssetIds) === JSON.stringify(nextReferenceAssetIds)
    ) {
      return
    }

    this.captureHistoryIfNeeded()
    const nextAssets = { ...this.document.assets }

    currentReferenceAssetIds.forEach((assetId) => {
      delete nextAssets[assetId]
    })

    referenceAssets.forEach((asset) => {
      nextAssets[asset.id] = asset
    })

    this.document = {
      ...this.document,
      assets: nextAssets,
      referenceAssetIds: nextReferenceAssetIds,
    }
    this.emit()
  }

  upsertPromptRecord(promptRecord: PromptRecord) {
    this.captureHistoryIfNeeded()
    this.document = {
      ...this.document,
      prompts: {
        ...this.document.prompts,
        [promptRecord.id]: promptRecord,
      },
    }
    this.emit()
  }

  selectNode(nodeId: string | null, mode: SelectionMode = 'replace') {
    let nextSelectedNodeIds: string[] = []

    if (!nodeId) {
      nextSelectedNodeIds = []
    } else if (mode === 'replace') {
      nextSelectedNodeIds = [nodeId]
    } else if (mode === 'add') {
      nextSelectedNodeIds = this.instance.selectedNodeIds.includes(nodeId)
        ? this.instance.selectedNodeIds
        : [...this.instance.selectedNodeIds, nodeId]
    } else {
      nextSelectedNodeIds = this.instance.selectedNodeIds.includes(nodeId)
        ? this.instance.selectedNodeIds.filter((selectedNodeId) => selectedNodeId !== nodeId)
        : [...this.instance.selectedNodeIds, nodeId]
    }

    if (
      nextSelectedNodeIds.length === this.instance.selectedNodeIds.length &&
      nextSelectedNodeIds.every(
        (selectedNodeId, index) => this.instance.selectedNodeIds[index] === selectedNodeId,
      )
    ) {
      return
    }

    this.instance = {
      ...this.instance,
      selectedNodeIds: nextSelectedNodeIds,
    }
    this.emit()
  }

  setSelectedNodes(nodeIds: string[]) {
    if (
      nodeIds.length === this.instance.selectedNodeIds.length &&
      nodeIds.every(
        (nodeId, index) => this.instance.selectedNodeIds[index] === nodeId,
      )
    ) {
      return
    }

    this.instance = {
      ...this.instance,
      selectedNodeIds: nodeIds,
    }
    this.emit()
  }

  removeNodes(nodeIds: string[]) {
    if (nodeIds.length === 0) {
      return
    }

    this.captureHistoryIfNeeded()
    const nodeIdSet = new Set(nodeIds)
    const deletedNodes = this.document.nodes.filter((node) => nodeIdSet.has(node.id))
    const trashItems: TrashItem[] = deletedNodes.map((node) => ({
      id: createId('trash'),
      node,
      deletedAt: new Date().toISOString(),
    }))

    this.document = {
      ...this.document,
      nodes: this.document.nodes.filter((node) => !nodeIdSet.has(node.id)),
      trash: [...(this.document.trash ?? []), ...trashItems],
    }

    this.instance = {
      ...this.instance,
      selectedNodeIds: this.instance.selectedNodeIds.filter(
        (selectedNodeId) => !nodeIdSet.has(selectedNodeId),
      ),
      hoveredNodeId:
        this.instance.hoveredNodeId && nodeIdSet.has(this.instance.hoveredNodeId)
          ? null
          : this.instance.hoveredNodeId,
    }
    this.emit()
  }

  removeSelectedNodes() {
    this.removeNodes(this.instance.selectedNodeIds)
  }

  restoreLastDeletedNode() {
    const trash = this.document.trash ?? []
    const lastTrashItem = trash[trash.length - 1]

    if (!lastTrashItem) {
      return
    }

    this.captureHistoryIfNeeded()
    this.document = {
      ...this.document,
      nodes: [...this.document.nodes, lastTrashItem.node],
      trash: trash.slice(0, -1),
    }

    this.instance = {
      ...this.instance,
      selectedNodeIds: [lastTrashItem.node.id],
      hoveredNodeId: null,
    }
    this.emit()
  }

  canRestoreDeletedNode() {
    return (this.document.trash?.length ?? 0) > 0
  }

  setHoveredNode(nodeId: string | null) {
    if (this.instance.hoveredNodeId === nodeId) {
      return
    }

    this.instance = {
      ...this.instance,
      hoveredNodeId: nodeId,
    }
    this.emit()
  }

  getNode(nodeId: string) {
    return this.document.nodes.find((node) => node.id === nodeId) ?? null
  }

  updateNodePosition(nodeId: string, position: { x: number; y: number }) {
    const currentNode = this.getNode(nodeId)

    if (!currentNode) {
      return
    }

    if (currentNode.x === position.x && currentNode.y === position.y) {
      return
    }

    this.captureHistoryIfNeeded()
    this.document = {
      ...this.document,
      nodes: this.document.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              x: position.x,
              y: position.y,
            }
          : node,
      ),
    }
    this.emit()
  }

  private emit() {
    const snapshot = this.getSnapshot()
    this.listeners.forEach((listener) => listener(snapshot))
  }

  private captureHistoryIfNeeded() {
    if (this.historyBatchSnapshot) {
      return
    }

    this.undoStack.push(cloneSnapshot(this.getSnapshot()))
    this.redoStack = []
  }

  private restoreSnapshot(snapshot: EditorSnapshot) {
    const nextSnapshot = cloneSnapshot(snapshot)
    this.document = nextSnapshot.document
    this.instance = {
      ...nextSnapshot.instance,
      mode: 'idle',
      hoveredNodeId: null,
    }
    this.emit()
  }
}
