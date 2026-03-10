export type GenerationProviderId = 'mock' | 'openrouter'

export type OpenRouterProviderSettings = {
  apiKey: string
  model: string
  appName: string
  referer: string
  aspectRatio: string
  imageSize: string
  outputCount: number
}

export type ProviderSettings = {
  selectedProviderId: GenerationProviderId
  openRouter: OpenRouterProviderSettings
}

const PROVIDER_SETTINGS_STORAGE_KEY = 'designboard.provider-settings.v1'

export function createDefaultProviderSettings(): ProviderSettings {
  return {
    selectedProviderId: 'mock',
    openRouter: {
      apiKey: '',
      model: '',
      appName: 'Designboard',
      referer: '',
      aspectRatio: '1:1',
      imageSize: '',
      outputCount: 1,
    },
  }
}

export function loadProviderSettings(): ProviderSettings {
  if (typeof window === 'undefined') {
    return createDefaultProviderSettings()
  }

  const rawValue = window.localStorage.getItem(PROVIDER_SETTINGS_STORAGE_KEY)

  if (!rawValue) {
    return createDefaultProviderSettings()
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<ProviderSettings>
    const defaults = createDefaultProviderSettings()

    return {
      selectedProviderId:
        parsed.selectedProviderId === 'openrouter' ? 'openrouter' : 'mock',
      openRouter: {
        ...defaults.openRouter,
        ...(parsed.openRouter ?? {}),
        outputCount: Math.min(
          4,
          Math.max(1, Number(parsed.openRouter?.outputCount ?? defaults.openRouter.outputCount)),
        ),
      },
    }
  } catch {
    return createDefaultProviderSettings()
  }
}

export function saveProviderSettings(settings: ProviderSettings) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(
    PROVIDER_SETTINGS_STORAGE_KEY,
    JSON.stringify(settings),
  )
}

export function isOpenRouterConfigured(settings: ProviderSettings) {
  return (
    settings.openRouter.apiKey.trim().length > 0 &&
    settings.openRouter.model.trim().length > 0
  )
}
