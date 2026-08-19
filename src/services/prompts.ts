export const TRANSLATE_SYSTEM_PROMPT =
  'You are a professional contextual translator and linguist. Respond ONLY in strict JSON.';

export function buildTranslatePrompt(text: string, sourceLang: string, targetLang: string): string {
  return `Translate the following text from source language '${sourceLang}' to target language '${targetLang}'.

Text to translate:
"${text}"

Respond with a strict JSON object (no markdown fences, no extra prose) with exactly these two keys, in this order:
- "translation": The fluent, accurate overall translation. This MUST be the first key and MUST be written on a single line so it can be streamed.
- "detectedLang": Language of original text (e.g., English, Chinese, Japanese, French, etc.).`;
}

export const EXPLAIN_SYSTEM_PROMPT =
  'You are an expert bilingual lexicographer and AI reading assistant. Respond ONLY in strict JSON.';

export function buildExplainPrompt(selectedWord: string, sentence: string, targetLang: string): string {
  return `Analyze the target word/phrase "${selectedWord}" specifically within the context of the sentence:
"${sentence || selectedWord}"

Target language for explanation: ${targetLang}

Provide a deep, contextual explanation formatted in JSON:
- "word": The word/phrase analyzed.
- "phonetic": IPA pronunciation or phonetic transcription.
- "pos": Part of speech in this sentence (e.g. Transitive Verb, Compound Noun, Idiomatic Phrase).
- "cefrLevel": Estimated CEFR difficulty level (e.g. A1, A2, B1, B2, C1, C2).
- "literalMeaning": General dictionary meaning of the word.
- "contextualMeaning": Precise meaning of this word in THIS sentence context.
- "contextExplanation": Detailed nuance explanation (1-2 sentences) of why it carries this meaning here.
- "rootOrLemma": Root form / base infinitive if applicable.
- "collocations": Array of 2-3 common collocations or word combinations.
- "antonyms": Array of 1-2 antonyms if applicable.
- "synonymsInContext": Array of 2-3 contextual synonyms in source language.
- "examples": Array of 2 example sentences demonstrating similar contextual usage with translation:
  - "source": Example sentence in source language
  - "target": Translated sentence in target language`;
}

/**
 * Safely parses a JSON response from an LLM, tolerating reasoning (<think>...</think>)
 * blocks, markdown fences, and stray prose around the JSON payload.
 */
export function parseLLMJson(rawText: string): any {
  if (!rawText) return {};
  let cleaned = rawText.trim();

  // Strip <think>...</think> blocks emitted by reasoning models (DeepSeek-R1, Qwen etc.)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // If a <think> block was left unclosed (e.g. max token cutoff or partial response), strip from <think>
  cleaned = cleaned.replace(/<think>[\s\S]*$/gi, '').trim();

  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        console.warn('Regex extracted JSON parse failed:', jsonMatch[0]);
      }
    }

    // Fallback: If the model returned plain translated text instead of JSON format
    // (e.g. smaller local models or prompt-simplified setups), fallback to text.
    if (cleaned && !cleaned.startsWith('{') && !cleaned.startsWith('Error:')) {
      return {
        translation: cleaned,
        detectedLang: 'Auto',
      };
    }

    console.warn('Failed to parse JSON directly from LLM, returning empty object');
    return {};
  }
}
