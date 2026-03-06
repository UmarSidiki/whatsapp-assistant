import { logger } from "./logger";

/**
 * Custom error class for provider-related errors
 */
export class ProviderError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/**
 * Abstract interface for AI providers
 */
export interface AIProvider {
  name: string;
  apiKeys: string[];
  currentKeyIndex: number;

  /**
   * Generate a response from the AI model
   */
  generateResponse(prompt: string, context?: string): Promise<string>;

  /**
   * Check if the provider is under rate limit
   * @returns true if under limit, false if approaching limit
   */
  checkRateLimit(): Promise<boolean>;

  /**
   * Get remaining API quota for the current API key
   */
  getRemainingQuota(): Promise<number>;
}

/**
 * Groq API Provider
 * Supports multiple API keys with round-robin rotation and configurable models
 */
export class GroqProvider implements AIProvider {
  name = "groq";
  apiKeys: string[];
  currentKeyIndex = 0;
  private requestTimestamps: number[] = [];
  private readonly RATE_LIMIT_WINDOW = 60000; // 1 minute
  private readonly RATE_LIMIT_THRESHOLD = 30; // ~30 requests per minute
  private model: string = "mixtral-8x7b-32768";

  constructor(apiKeys: string[], model?: string) {
    if (!apiKeys || apiKeys.length === 0) {
      throw new ProviderError("At least one API key is required for GroqProvider", 400);
    }
    this.apiKeys = apiKeys;
    if (model) {
      this.model = model;
    }
  }

  /**
   * Set the model to use for API calls
   */
  setModel(model: string): void {
    this.model = model;
  }

  /**
   * Generate a response using Groq API with streaming
   */
  async generateResponse(prompt: string, context?: string): Promise<string> {
    if (!await this.checkRateLimit()) {
      throw new ProviderError("Rate limit exceeded for Groq provider", 429);
    }

    try {
      // Dynamically import to avoid hard dependency
      let Groq;
      try {
        const module = await import("groq-sdk");
        Groq = module.default || module.Groq;
      } catch {
        throw new ProviderError(
          "Groq SDK not installed. Install with: bun add groq-sdk",
          500
        );
      }

      const client = new Groq({
        apiKey: this.apiKeys[this.currentKeyIndex],
      });

      const fullPrompt = context ? `Context: ${context}\n\nPrompt: ${prompt}` : prompt;

      const message = await client.chat.completions.create({
        model: this.model,
        max_tokens: 2048,
        temperature: 0.7,
        messages: [
          {
            role: "user",
            content: fullPrompt,
          },
        ],
      });

      // Extract text from OpenAI-compatible response
      const response = message.choices[0]?.message?.content ?? "";

      // Track request for rate limiting
      this.requestTimestamps.push(Date.now());

      // Rotate to next API key
      this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;

      logger.debug("Groq API response generated successfully");
      return response;
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : "Unknown Groq API error";
      logger.error("Groq API error", { error: message });

      if (message.includes("401") || message.includes("invalid")) {
        throw new ProviderError("Invalid Groq API key", 401);
      }
      if (message.includes("429")) {
        throw new ProviderError("Groq rate limit exceeded", 429);
      }
      throw new ProviderError(`Groq API error: ${message}`, 500);
    }
  }

  /**
   * Check if current request rate is under the limit
   */
  async checkRateLimit(): Promise<boolean> {
    const now = Date.now();
    // Remove timestamps older than 1 minute
    this.requestTimestamps = this.requestTimestamps.filter(
      (ts) => now - ts < this.RATE_LIMIT_WINDOW
    );

    // Return true if under limit (with 10% buffer)
    return this.requestTimestamps.length < this.RATE_LIMIT_THRESHOLD * 0.9;
  }

  /**
   * Get remaining quota for current API key
   */
  async getRemainingQuota(): Promise<number> {
    const now = Date.now();
    const recentRequests = this.requestTimestamps.filter(
      (ts) => now - ts < this.RATE_LIMIT_WINDOW
    ).length;

    return Math.max(0, this.RATE_LIMIT_THRESHOLD - recentRequests);
  }
}

/**
 * Google Gemini API Provider
 * Supports multiple API keys with round-robin rotation
 */
export class GeminiProvider implements AIProvider {
  name = "gemini";
  apiKeys: string[];
  currentKeyIndex = 0;
  private requestTimestamps: number[] = [];
  private readonly RATE_LIMIT_WINDOW = 60000; // 1 minute
  private readonly RATE_LIMIT_THRESHOLD = 60; // ~60 requests per minute

  constructor(apiKeys: string[]) {
    if (!apiKeys || apiKeys.length === 0) {
      throw new ProviderError("At least one API key is required for GeminiProvider", 400);
    }
    this.apiKeys = apiKeys;
  }

  /**
   * Generate a response using Gemini API
   */
  async generateResponse(prompt: string, context?: string): Promise<string> {
    if (!await this.checkRateLimit()) {
      throw new ProviderError("Rate limit exceeded for Gemini provider", 429);
    }

    try {
      // Dynamically import to avoid hard dependency
      let GoogleGenerativeAI;
      try {
        const module = await import("@google/generative-ai");
        GoogleGenerativeAI = module.GoogleGenerativeAI;
      } catch {
        throw new ProviderError(
          "Google Generative AI SDK not installed. Install with: bun add @google/generative-ai",
          500
        );
      }

      const client = new GoogleGenerativeAI(this.apiKeys[this.currentKeyIndex]);
      const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });

      const fullPrompt = context ? `Context: ${context}\n\nPrompt: ${prompt}` : prompt;

      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [{ text: fullPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        },
      });

      const response = result.response.text();

      // Track request for rate limiting
      this.requestTimestamps.push(Date.now());

      // Rotate to next API key
      this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;

      logger.debug("Gemini API response generated successfully");
      return response;
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : "Unknown Gemini API error";
      logger.error("Gemini API error", { error: message });

      if (message.includes("401") || message.includes("invalid")) {
        throw new ProviderError("Invalid Gemini API key", 401);
      }
      if (message.includes("429")) {
        throw new ProviderError("Gemini rate limit exceeded", 429);
      }
      throw new ProviderError(`Gemini API error: ${message}`, 500);
    }
  }

  /**
   * Check if current request rate is under the limit
   */
  async checkRateLimit(): Promise<boolean> {
    const now = Date.now();
    // Remove timestamps older than 1 minute
    this.requestTimestamps = this.requestTimestamps.filter(
      (ts) => now - ts < this.RATE_LIMIT_WINDOW
    );

    // Return true if under limit (with 10% buffer)
    return this.requestTimestamps.length < this.RATE_LIMIT_THRESHOLD * 0.9;
  }

  /**
   * Get remaining quota for current API key
   */
  async getRemainingQuota(): Promise<number> {
    const now = Date.now();
    const recentRequests = this.requestTimestamps.filter(
      (ts) => now - ts < this.RATE_LIMIT_WINDOW
    ).length;

    return Math.max(0, this.RATE_LIMIT_THRESHOLD - recentRequests);
  }
}

/**
 * Factory function to create AI provider instances
 * @param name - Provider name: 'groq' or 'gemini'
 * @param apiKeys - Array of API keys for the provider
 * @param model - Optional model to use (for groq provider)
 * @returns Configured AIProvider instance
 */
export function createProvider(
  name: "groq" | "gemini",
  apiKeys: string[],
  model?: string
): AIProvider {
  if (!apiKeys || apiKeys.length === 0) {
    throw new ProviderError("API keys are required to create a provider", 400);
  }

  switch (name) {
    case "groq":
      return new GroqProvider(apiKeys, model);
    case "gemini":
      return new GeminiProvider(apiKeys);
    default:
      throw new ProviderError(`Unknown provider: ${name}`, 400);
  }
}


