import { GoogleGenAI } from "@google/genai";
import { DEFAULT_BASE_URLS } from "../config";
import { bridgeExplain, bridgeTranslate, isExtensionContext } from "./bridge";
import {
  EXPLAIN_SYSTEM_PROMPT,
  TRANSLATE_SYSTEM_PROMPT,
  buildExplainPrompt,
  buildTranslatePrompt,
  parseLLMJson,
} from "./prompts";

export async function callLLMClient({
  provider = "gemini",
  apiKey = "",
  baseUrl = "",
  model = "",
  prompt,
  systemInstruction = "",
  jsonOutput = false,
}: {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  prompt: string;
  systemInstruction?: string;
  jsonOutput?: boolean;
}): Promise<string> {
  const effectiveBaseUrl = (baseUrl || DEFAULT_BASE_URLS[provider] || "").replace(/\/+$/, "");
  const effectiveModel = model || "";
  if (!effectiveModel) {
    throw new Error("未设置模型，请先在设置中「自动获取可用模型」或手动填写模型");
  }

  // Gemini API
  if (provider === "gemini" || (!apiKey && provider !== "custom")) {
    if (!apiKey) {
      throw new Error("Gemini API Key is required. Please set it in Settings.");
    }
    const ai = new GoogleGenAI({ apiKey });
    const config: any = {};
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (jsonOutput) config.responseMimeType = "application/json";

    const response = await ai.models.generateContent({
      model: effectiveModel,
      contents: prompt,
      config,
    });
    return response.text || "";
  }

  // OpenAI-Compatible REST API
  const endpoint = `${effectiveBaseUrl}/chat/completions`;
  const messages: any[] = [];
  if (systemInstruction) {
    messages.push({ role: "system", content: systemInstruction });
  }
  messages.push({ role: "user", content: prompt });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const payload: any = {
    model: effectiveModel,
    messages,
    temperature: 0.3,
  };

  if (jsonOutput) {
    payload.response_format = { type: "json_object" };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`${provider.toUpperCase()} API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || "";
}

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

  const raw = await callLLMClient({
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

  const raw = await callLLMClient({
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
