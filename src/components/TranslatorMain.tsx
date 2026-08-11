import React, { useState, useEffect, useRef } from 'react';
import { Volume2, Loader2, Copy, Check, Eraser, RefreshCw, Settings, History, Sparkles, X, ArrowRightLeft } from 'lucide-react';
import { AppSettings, TranslationResult, WordExplanation } from '../types';
import { audioPlayer } from '../utils/audio';
import { consumeSSE, extractPartialTranslation } from '../services/streaming';
import { bridgeTranslate, isExtensionContext } from '../services/bridge';

interface TranslatorMainProps {
  sourceText: string;
  setSourceText: (text: string) => void;
  sourceLang: string;
  setSourceLang: (lang: string) => void;
  targetLang: string;
  setTargetLang: (lang: string) => void;
  onSwapLanguages: () => void;
  languages: Array<{ code: string; name: string }>;
  settings: AppSettings;
  onSaveHistory: (item: { sourceText: string; translation: string; sourceLang: string; targetLang: string }) => void;
  openSettings: () => void;
  openHistory: () => void;
  /** Bumped by App when the user retranslates a history item. */
  retranslateSignal?: number;
}

/** Small icon that reflects the current TTS state of a play button. */
const PlayIndicator: React.FC<{ phase: 'generating' | 'playing' | null; size?: number }> = ({ phase, size = 16 }) => {
  if (phase === 'generating') {
    return <Loader2 className="animate-spin" style={{ width: size, height: size }} />;
  }
  if (phase === 'playing') {
    return (
      <span className="ft-eq" style={{ height: size }}>
        <span />
        <span />
        <span />
        <span />
      </span>
    );
  }
  return null;
};

export const TranslatorMain: React.FC<TranslatorMainProps> = ({
  sourceText,
  setSourceText,
  sourceLang,
  setSourceLang,
  targetLang,
  setTargetLang,
  onSwapLanguages,
  languages,
  settings,
  onSaveHistory,
  openSettings,
  openHistory,
  retranslateSignal = 0,
}) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Tracks which side (source/target) is currently speaking, so only the
  // matching button highlights instead of both flashing together.
  const [playingTarget, setPlayingTarget] = useState<'source' | 'target' | null>(null);
  // 'generating' = waiting for first audio chunk, 'playing' = audio is live
  const [audioPhase, setAudioPhase] = useState<'generating' | 'playing' | null>(null);

  // Streaming typewriter state (grows while /api/translate/stream is live)
  const [streamingText, setStreamingText] = useState('');
  const streamAbortRef = useRef<AbortController | null>(null);

  // Selected word context state & cache
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [wordExplanation, setWordExplanation] = useState<WordExplanation | null>(null);
  const [explainingWord, setExplainingWord] = useState(false);

  // In-memory word explanation cache
  const wordCacheRef = useRef<Record<string, WordExplanation>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Guards against stale responses: only the latest translate request may
  // update state (rapid typing + 500ms auto-translate can overlap requests).
  const translateReqIdRef = useRef(0);

  const activeProvider = settings.defaultProvider || 'gemini';
  const activeConfig = settings.providerConfigs?.[activeProvider] || {
    apiKey: activeProvider === 'gemini' ? settings.geminiApiKey : '',
    baseUrl: '',
    model: settings.apiModel || 'gemini-3.6-flash',
    availableModels: [],
  };

  /**
   * Streaming translate through the background bridge (extension context):
   * deltas arrive over the port and drive the same typewriter UI.
   */
  const translateViaBridge = async (): Promise<{ translation: string; detectedLang?: string }> => {
    let raw = '';
    return bridgeTranslate(
      {
        text: sourceText,
        sourceLang,
        targetLang,
        provider: activeProvider,
        model: activeConfig.model || settings.apiModel,
        baseUrl: activeConfig.baseUrl,
      },
      (delta) => {
        raw += delta;
        const partial = extractPartialTranslation(raw);
        if (partial) setStreamingText(partial.text);
      },
    );
  };

  /**
   * Consumes the SSE stream from /api/translate/stream, updating the typewriter
   * text as deltas arrive. Throws if the stream ends in an error without a
   * result, so the caller can fall back to the non-streaming path.
   */
  const translateViaStream = async (body: string): Promise<{ translation: string; detectedLang?: string }> => {
    const controller = new AbortController();
    streamAbortRef.current = controller;

    const res = await fetch('/api/translate/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error('Streaming API unavailable');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let raw = '';
    let streamError: string | null = null;
    let doneResult: { translation: string; detectedLang?: string } | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = consumeSSE(buffer);
      buffer = rest;
      for (const evt of events) {
        if (evt.delta !== undefined) {
          raw += evt.delta;
          const partial = extractPartialTranslation(raw);
          if (partial) setStreamingText(partial.text);
        } else if (evt.done && evt.result) {
          doneResult = evt.result;
        } else if (evt.error) {
          streamError = evt.error;
        }
      }
    }

    if (streamError && !doneResult) {
      throw new Error(streamError);
    }
    return doneResult || { translation: raw.trim() || 'Translation unavailable.' };
  };

  const handleTranslate = async (textToTranslate?: string) => {
    const text = textToTranslate || sourceText;
    if (!text || !text.trim()) return;

    const requestId = ++translateReqIdRef.current;
    setLoading(true);
    setError(null);
    setStreamingText('');
    // Cancel any in-flight stream from a previous request
    streamAbortRef.current?.abort();

    try {
      let data: any;
      const apiKeyToUse = activeConfig.apiKey || (activeProvider === 'gemini' ? settings.geminiApiKey : '');
      const body = JSON.stringify({
        text,
        sourceLang,
        targetLang,
        provider: activeProvider,
        apiKey: apiKeyToUse,
        baseUrl: activeConfig.baseUrl,
        model: activeConfig.model || settings.apiModel,
      });

      try {
        // 1. Prefer streaming. In the extension this goes through the
        // background bridge; in the web app through the server SSE endpoint.
        data = isExtensionContext() ? await translateViaBridge() : await translateViaStream(body);
      } catch (err: any) {
        // If this request was aborted because a newer one started, don't
        // waste a call on the fallback path — just propagate.
        if (requestId !== translateReqIdRef.current) throw err;
        // 2. Fall back to the non-streaming server endpoint
        try {
          const res = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          });
          if (res.ok) {
            data = await res.json();
          } else {
            throw new Error('Server API unavailable, falling back to client');
          }
        } catch (_e2) {
          // 3. Final fallback: client-side LLM call
          const { translateTextClient } = await import('../services/aiProvider');
          data = await translateTextClient({
            text,
            sourceLang,
            targetLang,
            provider: activeProvider,
            apiKey: apiKeyToUse,
            baseUrl: activeConfig.baseUrl,
            model: activeConfig.model || settings.apiModel,
          });
        }
      }

      // Ignore stale responses from superseded requests
      if (requestId !== translateReqIdRef.current) return;

      const translationObj: TranslationResult = {
        id: Date.now().toString(),
        sourceText: text,
        translation: data.translation,
        sourceLang,
        targetLang,
        detectedLang: data.detectedLang,
        timestamp: Date.now(),
      };

      setStreamingText('');
      setResult(translationObj);
      onSaveHistory({
        sourceText: text,
        translation: data.translation,
        sourceLang,
        targetLang,
      });
    } catch (err: any) {
      if (requestId !== translateReqIdRef.current) return;
      console.error('Translation error:', err);
      setError(err.message || 'Translation failed');
    } finally {
      if (requestId === translateReqIdRef.current) setLoading(false);
    }
  };

  // Auto-translate debounce
  useEffect(() => {
    if (settings.autoTranslate && sourceText.trim().length > 1) {
      const timer = setTimeout(() => {
        handleTranslate();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [sourceText, sourceLang, targetLang, settings.autoTranslate, activeProvider, activeConfig.model]);

  // Auto-grow the input textarea with its content (90px → 260px)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 90), 260)}px`;
  }, [sourceText]);

  // History "retranslate" trigger: App bumps this counter after loading an
  // item's text/langs, so we re-run the translation with current settings.
  const retranslateHandledRef = useRef(0);
  useEffect(() => {
    if (retranslateSignal && retranslateSignal !== retranslateHandledRef.current) {
      retranslateHandledRef.current = retranslateSignal;
      if (sourceText.trim()) {
        handleTranslate();
      }
    }
  }, [retranslateSignal]);

  // Handle selecting a word in context with instant cache retrieval
  const handleSelectWord = async (word: string) => {
    const cleanWord = word.trim().replace(/^[^a-zA-Z0-9\u4e00-\u9fa5]+|[^a-zA-Z0-9\u4e00-\u9fa5]+$/g, '');
    if (!cleanWord) return;

    const cacheKey = `${cleanWord.toLowerCase()}_${targetLang}_${activeProvider}_${activeConfig.model}`;

    // Return cached explanation instantly if available
    if (wordCacheRef.current[cacheKey]) {
      setSelectedWord(cleanWord);
      setWordExplanation(wordCacheRef.current[cacheKey]);
      setExplainingWord(false);
      return;
    }

    setSelectedWord(cleanWord);
    setExplainingWord(true);

    try {
      let data: any;
      const apiKeyToUse = activeConfig.apiKey || (activeProvider === 'gemini' ? settings.geminiApiKey : '');

      try {
        const res = await fetch('/api/explain-word', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sentence: sourceText || result?.sourceText,
            selectedWord: cleanWord,
            targetLang,
            provider: activeProvider,
            apiKey: apiKeyToUse,
            baseUrl: activeConfig.baseUrl,
            model: activeConfig.model || settings.apiModel,
          }),
        });
        if (res.ok) {
          data = await res.json();
        } else {
          throw new Error('Server API unavailable');
        }
      } catch (_e) {
        const { explainWordClient } = await import('../services/aiProvider');
        data = await explainWordClient({
          sentence: sourceText || result?.sourceText || cleanWord,
          selectedWord: cleanWord,
          targetLang,
          provider: activeProvider,
          apiKey: apiKeyToUse,
          baseUrl: activeConfig.baseUrl,
          model: activeConfig.model || settings.apiModel,
        });
      }

      wordCacheRef.current[cacheKey] = data; // Store in cache
      setWordExplanation(data);
    } catch (err) {
      console.error('Failed to explain word:', err);
      const fallbackObj: WordExplanation = {
        word: cleanWord,
        contextualMeaning: cleanWord,
        contextExplanation: `In-context analysis for "${cleanWord}".`,
      };
      wordCacheRef.current[cacheKey] = fallbackObj;
      setWordExplanation(fallbackObj);
    } finally {
      setExplainingWord(false);
    }
  };

  // Selection detection helper for textarea or text selection
  const detectSelection = () => {
    const selection = window.getSelection()?.toString().trim();
    if (selection && selection.length > 0 && selection.length < 80) {
      handleSelectWord(selection);
    } else if (!selection && selectedWord) {
      // Auto-revert when text selection is cleared
      setSelectedWord(null);
      setWordExplanation(null);
    }
  };

  const handleTextareaSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    if (start !== undefined && end !== undefined && start !== end) {
      const selectedText = target.value.substring(start, end).trim();
      if (selectedText && selectedText.length > 0 && selectedText.length < 80) {
        handleSelectWord(selectedText);
        return;
      }
    }
    if (start === end && selectedWord) {
      setSelectedWord(null);
      setWordExplanation(null);
    }
  };

  const handlePlayAudio = (text: string, lang: string, target: 'source' | 'target') => {
    if (!text || !text.trim()) return;

    if (playingTarget === target) {
      audioPlayer.stopAll();
      setPlayingTarget(null);
      return;
    }

    audioPlayer.speak({
      text,
      lang,
      engine: settings.ttsEngine,
      voice: settings.ttsVoice,
      rate: settings.ttsRate,
      apiKey: settings.geminiApiKey,
      providerConfigs: settings.providerConfigs,
      onStart: () => {
        setPlayingTarget(target);
        setAudioPhase('generating');
      },
      onAudioStart: () => setAudioPhase('playing'),
      onEnd: () => {
        setPlayingTarget(null);
        setAudioPhase(null);
      },
    });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleTranslate();
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-2.5 sm:px-4 py-2 sm:py-4 flex flex-col gap-2.5 sm:gap-3.5">
      {/* 1. ELEGANT LANGUAGE SELECTOR TOOLBAR */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-2 sm:p-2.5 shadow-2xs flex items-center justify-between gap-2">
        {/* Source Language Select */}
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <span className="text-[11px] font-extrabold text-slate-400 pl-1 uppercase tracking-wider hidden sm:inline">From</span>
          <select
            value={sourceLang}
            onChange={(e) => setSourceLang(e.target.value)}
            className="bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-bold px-2 py-1.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer w-full transition-colors"
          >
            <option value="auto">自动识别 (Auto)</option>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        {/* Swap Button */}
        <button
          onClick={onSwapLanguages}
          className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl border border-slate-200/90 transition-all cursor-pointer shadow-2xs hover:scale-105 active:scale-95 shrink-0"
          title="互换语言"
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
        </button>

        {/* Target Language Select */}
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <span className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider hidden sm:inline">To</span>
          <select
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            className="bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-bold px-2 py-1.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer w-full transition-colors"
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        {/* Translate Button */}
        <button
          onClick={() => handleTranslate()}
          disabled={loading || !sourceText.trim()}
          className="flex items-center justify-center gap-1.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white text-xs font-extrabold px-3 py-1.5 rounded-xl transition-all shadow-2xs hover:shadow-xs disabled:opacity-40 cursor-pointer shrink-0"
          title="快捷键: Cmd/Ctrl + Enter"
        >
          <Sparkles className="w-3.5 h-3.5 text-indigo-200 shrink-0" />
          <span>{loading ? '翻译中...' : '翻译'}</span>
        </button>
      </div>

      {/* ERROR MESSAGE ALERT */}
      {error && (
        <div className="bg-rose-50 border border-rose-200/90 text-rose-800 text-xs rounded-xl p-2.5 flex items-center justify-between gap-2.5 animate-in fade-in slide-in-from-top-1 shadow-2xs">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="font-extrabold bg-rose-200 text-rose-900 rounded-md px-1.5 py-0.5 text-[10px] uppercase tracking-wider shrink-0">
              错误
            </span>
            <p className="leading-snug font-medium text-[11px] break-words flex-1">{error}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {(error.includes('API Key') || error.includes('Settings')) && (
              <button
                onClick={openSettings}
                className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-2.5 py-1 rounded-lg text-xs cursor-pointer shadow-2xs transition-colors whitespace-nowrap"
              >
                ⚙️ 设置 Key
              </button>
            )}
            <button
              onClick={() => setError(null)}
              className="p-1 hover:bg-rose-100 rounded-lg text-rose-500 hover:text-rose-800 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 2 & 3. DUAL STUDIO TRANSLATION WORKSPACE GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
        {/* LEFT COLUMN: SOURCE INPUT BOX */}
        <div className="bg-white border border-slate-200/90 rounded-2xl shadow-2xs overflow-hidden flex flex-col justify-between focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/10 transition-all">
          <textarea
            ref={textareaRef}
            value={sourceText}
            onChange={(e) => {
              setSourceText(e.target.value);
              if (selectedWord) {
                setSelectedWord(null);
                setWordExplanation(null);
              }
            }}
            onSelect={handleTextareaSelect}
            onKeyDown={handleTextareaKeyDown}
            onDoubleClick={detectSelection}
            onMouseUp={detectSelection}
            placeholder="输入或粘贴文本... (支持划词或双击词汇极速发音与深度语境解析)"
            className="w-full p-3 sm:p-4 min-h-[90px] text-slate-800 text-sm sm:text-base font-normal resize-y focus:outline-none placeholder:text-slate-400 bg-transparent leading-relaxed"
          />

          {/* Input Box Actions Toolbar */}
          <div className="flex items-center justify-between px-3.5 py-2 border-t border-slate-100 bg-slate-50/60 text-slate-500 text-xs">
            <div className="flex items-center gap-1.5">
              <span className={`text-[11px] font-bold ${
                sourceText.length > 4500 ? 'text-rose-600' : sourceText.length > 3500 ? 'text-amber-600' : 'text-slate-400'
              }`}>
                {sourceText.length.toLocaleString()} / 5,000
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => handlePlayAudio(selectedWord || sourceText, sourceLang, 'source')}
                disabled={!sourceText.trim() && !selectedWord}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
                  playingTarget === 'source' ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-slate-200/70 text-slate-600 hover:text-slate-900'
                } disabled:opacity-30`}
                title={selectedWord ? `播放 "${selectedWord}"` : "播放原文"}
              >
                {playingTarget === 'source' ? (
                  <PlayIndicator phase={audioPhase} size={14} />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
              </button>

              <button
                onClick={() => handleCopy(selectedWord || sourceText)}
                disabled={!sourceText.trim()}
                className="p-1.5 rounded-lg hover:bg-slate-200/70 text-slate-600 hover:text-slate-900 transition-colors disabled:opacity-30 cursor-pointer"
                title={selectedWord ? `复制 "${selectedWord}"` : "复制原文"}
              >
                <Copy className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => {
                  setSourceText('');
                  setResult(null);
                  setSelectedWord(null);
                  setWordExplanation(null);
                  try { localStorage.removeItem('freetranslate_draft'); } catch(e){}
                }}
                disabled={!sourceText.trim()}
                className="p-1.5 rounded-lg hover:bg-slate-200/70 text-slate-600 hover:text-slate-900 transition-colors disabled:opacity-30 cursor-pointer"
                title="清空文本"
              >
                <Eraser className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: TRANSLATION RESULT BOX */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-3.5 sm:p-4 min-h-[95px] sm:min-h-[140px] shadow-2xs relative flex flex-col justify-between">
          {loading ? (
            streamingText ? (
              /* Typewriter view while the SSE stream is live */
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold border-b border-slate-100 pb-1.5">
                  <span className="uppercase tracking-wider font-bold text-slate-500">翻译结果</span>
                  <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-mono animate-pulse">生成中…</span>
                </div>
                <div className="text-slate-900 text-base sm:text-lg font-medium leading-relaxed tracking-tight select-text min-h-[60px] whitespace-pre-wrap">
                  {streamingText}
                  <span className="inline-block w-[2px] h-[1.1em] bg-indigo-500 ml-0.5 align-text-bottom animate-pulse rounded-sm" />
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-slate-400 gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
                <span className="text-xs font-bold text-slate-500">AI 正在翻译与解析语境...</span>
              </div>
            )
          ) : (
            <div className="space-y-2">
              {/* Output Header */}
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold border-b border-slate-100 pb-1.5">
                <span className="uppercase tracking-wider font-bold text-slate-500">翻译结果</span>
                {result?.detectedLang && (
                  <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                    识别语种: {result.detectedLang}
                  </span>
                )}
              </div>

              {/* Full Sentence Translation */}
              <div
                onMouseUp={detectSelection}
                onDoubleClick={detectSelection}
                className="text-slate-900 text-base sm:text-lg font-medium leading-relaxed tracking-tight select-text min-h-[60px]"
              >
                {result?.translation || (
                  <span className="text-slate-300 italic font-normal text-sm">
                    翻译结果将在此即时显示...
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Translation Card Actions Footer */}
          <div className="flex items-center justify-between pt-2.5 mt-2 border-t border-slate-100 text-xs text-slate-400">
            <div className="flex items-center gap-1 text-[10px]">
              <span>引擎:</span>
              <span className="font-bold text-slate-700 uppercase">{settings.defaultProvider}</span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handlePlayAudio(result?.translation || '', targetLang, 'target')}
                disabled={!result?.translation}
                className={`p-2 rounded-xl transition-colors cursor-pointer ${
                  playingTarget === 'target' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                } disabled:opacity-30`}
                title={`Listen full translation (${targetLang})`}
              >
                {playingTarget === 'target' ? (
                  <PlayIndicator phase={audioPhase} size={16} />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>

              <button
                onClick={() => result?.translation && handleCopy(result.translation)}
                disabled={!result?.translation}
                className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 disabled:opacity-30 cursor-pointer transition-colors"
                title="Copy translation"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 4. IN-CONTEXT DEEP DICTIONARY CARD (FLOATING ACCORDION CARD BELOW WORKSPACE) */}
      {selectedWord && (
        <div className="bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950 border border-indigo-900/60 rounded-2xl p-5 md:p-6 text-slate-100 shadow-xl animate-in fade-in slide-in-from-top-2 duration-200 relative">
          <button
            onClick={() => {
              setSelectedWord(null);
              setWordExplanation(null);
            }}
            className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 transition-colors cursor-pointer"
            title="Close dictionary card"
          >
            <X className="w-4 h-4" />
          </button>

          {explainingWord ? (
            <div className="flex items-center justify-center gap-3 text-indigo-300 text-sm py-8">
              <RefreshCw className="w-5 h-5 animate-spin text-indigo-400" />
              <span>Analyzing in-context semantics for "{selectedWord}"...</span>
            </div>
          ) : wordExplanation ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column: Word Header & Nuance Explanation */}
              <div className="space-y-4">
                <div className="flex items-baseline gap-3 pr-10 flex-wrap">
                  <h3 className="text-2xl font-extrabold text-white tracking-tight">{wordExplanation.word}</h3>

                  <button
                    onClick={() => handlePlayAudio(wordExplanation.word, sourceLang, 'source')}
                    className="p-1.5 text-indigo-300 hover:text-white hover:bg-indigo-900/60 rounded-xl border border-indigo-800/60 transition-colors cursor-pointer"
                    title={`Pronounce "${wordExplanation.word}"`}
                  >
                    {playingTarget === 'source' ? (
                      <PlayIndicator phase={audioPhase} size={16} />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                  </button>

                  {wordExplanation.phonetic && (
                    <span className="text-xs font-mono text-indigo-200 bg-indigo-950/80 border border-indigo-800/80 px-2 py-0.5 rounded-md">
                      /{wordExplanation.phonetic}/
                    </span>
                  )}

                  {(wordExplanation.partOfSpeech || wordExplanation.pos) && (
                    <span className="text-xs italic text-indigo-300 font-bold bg-indigo-900/40 px-2 py-0.5 rounded border border-indigo-800/40">
                      {wordExplanation.partOfSpeech || wordExplanation.pos}
                    </span>
                  )}

                  {wordExplanation.cefrLevel && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      CEFR: {wordExplanation.cefrLevel}
                    </span>
                  )}
                </div>

                <div className="bg-slate-900/80 border border-indigo-900/80 rounded-xl p-4 space-y-1">
                  <span className="text-[10px] text-indigo-400 font-extrabold uppercase tracking-wider block">
                    In-Context Meaning (语境含义)
                  </span>
                  <p className="text-lg font-bold text-emerald-300 leading-snug">{wordExplanation.contextualMeaning}</p>
                </div>

                {wordExplanation.contextExplanation && (
                  <div className="text-xs text-slate-300 leading-relaxed bg-slate-900/60 p-3.5 rounded-xl border border-slate-800 space-y-1">
                    <strong className="text-indigo-300 block font-bold">Context Nuance & Explanation:</strong>
                    <p>{wordExplanation.contextExplanation}</p>
                  </div>
                )}
              </div>

              {/* Right Column: Collocations, Synonyms & Examples */}
              <div className="space-y-3.5">
                {wordExplanation.collocations && wordExplanation.collocations.length > 0 && (
                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
                    <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider block mb-1.5">
                      Common Collocations (常用搭配)
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {wordExplanation.collocations.map((col, idx) => (
                        <span key={idx} className="px-2.5 py-0.5 rounded-md text-xs font-medium bg-emerald-950/60 text-emerald-200 border border-emerald-800/60">
                          {col}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {wordExplanation.synonymsInContext && wordExplanation.synonymsInContext.length > 0 && (
                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
                    <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider block mb-1.5">
                      Contextual Synonyms (同义词)
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {wordExplanation.synonymsInContext.map((syn, idx) => (
                        <span key={idx} className="px-2.5 py-0.5 rounded-md text-xs font-medium bg-indigo-950/60 text-indigo-200 border border-indigo-800/60">
                          {syn}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {((wordExplanation.exampleSentences && wordExplanation.exampleSentences.length > 0) ||
                  (wordExplanation.examples && wordExplanation.examples.length > 0)) && (
                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs">
                    <span className="font-bold text-indigo-300 block uppercase tracking-wider text-[11px]">
                      Context Examples (例句演示)
                    </span>
                    {(wordExplanation.exampleSentences || wordExplanation.examples || []).map((ex: any, i: number) => (
                      <div key={i} className="pl-2.5 border-l-2 border-indigo-500 space-y-0.5">
                        <p className="text-slate-100 font-medium">{ex.original || ex.source}</p>
                        <p className="text-slate-400 text-[11px]">{ex.translation || ex.target}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
