import type { ImageAsset } from '../../canvas/shared/types'

export type ReferenceImageInput = {
  id: string
  name: string
  url: string
  previewUrl?: string
  blobKey?: string
  mimeType?: string
}

export type GenerateImagesInput = {
  prompt: string
  count: number
  aspectRatio?: string
  imageSize?: string
  referenceImages?: ReferenceImageInput[]
}

export type GenerationParametersSnapshot = {
  count: number
  model?: string
  aspectRatio?: string
  imageSize?: string
  referenceImageCount?: number
}

export type GenerateImagesResult = {
  providerId: string
  assets: ImageAsset[]
  parameters: GenerationParametersSnapshot
}

export interface ImageGenerationProvider {
  id: string
  generateImages(input: GenerateImagesInput): Promise<GenerateImagesResult>
}
