import { Texture } from 'pixi.js'
import type { ImageAsset, ResourceLevel } from '../shared/types'

type CachedTexture = {
  texture: Texture
  lastUsedAt: number
  estimatedBytes: number
  resolved: boolean
}

function resolveAssetPath(asset: ImageAsset, level: ResourceLevel) {
  if (level === 'thumbnail') {
    return asset.thumbnailPath
  }

  if (level === 'original') {
    return asset.originalPath
  }

  return asset.previewPath
}

export class AssetManager {
  private readonly textureCache = new Map<string, CachedTexture>()
  private readonly pendingBlobLoads = new Set<string>()
  private readonly resolvedBlobUrls = new Map<string, string>()

  constructor(
    private readonly resolveBlobUrl?: (blobKey: string) => Promise<string | null>,
    private readonly onAssetResolved?: () => void,
  ) {}

  getPreferredResourceLevel(
    zoom: number,
    interactionState: 'interactive' | 'settled',
  ): ResourceLevel {
    if (zoom <= 0.6) {
      return 'thumbnail'
    }

    if (interactionState === 'interactive') {
      return 'preview'
    }

    if (zoom >= 1.8) {
      return 'original'
    }

    return 'preview'
  }

  getTexture(asset: ImageAsset, level: ResourceLevel): Texture {
    const cacheKey = `${asset.id}:${level}`
    const cachedTexture = this.textureCache.get(cacheKey)
    const assetPath = resolveAssetPath(asset, level)
    const blobKey = this.extractBlobKey(assetPath)

    if (cachedTexture && (!blobKey || cachedTexture.resolved)) {
      cachedTexture.lastUsedAt = Date.now()
      return cachedTexture.texture
    }

    if (blobKey) {
      const resolvedBlobUrl = this.resolvedBlobUrls.get(blobKey)

      if (resolvedBlobUrl) {
        if (cachedTexture) {
          cachedTexture.texture.destroy(false)
          this.textureCache.delete(cacheKey)
        }

        const texture = Texture.from(resolvedBlobUrl)
        this.textureCache.set(cacheKey, {
          texture,
          lastUsedAt: Date.now(),
          estimatedBytes: this.estimateTextureBytes(asset, level),
          resolved: true,
        })
        return texture
      }

      this.scheduleBlobResolution(blobKey, asset.id)

      if (cachedTexture) {
        cachedTexture.lastUsedAt = Date.now()
        return cachedTexture.texture
      }
    }

    const texture = Texture.from(
      blobKey ? this.getFallbackRenderablePath(asset, level) : assetPath,
    )
    this.textureCache.set(cacheKey, {
      texture,
      lastUsedAt: Date.now(),
      estimatedBytes: this.estimateTextureBytes(asset, level),
      resolved: !blobKey,
    })
    return texture
  }

  prefetchTexture(asset: ImageAsset, level: ResourceLevel) {
    void this.getTexture(asset, level)
  }

  createCacheKey(assetId: string, level: ResourceLevel) {
    return `${assetId}:${level}`
  }

  prune(activeTextureKeys: Set<string>, maxEntries = 48, maxBytes = 256 * 1024 * 1024) {
    const removableEntries = [...this.textureCache.entries()]
      .filter(([cacheKey]) => !activeTextureKeys.has(cacheKey))
      .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)

    while (
      this.textureCache.size > maxEntries ||
      this.getTotalEstimatedBytes() > maxBytes ||
      (removableEntries.length > 0 && this.textureCache.size > activeTextureKeys.size)
    ) {
      const nextEntry = removableEntries.shift()

      if (!nextEntry) {
        break
      }

      const [cacheKey, cachedTexture] = nextEntry
      cachedTexture.texture.destroy(false)
      this.textureCache.delete(cacheKey)
    }
  }

  getDebugState() {
    return {
      cachedTextureCount: this.textureCache.size,
      estimatedTextureBytes: this.getTotalEstimatedBytes(),
    }
  }

  destroy() {
    this.textureCache.forEach(({ texture }) => texture.destroy(false))
    this.textureCache.clear()
    this.resolvedBlobUrls.forEach((resolvedBlobUrl) => URL.revokeObjectURL(resolvedBlobUrl))
    this.resolvedBlobUrls.clear()
    this.pendingBlobLoads.clear()
  }

  private getTotalEstimatedBytes() {
    return [...this.textureCache.values()].reduce(
      (total, cachedTexture) => total + cachedTexture.estimatedBytes,
      0,
    )
  }

  private estimateTextureBytes(asset: ImageAsset, level: ResourceLevel) {
    const baselineBytes = asset.estimatedTextureBytes ?? asset.width * asset.height * 4

    if (level === 'thumbnail') {
      return Math.round(baselineBytes * 0.1)
    }

    if (level === 'preview') {
      return Math.round(baselineBytes * 0.4)
    }

    return baselineBytes
  }

  private getFallbackRenderablePath(asset: ImageAsset, level: ResourceLevel) {
    if (level === 'thumbnail') {
      return asset.thumbnailPath
    }

    if (level === 'original') {
      return asset.previewPath
    }

    return asset.previewPath
  }

  private extractBlobKey(assetPath: string) {
    return assetPath.startsWith('asset://blob/')
      ? assetPath.replace('asset://blob/', '')
      : null
  }

  private scheduleBlobResolution(blobKey: string, assetId: string) {
    if (!this.resolveBlobUrl || this.pendingBlobLoads.has(blobKey)) {
      return
    }

    this.pendingBlobLoads.add(blobKey)

    void this.resolveBlobUrl(blobKey)
      .then((resolvedBlobUrl) => {
        if (!resolvedBlobUrl) {
          return
        }

        this.resolvedBlobUrls.set(blobKey, resolvedBlobUrl)

        for (const [cacheKey, cachedTexture] of this.textureCache.entries()) {
          if (!cacheKey.startsWith(`${assetId}:`)) {
            continue
          }

          cachedTexture.texture.destroy(false)
          this.textureCache.delete(cacheKey)
        }

        this.onAssetResolved?.()
      })
      .finally(() => {
        this.pendingBlobLoads.delete(blobKey)
      })
  }
}
