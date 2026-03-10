import { createId } from '../../canvas/shared/createId'
import type { ImageAsset } from '../../canvas/shared/types'
import type {
  GenerateImagesInput,
  GenerateImagesResult,
  ImageGenerationProvider,
} from './types'
import { ProviderGenerationError } from './errors'

type OpenRouterImageGenerationProviderOptions = {
  apiKey: string
  model: string
  appName?: string
  referer?: string
  aspectRatio?: string
  imageSize?: string
}

type OpenRouterResponse = {
  error?: {
    message?: string
  }
  choices?: Array<{
    message?: {
      images?: Array<{
        image_url?: {
          url?: string
        }
        width?: number
        height?: number
      }>
    }
  }>
}

type OpenRouterImageDescriptor = {
  url: string
  width: number
  height: number
}

function buildAssetName(prompt: string, index: number) {
  const trimmedPrompt = prompt.trim()
  const baseLabel = trimmedPrompt.length > 0 ? trimmedPrompt.slice(0, 32) : 'OpenRouter image'
  return `${baseLabel} #${index + 1}`
}

async function readErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as OpenRouterResponse
    return payload.error?.message || `OpenRouter request failed with ${response.status}`
  } catch {
    return `OpenRouter request failed with ${response.status}`
  }
}

export class OpenRouterImageGenerationProvider implements ImageGenerationProvider {
  readonly id = 'openrouter'
  private readonly maxAttempts = 2

  constructor(
    private readonly options: OpenRouterImageGenerationProviderOptions,
  ) {}

  async generateImages(input: GenerateImagesInput): Promise<GenerateImagesResult> {
    const assets: ImageAsset[] = []

    while (assets.length < input.count) {
      const images = await this.requestImages(input)

      if (images.length === 0) {
        throw new Error('OpenRouter returned no images for this prompt')
      }

      for (const image of images) {
        if (assets.length >= input.count) {
          break
        }

        const assetIndex = assets.length
        assets.push({
          id: createId('asset'),
          name: buildAssetName(input.prompt, assetIndex),
          width: image.width,
          height: image.height,
          thumbnailPath: image.url,
          previewPath: image.url,
          originalPath: image.url,
          role: 'generated',
          source: 'openrouter',
          storageState: /^https?:\/\//.test(image.url) ? 'remote-url' : 'inline',
          offlineAvailable: !/^https?:\/\//.test(image.url),
          remoteCacheStatus: /^https?:\/\//.test(image.url) ? 'pending' : 'cached',
          previewStatus: /^https?:\/\//.test(image.url) ? undefined : 'ready',
          thumbnailStatus: /^https?:\/\//.test(image.url) ? undefined : 'ready',
          estimatedTextureBytes: image.width * image.height * 4,
        })
      }
    }

    return {
      providerId: this.id,
      assets,
      parameters: {
        count: input.count,
        model: this.options.model,
        aspectRatio: input.aspectRatio,
        imageSize: input.imageSize,
        referenceImageCount: input.referenceImages?.length ?? 0,
      },
    }
  }

  private async requestImages(input: GenerateImagesInput) {
    let lastError: unknown = null

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            'Content-Type': 'application/json',
            ...(this.options.referer?.trim()
              ? { 'HTTP-Referer': this.options.referer.trim() }
              : {}),
            ...(this.options.appName?.trim()
              ? { 'X-Title': this.options.appName.trim() }
              : {}),
          },
          body: JSON.stringify({
            model: this.options.model,
            modalities: ['image', 'text'],
            stream: false,
            ...(this.options.aspectRatio || this.options.imageSize
              ? {
                  image_config: {
                    ...(this.options.aspectRatio
                      ? { aspect_ratio: this.options.aspectRatio }
                      : {}),
                    ...(this.options.imageSize
                      ? { image_size: this.options.imageSize }
                      : {}),
                  },
                }
              : {}),
            messages: [
              {
                role: 'user',
                content:
                  hasReferenceImages(input.referenceImages)
                    ? createMultimodalContent(input.prompt, input.referenceImages ?? [])
                    : input.prompt,
              },
            ],
          }),
        })

        if (!response.ok) {
          throw await this.createHttpError(response)
        }

        const payload = (await response.json()) as OpenRouterResponse
        const images = payload.choices?.[0]?.message?.images ?? []

        return images
          .map((image): OpenRouterImageDescriptor | null => {
            const url = image.image_url?.url

            if (!url) {
              return null
            }

            return {
              url,
              width: image.width ?? 1024,
              height: image.height ?? 1024,
            }
          })
          .filter((image): image is OpenRouterImageDescriptor => image !== null)
      } catch (error) {
        lastError = this.normalizeError(error)

        if (
          !(lastError instanceof ProviderGenerationError) ||
          !lastError.retryable ||
          attempt === this.maxAttempts
        ) {
          throw lastError
        }

        await this.wait(attempt * 800)
      }
    }

    throw this.normalizeError(lastError)
  }

  private async createHttpError(response: Response) {
    const message = await readErrorMessage(response)
    const code =
      response.status === 400
        ? 'bad_request'
        : response.status === 401 || response.status === 403
          ? 'auth_error'
          : response.status === 408
            ? 'timeout'
            : response.status === 429
              ? 'rate_limited'
              : response.status >= 500
                ? 'server_error'
                : 'request_failed'
    const retryable =
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500

    return new ProviderGenerationError(message, {
      providerId: this.id,
      code,
      status: response.status,
      retryable,
    })
  }

  private normalizeError(error: unknown) {
    if (error instanceof ProviderGenerationError) {
      return error
    }

    if (error instanceof Error) {
      return new ProviderGenerationError(error.message, {
        providerId: this.id,
        code: 'network_error',
        retryable: true,
      })
    }

    return new ProviderGenerationError('Unknown OpenRouter error', {
      providerId: this.id,
      code: 'unknown_error',
      retryable: false,
    })
  }

  private wait(durationMs: number) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, durationMs)
    })
  }
}

function hasReferenceImages(
  referenceImages?: GenerateImagesInput['referenceImages'],
) {
  return (referenceImages?.length ?? 0) > 0
}

function createMultimodalContent(
  prompt: string,
  referenceImages: NonNullable<GenerateImagesInput['referenceImages']>,
) {
  return [
    {
      type: 'text',
      text: prompt,
    },
    ...referenceImages.map((referenceImage) => ({
      type: 'image_url',
      image_url: {
        url: referenceImage.url,
      },
    })),
  ]
}
