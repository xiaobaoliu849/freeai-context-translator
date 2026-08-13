import { callLLM } from "./llm";
import { bridgeExplain, bridgeTranslate, isExtensionContext } from "./bridge";
import {
  EXPLAIN_SYSTEM_PROMPT,
  TRANSLATE_SYSTEM_PROMPT,
  buildExplainPrompt,
  buildTranslatePrompt,
  parseLLMJson,
} from "./prompts";

export async function translateTextClient(params: {
  text: string;
  sourceLang?: string;
  targetLang?: string;
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}) {
  const {
    text,
    sourceLang = "auto",
    targetLang = "zh-CN",
    provider = "gemini",
    apiKey = "",
    baseUrl = "",
    model = "",
  } = params;

  // In the extension, route through the background bridge: the apiKey is NOT
  // sent over the wire — the service worker resolves it from storage itself.
  if (isExtensionContext()) {
    const data = await bridgeTranslate({
      text,
      sourceLang,
      targetLang,
      provider,
      model,
      baseUrl,
    });
    return {
      translation: data.translation || "Translation unavailable.",
      detectedLang: data.detectedLang || "Auto",
      tokens: [],
    };
  }

  const raw = await callLLM({
    provider,
    apiKey,
    baseUrl,
    model,
    prompt: buildTranslatePrompt(text, sourceLang, targetLang),
    systemInstruction: TRANSLATE_SYSTEM_PROMPT,
    jsonOutput: true,
  });

  const parsed = parseLLMJson(raw);
  return {
    translation: parsed.translation || "Translation unavailable.",
    detectedLang: parsed.detectedLang || "Auto",
    tokens: parsed.tokens || [],
  };
}

export async function explainWordClient(params: {
  sentence: string;
  selectedWord: string;
  targetLang?: string;
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}) {
  const {
    sentence,
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
      sentence,
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
    prompt: buildExplainPrompt(selectedWord, sentence, targetLang),
    systemInstruction: EXPLAIN_SYSTEM_PROMPT,
    jsonOutput: true,
  });

  const parsed = parseLLMJson(raw);
  return {
    word: parsed.word || selectedWord,
    phonetic: parsed.phonetic || "",
    pos: parsed.pos || "",
    cefrLevel: parsed.cefrLevel || "",
    literalMeaning: parsed.literalMeaning || "",
    contextualMeaning: parsed.contextualMeaning || "",
    contextExplanation: parsed.contextExplanation || "",
    rootOrLemma: parsed.rootOrLemma || "",
    collocations: parsed.collocations || [],
    antonyms: parsed.antonyms || [],
    synonymsInContext: parsed.synonymsInContext || [],
    examples: parsed.examples || [],
  };
}
