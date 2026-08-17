import React, { useState, useEffect, useRef } from 'react';
import { Volume2, Loader2, Copy, Check, Eraser, RefreshCw, Settings, History, Sparkles, X, ArrowRightLeft, Zap } from 'lucide-react';
import { AppSettings, TranslationResult, WordExplanation } from '../types';
import { audioPlayer } from '../utils/audio';
import { consumeSSE, extractPartialTranslation } from '../services/streaming';
import { bridgeTranslate, isExtensionContext } from '../services/bridge';
import { WordContextCard } from './WordContextCard';

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
  /** Compact app-shell layout used inside the 440x570 extension popup. */
  isPopup?: boolean;
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
  isPopup = false,
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
  // Mirrors the latest streamed text so a manual "stop" can preserve the
  // partial translation (React state is async and can't be read in the catch).
  const streamingTextRef = useRef('');

  // Selected word context state & cache
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [wordExplanation, setWordExplanation] = useState<WordExplanation | null>(null);
  const [explainingWord, setExplainingWord] = useState(false);
  // Free-drag split between the source/target panels (desktop). The value is
  // a percentage of the left panel; it is persisted so the user's preferred
  // ratio survives reloads. The toolbar presets (5:5 / 6:4 / 4:6) snap it.
  const [splitPercent, setSplitPercent] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('freetranslate_layout_split'));
      return saved >= 20 && saved <= 80 ? saved : 50;
    } catch {
      return 50;
    }
  });
  const [splitDragging, setSplitDragging] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const splitDragRef = useRef<{ x: number; split: number }>({ x: 0, split: 50 });

  // Vertical split between upper and lower panels in popup mode
  const [vSplitPercent, setVSplitPercent] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('freetranslate_vsplit'));
      return saved >= 20 && saved <= 75 ? saved : 42;
    } catch {
      return 42;
    }
  });
  const [vSplitDragging, setVSplitDragging] = useState(false);
  const vSplitDragRef = useRef<{ y: number; split: number }>({ y: 0, split: 42 });

  useEffect(() => {
    try {
      localStorage.setItem('freetranslate_layout_split', String(splitPercent));
    } catch {}
  }, [splitPercent]);

  useEffect(() => {
    try {
      localStorage.setItem('freetranslate_vsplit', String(vSplitPercent));
    } catch {}
  }, [vSplitPercent]);

  const handleSplitPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    splitDragRef.current = { x: e.clientX, split: splitPercent };
    setSplitDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handleSplitPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!splitDragging) return;
    const grid = workspaceRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    if (rect.width === 0) return;
    const delta = ((e.clientX - splitDragRef.current.x) / rect.width) * 100;
    const next = Math.round(splitDragRef.current.split + delta);
    setSplitPercent(Math.min(80, Math.max(20, next)));
  };
  const handleSplitPointerUp = () => setSplitDragging(false);

  const handleVSplitPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    vSplitDragRef.current = { y: e.clientY, split: vSplitPercent };
    setVSplitDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handleVSplitPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!vSplitDragging) return;
    const grid = workspaceRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    if (rect.height === 0) return;
    const delta = ((e.clientY - vSplitDragRef.current.y) / rect.height) * 100;
    const next = Math.round(vSplitDragRef.current.split + delta);
    setVSplitPercent(Math.min(75, Math.max(20, next)));
  };
  const handleVSplitPointerUp = () => setVSplitDragging(false);

  // In-memory word explanation cache
  const wordCacheRef = useRef<Record<string, WordExplanation>>({});
  // Cap the in-memory word cache so long sessions don't grow it unbounded.
  const cacheWord = (key: string, value: WordExplanation) => {
    const cache = wordCacheRef.current;
    cache[key] = value;
    const keys = Object.keys(cache);
    if (keys.length > 200) {
      delete cache[keys[0]];
    }
  };
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Guards against stale responses: only the latest translate request may
  // update state (rapid typing + 500ms auto-translate can overlap requests).
  const translateReqIdRef = useRef(0);

  const activeProvider = settings.defaultProvider || 'gemini';
  const activeConfig = settings.providerConfigs?.[activeProvider] || {
    apiKey: activeProvider === 'gemini' ? settings.geminiApiKey : '',
    baseUrl: '',
    model: settings.apiModel || '',
    availableModels: [],
  };

  /**
   * Streaming translate through the background bridge (extension context):
   * deltas arrive over the port and drive the same typewriter UI.
   */
  const translateViaBridge = async (signal: AbortSignal): Promise<{ translation: string; detectedLang?: string }> => {
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
        if (partial) {
          streamingTextRef.current = partial.text;
          setStreamingText(partial.text);
        }
      },
      signal,
    );
  };

  /**
   * Consumes the SSE stream from /api/translate/stream, updating the typewriter
   * text as deltas arrive. Throws if the stream ends in an error without a
   * result, so the caller can fall back to the non-streaming path.
   */
  const translateViaStream = async (body: string, signal: AbortSignal): Promise<{ translation: string; detectedLang?: string }> => {
    const res = await fetch('/api/translate/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal,
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
          if (partial) {
            streamingTextRef.current = partial.text;
            setStreamingText(partial.text);
          }
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
    // Cancel any in-flight request from a previous translate (web SSE or the
    // background bridge) before starting this one.
    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;
    setLoading(true);
    setError(null);
    streamingTextRef.current = '';
    setStreamingText('');

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
        data = isExtensionContext() ? await translateViaBridge(controller.signal) : await translateViaStream(body, controller.signal);
      } catch (err: any) {
        // If this request was aborted (superseded by a newer one, or the user
        // pressed Stop), don't waste a call on the fallback path — propagate.
        if (requestId !== translateReqIdRef.current) throw err;
        if (controller.signal.aborted) throw err;
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

      streamingTextRef.current = '';
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
      if (controller.signal.aborted) {
        // Stopped by the user (or superseded): keep whatever was streamed so
        // far visible instead of showing an error banner.
        const partial = streamingTextRef.current;
        if (partial) {
          setResult({
            id: Date.now().toString(),
            sourceText: text,
            translation: partial,
            sourceLang,
            targetLang,
            timestamp: Date.now(),
          });
          streamingTextRef.current = '';
          setStreamingText('');
        }
        return;
      }
      console.error('Translation error:', err);
      setError(err.message || 'Translation failed');
    } finally {
      if (requestId === translateReqIdRef.current) {
        setLoading(false);
        if (streamAbortRef.current === controller) streamAbortRef.current = null;
      }
    }
  };

  /** Aborts the in-flight stream (web SSE or background bridge). */
  const handleStop = () => {
    streamAbortRef.current?.abort();
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

  // Auto-grow the input textarea with its content (90px → 260px). Skipped in
  // the compact popup, where the textarea scrolls inside a fixed-height pane.
  useEffect(() => {
    if (isPopup) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 90), 260)}px`;
  }, [sourceText, isPopup]);

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

      cacheWord(cacheKey, data); // Store in cache
      setWordExplanation(data);
    } catch (err) {
      console.error('Failed to explain word:', err);
      const fallbackObj: WordExplanation = {
        word: cleanWord,
        contextualMeaning: cleanWord,
        contextExplanation: `In-context analysis for "${cleanWord}".`,
      };
      cacheWord(cacheKey, fallbackObj);
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
      setAudioPhase(null);
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
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return;
    // Plain Enter (or Ctrl/Cmd+Enter) translates; Shift+Enter inserts a newline.
    if (e.shiftKey) return;
    e.preventDefault();
    handleTranslate();
  };

  return (
    <div className={isPopup
      ? 'flex-1 min-h-0 flex flex-col gap-2.5 px-3 py-2.5'
      : 'max-w-[1400px] mx-auto px-3 sm:px-6 py-3 sm:py-5 flex flex-col gap-3 sm:gap-4'
    }>
      {/* 1. ELEGANT LANGUAGE SELECTOR TOOLBAR */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-2 sm:p-2.5 shadow-2xs flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
        {/* Source Language Select */}
        <div className="flex items-center gap-1 flex-1 min-w-[120px]">
          {!isPopup && <span className="text-[11px] font-extrabold text-slate-400 pl-1 uppercase tracking-wider hidden sm:inline">From</span>}
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
        <div className="flex items-center gap-1 flex-1 min-w-[120px]">
          {!isPopup && <span className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider hidden sm:inline">To</span>}
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

        {/* Layout Width Ratio Switcher (Desktop only) — presets snap the drag divider */}
        {!isPopup && (
          <div className="hidden md:flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-[10px] font-bold text-slate-600 shrink-0">
            {[
              { label: '5:5', v: 50, title: '左右等宽 (5:5)' },
              { label: '6:4', v: 60, title: '原文加宽 (6:4)' },
              { label: '4:6', v: 40, title: '译文加宽 (4:6)' },
            ].map((p) => (
              <button
                key={p.label}
                onClick={() => setSplitPercent(p.v)}
                className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${
                  Math.abs(splitPercent - p.v) < 3 ? 'bg-white text-indigo-700 shadow-2xs font-extrabold' : 'hover:text-slate-900'
                }`}
                title={p.title}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {/* Translate / Stop Button */}
        <button
          onClick={() => (loading ? handleStop() : handleTranslate())}
          disabled={!sourceText.trim()}
          className={`flex items-center justify-center gap-1.5 text-white text-xs font-extrabold px-3.5 py-1.5 rounded-xl transition-all shadow-2xs hover:shadow-xs disabled:opacity-40 cursor-pointer shrink-0 ${
            loading
              ? 'bg-rose-500 hover:bg-rose-600'
              : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700'
          }`}
          title={loading ? '停止生成' : '快捷键: Enter（Shift+Enter 换行）'}
        >
          {loading ? (
            <>
              <X className="w-3.5 h-3.5 shrink-0" />
              <span>停止</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 text-indigo-200 shrink-0" />
              <span>翻译</span>
            </>
          )}
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

      {/* 2 & 3. DUAL STUDIO TRANSLATION WORKSPACE — the drag handle resizes the split */}
      <div
        ref={workspaceRef}
        className={
          isPopup
            ? 'flex-1 min-h-0 flex flex-col gap-1.5'
            : `grid grid-cols-1 gap-y-3 sm:gap-y-4 md:[grid-template-columns:minmax(0,var(--split))_12px_minmax(0,1fr)] ${splitDragging || vSplitDragging ? 'select-none' : ''}`
        }
        style={{ '--split': `${splitPercent}%` } as React.CSSProperties}
      >
        {/* LEFT / TOP COLUMN: SOURCE INPUT BOX */}
        <div
          style={isPopup ? { flex: `0 0 calc(${vSplitPercent}% - 6px)` } : undefined}
          className={`bg-white border border-slate-200/90 rounded-2xl shadow-2xs overflow-hidden flex flex-col justify-between focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/10 transition-all ${
            isPopup ? 'min-h-[85px]' : 'min-h-[240px] sm:min-h-[300px]'
          }`}
        >
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
            placeholder="输入或粘贴文本... (支持划词翻译)"
            className={`${
              isPopup
                ? 'flex-1 min-h-0 p-3 resize-none overflow-y-auto text-sm'
                : 'w-full p-3.5 sm:p-4 flex-1 min-h-[180px] sm:min-h-[220px] resize-y text-sm sm:text-base'
            } text-slate-800 font-normal focus:outline-none placeholder:text-slate-400 bg-transparent leading-relaxed`}
          />

          {/* Input Box Actions Toolbar */}
          <div className="flex items-center justify-between px-3.5 py-2 border-t border-slate-100 bg-slate-50/60 text-slate-500 text-xs">
            <div className="flex items-center gap-1.5">
              {settings.autoTranslate && (
                <button
                  onClick={openSettings}
                  title="「打字实时翻译」已开启：输入停顿 500ms 后自动翻译。点击可在设置中关闭"
                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-600 hover:bg-indigo-100 transition-colors cursor-pointer shrink-0"
                >
                  <Zap className="w-3 h-3" />
                  <span className="text-[10px] font-bold leading-none">实时翻译</span>
                </button>
              )}
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

        {/* Vertical drag handle in popup mode */}
        {isPopup && (
          <div
            onPointerDown={handleVSplitPointerDown}
            onPointerMove={handleVSplitPointerMove}
            onPointerUp={handleVSplitPointerUp}
            onPointerCancel={handleVSplitPointerUp}
            className="h-2.5 flex items-center justify-center cursor-row-resize touch-none group select-none py-0.5 shrink-0"
            title="拖动调整上下高度"
          >
            <div className={`h-[3px] rounded-full transition-all ${
              vSplitDragging ? 'bg-indigo-500 w-16' : 'bg-slate-200 group-hover:bg-indigo-400 w-10'
            }`} />
          </div>
        )}

        {/* Drag handle to freely resize the source/target split (desktop) */}
        {!isPopup && (
          <div
            onPointerDown={handleSplitPointerDown}
            onPointerMove={handleSplitPointerMove}
            onPointerUp={handleSplitPointerUp}
            onPointerCancel={handleSplitPointerUp}
            className="hidden md:flex items-center justify-center cursor-col-resize touch-none group select-none"
            title="拖动调整左右面板宽度"
          >
            <div className={`w-[3px] h-16 rounded-full transition-all ${
              splitDragging ? 'bg-indigo-500 h-24' : 'bg-slate-200 group-hover:bg-indigo-400'
            }`} />
          </div>
        )}

        {/* RIGHT / BOTTOM COLUMN: TRANSLATION RESULT BOX / DICTIONARY MODE */}
        <div
          style={isPopup ? { flex: '1 1 0%' } : undefined}
          className={`bg-white border border-slate-200/90 rounded-2xl shadow-2xs relative flex flex-col justify-between transition-all ${
            isPopup
              ? (selectedWord ? 'min-h-[110px] overflow-hidden p-0' : 'min-h-[110px] overflow-y-auto p-3')
              : (selectedWord ? 'min-h-[240px] sm:min-h-[300px] overflow-hidden p-0' : 'p-3.5 sm:p-4 min-h-[240px] sm:min-h-[300px]')
          }`}
        >
          {selectedWord ? (
            /* In-place In-Context Word Dictionary view */
            <WordContextCard
              explanation={wordExplanation}
              loading={explainingWord}
              onClose={() => {
                setSelectedWord(null);
                setWordExplanation(null);
              }}
              sentence={sourceText || result?.sourceText || ''}
              settings={settings}
            />
          ) : loading ? (
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
            <>
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

                {/* Full Sentence Translation - selectable and copyable without hijacking */}
                <div
                  className="text-slate-900 text-base sm:text-lg font-medium leading-relaxed tracking-tight select-text min-h-[60px]"
                >
                  {result?.translation || (
                    <span className="text-slate-300 italic font-normal text-sm">
                      翻译结果将在此即时显示...
                    </span>
                  )}
                </div>
              </div>

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
                    title="朗读译文"
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
                    title="复制译文"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
