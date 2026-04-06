/**
 * Error thrown when server returns HTML instead of JSON
 */
export class ApiResponseError extends Error {
  statusCode?: number
  
  constructor(message: string, statusCode?: number) {
    super(message)
    this.name = 'ApiResponseError'
    this.statusCode = statusCode
  }
}

/**
 * Validates that a fetch response is valid JSON and has an OK status
 * @throws {ApiResponseError} if response is not valid JSON or has error status
 */
export async function validateJsonResponse(response: Response): Promise<void> {
  const contentType = response.headers.get('content-type')
  
  // Reject HTML responses (likely error pages or SPA fallback)
  if (contentType && contentType.includes('text/html')) {
    throw new ApiResponseError(
      'Unable to connect to API server. Please check your connection and try again.',
      response.status
    )
  }
  
  // For non-OK responses, try to extract error info
  if (!response.ok) {
    try {
      const text = await response.text()
      // Try to parse as JSON for error details
      try {
        const errorData = JSON.parse(text)
        throw new ApiResponseError(
          errorData.error || errorData.message || `HTTP ${response.status}`,
          response.status
        )
      } catch (parseErr) {
        // Not JSON, use text or status
        throw new ApiResponseError(
          text || `HTTP ${response.status}`,
          response.status
        )
      }
    } catch (e) {
      if (e instanceof ApiResponseError) throw e
      throw new ApiResponseError(`HTTP ${response.status}`, response.status)
    }
  }
}

/**
 * Fetches JSON from an API endpoint with proper error handling
 * @returns Parsed JSON response
 * @throws {ApiResponseError} if response is invalid
 */
export async function fetchJson<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, options)
  await validateJsonResponse(response)
  try {
    return await response.json()
  } catch {
    const contentType = response.headers.get('content-type') || 'unknown content-type'
    throw new ApiResponseError(`Server returned ${contentType} instead of JSON`, response.status)
  }
}
