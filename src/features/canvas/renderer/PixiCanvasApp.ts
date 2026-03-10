import { Application, Container, Graphics, Sprite, Text } from 'pixi.js'
import { AssetManager } from '../assets/AssetManager'
import type { CanvasDocument, ImageNode, ResourceLevel } from '../shared/types'
import type { AssetBlobStore } from '../../projects/storage/assetBlobStore'

export class PixiCanvasApp {
  private app: Application | null = null
  private rootContainer: Container | null = null
  private grid: Graphics | null = null
  private assetManager: AssetManager
  private currentResourceLevel: ResourceLevel = 'preview'
  private visibleNodeCount = 0
  private nearNodeCount = 0
  private interactionState: 'interactive' | 'settled' = 'settled'
  private pendingUpgradeCount = 0
  private upgradedAssetCount = 0
  private upgradeTimeoutId: number | null = null
  private upgradedAssetLevels = new Map<string, ResourceLevel>()
  private lastDocument: CanvasDocument | null = null
  private lastSelectedNodeIds: string[] = []

  constructor(private readonly assetBlobStore?: AssetBlobStore) {
    this.assetManager = new AssetManager(
      async (blobKey) => {
        if (!this.assetBlobStore) {
          return null
        }

        const blob = await this.assetBlobStore.loadBlob(blobKey)
        return blob ? URL.createObjectURL(blob) : null
      },
      () => {
        if (this.lastDocument) {
          this.syncDocument(this.lastDocument, this.lastSelectedNodeIds)
        }
      },
    )
  }

  async mount(element: HTMLElement) {
    if (this.app) {
      return
    }

    this.app = new Application()
    await this.app.init({
      antialias: true,
      autoDensity: true,
      backgroundAlpha: 0,
      resizeTo: element,
    })

    this.rootContainer = new Container()
    this.grid = new Graphics()

    this.app.stage.addChild(this.grid)
    this.app.stage.addChild(this.rootContainer)
    element.appendChild(this.app.canvas)
    this.drawGrid(element.clientWidth, element.clientHeight)
  }

  syncDocument(document: CanvasDocument, selectedNodeIds: string[] = []) {
    if (!this.rootContainer) {
      return
    }

    this.lastDocument = document
    this.lastSelectedNodeIds = selectedNodeIds

    const preferredResourceLevel = this.assetManager.getPreferredResourceLevel(
      document.camera.zoom,
      this.interactionState,
    )

    if (this.interactionState === 'settled' && preferredResourceLevel === 'original') {
      this.currentResourceLevel = 'preview'
      this.renderScene(document, selectedNodeIds, this.currentResourceLevel)
      this.scheduleVisibleUpgrade(document, selectedNodeIds)
      return
    }

    this.cancelPendingUpgrade()
    this.currentResourceLevel = preferredResourceLevel
    this.renderScene(document, selectedNodeIds, this.currentResourceLevel)
  }

  destroy() {
    this.app?.destroy(true, { children: true })
    this.assetManager.destroy()
    this.app = null
    this.rootContainer = null
    this.grid = null
  }

  getCurrentResourceLevel() {
    return this.currentResourceLevel
  }

  getDebugState() {
    return {
      interactionState: this.interactionState,
      resourceLevel: this.currentResourceLevel,
      visibleNodeCount: this.visibleNodeCount,
      nearNodeCount: this.nearNodeCount,
      pendingUpgradeCount: this.pendingUpgradeCount,
      upgradedAssetCount: this.upgradedAssetLevels.size,
      ...this.assetManager.getDebugState(),
    }
  }

  setInteractionState(nextState: 'interactive' | 'settled') {
    if (nextState === 'interactive') {
      this.cancelPendingUpgrade()
    }

    this.interactionState = nextState
  }

  private drawGrid(width: number, height: number) {
    if (!this.grid) {
      return
    }

    this.grid.clear()

    const step = 48

    for (let x = 0; x <= width; x += step) {
      this.grid.moveTo(x, 0)
      this.grid.lineTo(x, height)
    }

    for (let y = 0; y <= height; y += step) {
      this.grid.moveTo(0, y)
      this.grid.lineTo(width, y)
    }

    this.grid.stroke({
      width: 1,
      color: 0x2d2722,
      alpha: 1,
    })
  }

  private createImageNode(
    node: ImageNode,
    document: CanvasDocument,
    isSelected: boolean,
    resourceLevel: ResourceLevel,
  ) {
    const container = new Container()
    const card = new Graphics()
    const asset = document.assets[node.assetId]

    card.roundRect(0, 0, node.width, node.height, 18)
    card.fill(0x2a2018)
    card.stroke({
      width: isSelected ? 4 : 2,
      color: isSelected ? 0xffd7b0 : 0xe59c63,
      alpha: isSelected ? 1 : 0.9,
    })

    const preview = asset
      ? new Sprite(
          this.assetManager.getTexture(asset, resourceLevel),
        )
      : new Graphics().rect(0, 0, node.width, node.height).fill(0x4a3122)

    preview.x = 0
    preview.y = 0
    preview.width = node.width
    preview.height = node.height

    const label = new Text({
      text: asset?.name ?? 'Missing Asset',
      style: {
        fill: '#fff3e8',
        fontSize: 16,
      },
    })

    label.x = 16
    label.y = node.height - 34

    container.x = node.x
    container.y = node.y
    container.addChild(card)
    container.addChild(preview)
    container.addChild(label)

    return container
  }

  private renderScene(
    document: CanvasDocument,
    selectedNodeIds: string[],
    resourceLevel: ResourceLevel,
  ) {
    if (!this.rootContainer) {
      return
    }

    this.rootContainer.position.set(document.camera.x, document.camera.y)
    this.rootContainer.scale.set(document.camera.zoom)
    this.rootContainer.removeChildren().forEach((child) => child.destroy())
    this.visibleNodeCount = 0
    this.nearNodeCount = 0

    const activeTextureKeys = new Set<string>()
    const visibleNodes = document.nodes.filter((node) =>
      this.isNodeVisible(node, document, 200),
    )
    const nearNodes = document.nodes.filter((node) =>
      this.isNodeVisible(node, document, 800),
    )

    this.visibleNodeCount = visibleNodes.length
    this.nearNodeCount = nearNodes.length

    visibleNodes.forEach((node) => {
      if (node.type === 'image') {
        const nodeResourceLevel =
          this.upgradedAssetLevels.get(node.assetId) ?? resourceLevel
        activeTextureKeys.add(
          this.assetManager.createCacheKey(node.assetId, nodeResourceLevel),
        )
        this.rootContainer?.addChild(
          this.createImageNode(
            node,
            document,
            selectedNodeIds.includes(node.id),
            nodeResourceLevel,
          ),
        )
      }
    })

    nearNodes.forEach((node) => {
      if (node.type !== 'image') {
        return
      }

      const asset = document.assets[node.assetId]

      if (!asset) {
        return
      }

      const cacheKey = this.assetManager.createCacheKey(node.assetId, resourceLevel)
      activeTextureKeys.add(cacheKey)
      this.assetManager.prefetchTexture(asset, resourceLevel)
    })

    this.assetManager.prune(activeTextureKeys)
  }

  private scheduleVisibleUpgrade(document: CanvasDocument, selectedNodeIds: string[]) {
    this.cancelPendingUpgrade()

    const visibleAssets = document.nodes
      .filter((node) => node.type === 'image' && this.isNodeVisible(node, document, 200))
      .map((node) => document.assets[node.assetId])
      .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))

    const uniqueAssets = [...new Map(visibleAssets.map((asset) => [asset.id, asset])).values()]

    if (uniqueAssets.length === 0) {
      return
    }

    const queue = [...uniqueAssets]
    this.pendingUpgradeCount = queue.length
    this.upgradedAssetCount = 0
    this.upgradedAssetLevels.clear()

    const runBatch = () => {
      const batch = queue.splice(0, 4)

      batch.forEach((asset) => {
        this.assetManager.prefetchTexture(asset, 'original')
        this.upgradedAssetLevels.set(asset.id, 'original')
      })

      this.upgradedAssetCount = this.upgradedAssetLevels.size
      this.pendingUpgradeCount = queue.length
      this.renderScene(document, selectedNodeIds, this.currentResourceLevel)

      if (queue.length > 0) {
        this.upgradeTimeoutId = window.setTimeout(runBatch, 30)
        return
      }

      this.upgradeTimeoutId = null
    }

    this.upgradeTimeoutId = window.setTimeout(runBatch, 30)
  }

  private cancelPendingUpgrade() {
    if (this.upgradeTimeoutId) {
      window.clearTimeout(this.upgradeTimeoutId)
      this.upgradeTimeoutId = null
    }

    this.pendingUpgradeCount = 0
    this.upgradedAssetLevels.clear()
    this.upgradedAssetCount = 0
  }

  private isNodeVisible(
    node: CanvasDocument['nodes'][number],
    document: CanvasDocument,
    margin: number,
  ) {
    if (!this.app || node.hidden) {
      return false
    }

    const viewportLeft = (-document.camera.x / document.camera.zoom) - margin
    const viewportTop = (-document.camera.y / document.camera.zoom) - margin
    const viewportWidth = this.app.screen.width / document.camera.zoom + margin * 2
    const viewportHeight = this.app.screen.height / document.camera.zoom + margin * 2

    return !(
      node.x + node.width < viewportLeft ||
      node.x > viewportLeft + viewportWidth ||
      node.y + node.height < viewportTop ||
      node.y > viewportTop + viewportHeight
    )
  }
}
