import { createId } from '../../canvas/shared/createId'
import type { CanvasEditor } from '../../canvas/editor/CanvasEditor'
import type { ImageAsset, ImageNode, PromptRecord } from '../../canvas/shared/types'
import type { ImageGenerationProvider } from '../providers/types'

type GenerateFromPromptInput = {
  prompt: string
  count?: number
  aspectRatio?: string
  imageSize?: string
  referenceImages?: Array<{
    id: string
    name: string
    url: string
  }>
}

type GenerationServiceOptions = {
  materializeAssets?: (assets: ImageAsset[]) => Promise<ImageAsset[]>
}

export class GenerationService {
  constructor(
    private readonly editor: CanvasEditor,
    private readonly provider: ImageGenerationProvider,
    private readonly options: GenerationServiceOptions = {},
  ) {}

  async generateFromPrompt(input: GenerateFromPromptInput) {
    const count = input.count ?? 1
    const result = await this.provider.generateImages({
      prompt: input.prompt,
      count,
      aspectRatio: input.aspectRatio,
      imageSize: input.imageSize,
      referenceImages: input.referenceImages,
    })
    const assets = this.options.materializeAssets
      ? await this.options.materializeAssets(result.assets)
      : result.assets

    const existingNodes = this.editor.getSnapshot().document.nodes.length
    const nodes: ImageNode[] = assets.map((asset, index) => ({
      id: createId('node'),
      type: 'image',
      assetId: asset.id,
      x: 120 + (existingNodes + index) * 48,
      y: 120 + (existingNodes + index) * 36,
      width: 320,
      height: 240,
      rotation: 0,
      zIndex: existingNodes + index,
      renderMode: 'cover',
    }))

    const promptRecord: PromptRecord = {
      id: createId('prompt'),
      prompt: input.prompt,
      createdAt: new Date().toISOString(),
      providerId: result.providerId,
      outputAssetIds: assets.map((asset) => asset.id),
      parameters: result.parameters,
    }

    this.editor.beginHistoryBatch()
    this.editor.upsertAssets(assets)
    this.editor.insertNodes(nodes)
    this.editor.upsertPromptRecord(promptRecord)
    this.editor.commitHistoryBatch()

    return {
      assets,
      nodes,
      promptRecord,
    }
  }
}
