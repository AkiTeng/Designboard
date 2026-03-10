import { createId } from '../../canvas/shared/createId'
import type { ImageAsset } from '../../canvas/shared/types'
import type {
  GenerateImagesInput,
  GenerateImagesResult,
  ImageGenerationProvider,
} from './types'

function createSvgDataUrl(label: string, width: number, height: number) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#d16f34" />
          <stop offset="100%" stop-color="#2b1d13" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)" rx="28" />
      <text x="48" y="90" fill="#fff3e8" font-size="28" font-family="Arial, sans-serif">${label}</text>
    </svg>
  `.trim()

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function createMockAsset(prompt: string, index: number): ImageAsset {
  const width = 960
  const height = 720
  const id = createId('asset')
  const label = `${prompt.slice(0, 24) || 'Untitled'} #${index + 1}`
  const previewPath = createSvgDataUrl(label, width, height)

  return {
    id,
    name: label,
    width,
    height,
    thumbnailPath: previewPath,
    previewPath,
    originalPath: previewPath,
    role: 'generated',
    source: 'mock',
    storageState: 'inline',
    offlineAvailable: true,
    remoteCacheStatus: 'cached',
    previewStatus: 'ready',
    thumbnailStatus: 'ready',
    estimatedTextureBytes: width * height * 4,
  }
}

export class MockImageGenerationProvider implements ImageGenerationProvider {
  readonly id = 'mock'

  async generateImages(input: GenerateImagesInput): Promise<GenerateImagesResult> {
    const assets = Array.from({ length: input.count }, (_, index) =>
      createMockAsset(input.prompt, index),
    )

    return {
      providerId: this.id,
      assets,
      parameters: {
        count: input.count,
        referenceImageCount: input.referenceImages?.length ?? 0,
      },
    }
  }
}
