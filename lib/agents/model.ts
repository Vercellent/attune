import 'server-only'
import { OpenAIModel } from '@strands-agents/sdk/models/openai'

export const MODELS = {
  builder: process.env.BUILDER_MODEL || 'openai/gpt-5.3-codex',
  conversational: process.env.CONVERSATION_MODEL || 'openai/gpt-5.1-codex-mini',
}

export function codex(kind: keyof typeof MODELS, maxTokens?: number) {
  return new OpenAIModel({
    api: 'chat',
    modelId: MODELS[kind],
    apiKey: process.env.OPENROUTER_API_KEY,
    maxTokens,
    clientConfig: {
      baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'X-Title': 'Autonomous Experimentation Lab' },
    },
  })
}
