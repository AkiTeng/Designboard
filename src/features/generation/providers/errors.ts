export type ProviderGenerationErrorDetails = {
  providerId: string
  code: string
  status?: number
  retryable: boolean
}

export class ProviderGenerationError extends Error {
  readonly providerId: string
  readonly code: string
  readonly status?: number
  readonly retryable: boolean

  constructor(message: string, details: ProviderGenerationErrorDetails) {
    super(message)
    this.name = 'ProviderGenerationError'
    this.providerId = details.providerId
    this.code = details.code
    this.status = details.status
    this.retryable = details.retryable
  }
}

export function isProviderGenerationError(
  error: unknown,
): error is ProviderGenerationError {
  return error instanceof ProviderGenerationError
}
