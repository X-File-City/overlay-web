/**
 * Model Pricing Configuration
 * Per-model token pricing used for credit deduction in subscription billing
 */

export interface ModelPricing {
  inputPer1M: number // $/M input tokens
  cachedInputPer1M: number // $/M cached input tokens
  outputPer1M: number // $/M output tokens
  isFree: boolean
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Free models (OpenRouter)
  'openrouter/free': { inputPer1M: 0, cachedInputPer1M: 0, outputPer1M: 0, isFree: true },
  'openrouter/hunter-alpha': { inputPer1M: 0, cachedInputPer1M: 0, outputPer1M: 0, isFree: true },
  'openrouter/healer-alpha': { inputPer1M: 0, cachedInputPer1M: 0, outputPer1M: 0, isFree: true },
  'arcee-ai/trinity-large-preview:free': { inputPer1M: 0, cachedInputPer1M: 0, outputPer1M: 0, isFree: true },

  // Anthropic Claude
  'claude-opus-4-6': { inputPer1M: 5.0, cachedInputPer1M: 0.5, outputPer1M: 25.0, isFree: false },
  'claude-sonnet-4-6': { inputPer1M: 3.0, cachedInputPer1M: 0.3, outputPer1M: 15.0, isFree: false },
  'claude-haiku-4-5': { inputPer1M: 1.0, cachedInputPer1M: 0.1, outputPer1M: 5.0, isFree: false },

  // Google Gemini
  'gemini-3.1-pro-preview': { inputPer1M: 2.0, cachedInputPer1M: 0.2, outputPer1M: 12.0, isFree: false },
  'gemini-3-flash-preview': { inputPer1M: 0.5, cachedInputPer1M: 0.05, outputPer1M: 3.0, isFree: false },
  'gemini-2.5-flash': { inputPer1M: 0.3, cachedInputPer1M: 0.03, outputPer1M: 2.5, isFree: false },
  'gemini-2.5-flash-lite': { inputPer1M: 0.1, cachedInputPer1M: 0.01, outputPer1M: 0.4, isFree: false },

  // OpenAI
  'gpt-5.2-pro-2025-12-11': { inputPer1M: 2.5, cachedInputPer1M: 0.25, outputPer1M: 20.0, isFree: false },
  'gpt-5.2-2025-12-11': { inputPer1M: 1.75, cachedInputPer1M: 0.175, outputPer1M: 14.0, isFree: false },
  'gpt-5-mini-2025-08-07': { inputPer1M: 0.25, cachedInputPer1M: 0.025, outputPer1M: 2.0, isFree: false },
  'gpt-5-nano-2025-08-07': { inputPer1M: 0.05, cachedInputPer1M: 0.005, outputPer1M: 0.4, isFree: false },
  'gpt-4.1-2025-04-14': { inputPer1M: 2.0, cachedInputPer1M: 0.5, outputPer1M: 8.0, isFree: false },

  // xAI Grok
  'grok-4-1-fast-reasoning': { inputPer1M: 0.2, cachedInputPer1M: 0.2, outputPer1M: 0.5, isFree: false },

  // Groq
  'llama-3.3-70b-versatile': { inputPer1M: 0.59, cachedInputPer1M: 0.59, outputPer1M: 0.79, isFree: false },
  'moonshotai/kimi-k2-instruct-0905': { inputPer1M: 1.0, cachedInputPer1M: 0.5, outputPer1M: 3.0, isFree: false },
  'openai/gpt-oss-120b': { inputPer1M: 0.15, cachedInputPer1M: 0.075, outputPer1M: 0.6, isFree: false },
}

/**
 * Calculate token cost for a request.
 * @returns Cost in dollars
 */
export function calculateTokenCost(
  modelId: string,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[modelId]
  if (!pricing) return 0
  if (pricing.isFree) return 0

  const uncachedInput = Math.max(0, inputTokens - cachedInputTokens)
  const inputCost = (uncachedInput / 1_000_000) * pricing.inputPer1M
  const cachedCost = (cachedInputTokens / 1_000_000) * pricing.cachedInputPer1M
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M

  return inputCost + cachedCost + outputCost
}

export function isPremiumModel(modelId: string): boolean {
  const pricing = MODEL_PRICING[modelId]
  return pricing ? !pricing.isFree : true
}
