import { callLLM } from "./llm";
import { bridgeExplain, bridgeTranslate, isExtensionContext } from "./bridge";
import {
  EXPLAIN_SYSTEM_PROMPT,
  TRANSLATE_SYSTEM_PROMPT,
  parseExplanation,
  parseTranslation,
  buildExplainPrompt,
  buildTranslatePrompt,
  type LookupDetail,
} from "./prompts";

export async function translateTextClient(params: {
  text: string;
  context?: string;
  readerNote?: string;
  sourceLang?: string;
  targetLang?: string;
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  signal?: AbortSignal;
}) {
  const {
    text, context, readerNote,
    sourceLang = "auto",
    targetLang = "zh-CN",
    provider = "gemini",
    apiKey = "",
    baseUrl = "",
    model = "",
    signal,
  } = params;

  // In the extension, route through the background bridge: the apiKey is NOT
  // sent over the wire — the service worker resolves it from storage itself.
  if (isExtensionContext()) {
    const data = await bridgeTranslate({
      text, context, readerNote,
      sourceLang,
      targetLang,
      provider,
      model,
      baseUrl,
    }, undefined, signal);
    return {
      translation: data.translation,
      detectedLang: data.detectedLang || "Auto",
      tokens: [],
    };
  }

  const raw = await callLLM({
    provider,
    apiKey,
    baseUrl,
    model,
    prompt: buildTranslatePrompt(text, sourceLang, targetLang, context, readerNote),
    systemInstruction: TRANSLATE_SYSTEM_PROMPT,
    jsonOutput: true,
    signal,
  });

  const parsed = parseTranslation(raw);
  return {
    translation: parsed.translation,
    detectedLang: parsed.detectedLang || "Auto",
    tokens: parsed.tokens || [],
  };
}

export async function explainWordClient(params: {
  sentence: string;
  readerNote?: string;
  detail?: LookupDetail;
  selectedWord: string;
  targetLang?: string;
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}) {
  const {
    sentence, readerNote, detail,
    selectedWord,
    targetLang = "zh-CN",
    provider = "gemini",
    apiKey = "",
    baseUrl = "",
    model = "",
  } = params;

  // Extension: route through the background bridge (no apiKey sent).
  if (isExtensionContext()) {
    return bridgeExplain({
      sentence, readerNote, detail,
      selectedWord,
      targetLang,
      provider,
      model,
      baseUrl,
    });
  }

  const raw = await callLLM({
    provider,
    apiKey,
    baseUrl,
    model,
    prompt: buildExplainPrompt(selectedWord, sentence, targetLang, readerNote, detail),
    systemInstruction: EXPLAIN_SYSTEM_PROMPT,
    jsonOutput: true,
  });

  return parseExplanation(raw, selectedWord);
}
