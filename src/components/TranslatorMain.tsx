import React, { useState, useEffect, useRef } from 'react';
import { Volume2, Loader2, Copy, Check, Eraser, RefreshCw, Settings, History, Sparkles, X, ArrowRightLeft, Zap, PencilLine } from 'lucide-react';
import { AppSettings, TranslationResult, WordExplanation } from '../types';
import { audioPlayer } from '../utils/audio';
import { consumeSSE, extractPartialTranslation } from '../services/streaming';
import { bridgeTranslate, bridgeExplain, isExtensionContext } from '../services/bridge';
import { classifySelection, getReadingSegments, normalizeSelectedTerm } from '../utils/selectionMode';
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
  /** Bumped when a webpage selection is sent to this UI. */
  selectionSignal?: number;
  /** Limited surrounding text from the same page text node; never form-field data. */
  selectionContext?: string;
  /** Chosen segment from the reading outline. */
  workspaceSelection?: { id: number; text: string } | null;
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
  selectionSignal = 0,
  selectionContext = '',
  workspaceSelection = null,
  isPopup = false,
}) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedArea, setCopiedArea] = useState<'source' | 'target' | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
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
  const [wordContext, setWordContext] = useState<string>('');
  const [activeSelection, setActiveSelection] = useState<string>('');
  const [readingOutlineOpen, setReadingOutlineOpen] = useState(false);
  const wordReqIdRef = useRef(0);
  const skipSelectionRef = useRef(false);
  const selectionKind = classifySelection(sourceText);
  const readingSegments = React.useMemo(() => selectionKind === 'passage' ? getReadingSegments(sourceText) : [], [sourceText, selectionKind]);
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

  // Vertical split between upper and lower panels in  // Height split percent for stacked / popup mode
  const [vSplitPercent, setVSplitPercent] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('freetranslate_vsplit'));
      return saved >= 20 && saved <= 75 ? saved : 38;
    } catch {
      return 38;
    }
  });
  const [userCustomVSplit, setUserCustomVSplit] = useState<boolean>(() => {
    try {
      return localStorage.getItem('freetranslate_vsplit_custom') === 'true';
    } catch {
      return false;
    }
  });
  const [vSplitDragging, setVSplitDragging] = useState(false);
  const vSplitDragRef = useRef<{ y: number; split: number }>({ y: 0, split: 38 });

  // Intelligent adaptive height split when user hasn't explicitly locked a custom split
  const effectiveVSplitPercent = React.useMemo(() => {
    if (userCustomVSplit) return vSplitPercent;
    const len = sourceText.trim().length;
    if (len === 0) return 38;
    if (len <= 80) return 34; // Keep short content accessible while prioritizing output
    if (len <= 250) return 40;
    if (len <= 800) return 46;
    return 50; // Long form: equal scrollable source / target
  }, [sourceText, userCustomVSplit, vSplitPercent]);

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
    vSplitDragRef.current = { y: e.clientY, split: effectiveVSplitPercent };
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
    const clamped = Math.min(75, Math.max(20, next));
    setVSplitPercent(clamped);
    setUserCustomVSplit(true);
    try {
      localStorage.setItem('freetranslate_vsplit_custom', 'true');
    } catch {}
  };
  const handleVSplitPointerUp = () => setVSplitDragging(false);

  const handleResetAdaptiveSplit = () => {
    setUserCustomVSplit(false);
    try {
      localStorage.removeItem('freetranslate_vsplit_custom');
    } catch {}
  };

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
  const translateViaBridge = async (signal: AbortSignal, textToTranslate: string): Promise<{ translation: string; detectedLang?: string }> => {
    let raw = '';
    return bridgeTranslate(
      {
        text: textToTranslate,
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
        data = isExtensionContext() ? await translateViaBridge(controller.signal, text) : await translateViaStream(body, controller.signal);
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
      let errMsg = err.message || 'Translation failed';
      if (errMsg.includes('Failed to fetch') && (activeProvider === 'ollama' || activeProvider === 'custom')) {
        errMsg = '无法连接本地模型服务 (Failed to fetch)。请确保 Ollama/本地服务已启动 (http://localhost:11434)，并在设置中点击「自动获取」选择本地已安装的模型。';
      }
      setError(errMsg);
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
    if (settings.autoTranslate && !selectedWord && sourceText.trim().length > 1) {
      const timer = setTimeout(() => {
        handleTranslate();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [sourceText, sourceLang, targetLang, settings.autoTranslate, activeProvider, activeConfig.model, selectedWord]);

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
  const handleSelectWord = async (word: string, contextOverride?: string) => {
    const cleanWord = normalizeSelectedTerm(word);
    if (!cleanWord) return;
    const lookupSentence = (contextOverride || sourceText || result?.sourceText || cleanWord).slice(0, 380);
    const requestId = ++wordReqIdRef.current;
    setWordContext(lookupSentence);
    setActiveSelection('');
    setReadingOutlineOpen(false);
    const cacheKey = `${cleanWord.toLowerCase()}_${targetLang}_${activeProvider}_${activeConfig.model}_${lookupSentence.toLowerCase()}`;

    // Return cached explanation instantly if available
    if (wordCacheRef.current[cacheKey]) {
      setSelectedWord(cleanWord);
      setWordExplanation(wordCacheRef.current[cacheKey]);
      setExplainingWord(false);
      return;
    }

    setSelectedWord(cleanWord);
    setWordExplanation(null);
    setExplainingWord(true);

    try {
      let data: any;
      const apiKeyToUse = activeConfig.apiKey || (activeProvider === 'gemini' ? settings.geminiApiKey : '');

      if (isExtensionContext()) {
        // Always use the extension background bridge: keys never enter page context.
        data = await bridgeExplain({
          sentence: lookupSentence,
          selectedWord: cleanWord,
          targetLang,
          provider: activeProvider,
          baseUrl: activeConfig.baseUrl,
          model: activeConfig.model || settings.apiModel,
        });
      } else {
        try {
          const res = await fetch('/api/explain-word', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sentence: lookupSentence,
              selectedWord: cleanWord,
              targetLang,
              provider: activeProvider,
              apiKey: apiKeyToUse,
              baseUrl: activeConfig.baseUrl,
              model: activeConfig.model || settings.apiModel,
            }),
          });
          if (!res.ok) throw new Error('Server API unavailable');
          data = await res.json();
        } catch {
          const { explainWordClient } = await import('../services/aiProvider');
          data = await explainWordClient({
            sentence: lookupSentence,
            selectedWord: cleanWord,
            targetLang,
            provider: activeProvider,
            apiKey: apiKeyToUse,
            baseUrl: activeConfig.baseUrl,
            model: activeConfig.model || settings.apiModel,
          });
        }
      }
      if (requestId !== wordReqIdRef.current) return;

      cacheWord(cacheKey, data); // Store in cache
      setWordExplanation(data);
    } catch (err) {
      if (requestId !== wordReqIdRef.current) return;
      console.error('Failed to explain word:', err);
      // Do not fabricate a meaning on API failure. Show the dictionary's retry state.
      setWordExplanation(null);
    } finally {
      if (requestId === wordReqIdRef.current) setExplainingWord(false);
    }
  };

  /** Clears the selected word and returns to the sentence translation view. */
  const clearWordSelection = () => {
    wordReqIdRef.current++;
    setSelectedWord(null);
    setWordExplanation(null);
  };

  /**
   * One-line context strip shown in popup word-lookup mode: the source
   * sentence collapsed to a single line with the selected word highlighted.
   */
  const renderContextSentence = () => {
    const sentence = (wordContext || sourceText || result?.sourceText || '').replace(/\s+/g, ' ').trim();
    const w = selectedWord || '';
    const idx = w ? sentence.toLowerCase().indexOf(w.toLowerCase()) : -1;
    if (idx === -1) return <span className="italic">“{sentence}”</span>;
    return (
      <span className="italic">
        “{sentence.slice(0, idx)}
        <mark className="bg-gradient-to-r from-indigo-100 to-violet-100 text-indigo-700 font-bold rounded px-0.5 not-italic border-b-2 border-violet-300">
          {sentence.slice(idx, idx + w.length)}
        </mark>
        {sentence.slice(idx + w.length)}”
      </span>
    );
  };

  // Translate only the chosen reading segment, keeping the original document intact.
  const handledWorkspaceSelectionRef = useRef(0);
  useEffect(() => {
    if (!workspaceSelection || workspaceSelection.id === handledWorkspaceSelectionRef.current) return;
    handledWorkspaceSelectionRef.current = workspaceSelection.id;
    clearWordSelection();
    setActiveSelection(workspaceSelection.text);
    handleTranslate(workspaceSelection.text);
  }, [workspaceSelection?.id]);

  // Explicit selections choose a relevant view; history retranslation remains separate.
  const handledSelectionRef = useRef(0);
  useEffect(() => {
    if (!selectionSignal || handledSelectionRef.current === selectionSignal) return;
    handledSelectionRef.current = selectionSignal;
    if (!sourceText.trim()) return;
    setReadingOutlineOpen(false);
    if (classifySelection(sourceText) === 'term') {
      handleSelectWord(sourceText, selectionContext || sourceText);
    } else {
      clearWordSelection();
      handleTranslate();
    }
  }, [selectionSignal]);

  const handleTextareaSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    if (skipSelectionRef.current) return;
    const target = e.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    if (start !== end) {
      const highlighted = target.value.substring(start, end).trim();
      if (!highlighted) return;
      if (classifySelection(highlighted) === 'term') {
        const nearby = target.value.slice(Math.max(0, start - 140), Math.min(target.value.length, end + 140));
        handleSelectWord(highlighted, nearby);
      } else {
        clearWordSelection();
        setActiveSelection(highlighted);
      }
      return;
    }
    setActiveSelection('');
    if (selectedWord) clearWordSelection();
  };

  const focusReadingSegment = (start: number, end: number) => {
    const editor = textareaRef.current;
    if (!editor) return;
    // Navigation should not trigger word-lookup during programmatic selection.
    skipSelectionRef.current = true;
    editor.focus();
    editor.setSelectionRange(start, end);
    setActiveSelection(sourceText.slice(start, end));
    window.setTimeout(() => { skipSelectionRef.current = false; }, 80);
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

  const handleCopy = async (text: string, area: 'source' | 'target') => {
    setCopied(false);
    setCopiedArea(null);
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setCopiedArea(area);
      setTimeout(() => {
        setCopied(false);
        setCopiedArea(null);
      }, 1500);
    } catch {
      setCopyError('复制失败，请检查浏览器剪贴板权限后重试');
    }
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter inserts a newline; Ctrl/Cmd+Enter translates.
    if (e.key !== 'Enter' || (!e.ctrlKey && !e.metaKey) || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    handleTranslate(activeSelection || undefined);
  };

  return (
    <div className={isPopup
      ? 'flex-1 min-h-0 flex flex-col gap-2 px-3 py-3'
      : 'yumai-studio max-w-[1400px] mx-auto px-3 sm:px-6 py-5 flex flex-col gap-4'
    }>
      {copyError && <p role="alert" className="text-xs text-rose-700 px-2">{copyError}</p>}
      {/* 1. ELEGANT LANGUAGE SELECTOR TOOLBAR */}
      <div className="yumai-language-bar flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 sm:px-3.5">
        {/* Source Language Select */}
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {!isPopup && <span className="text-[11px] font-extrabold text-slate-400 pl-1 uppercase tracking-wider hidden sm:inline">From</span>}
          <select
            value={sourceLang}
            onChange={(e) => setSourceLang(e.target.value)}
            className="w-full rounded-lg text-slate-800 font-semibold cursor-pointer" aria-label="原文语言"
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
          className="yumai-swap-button p-2 rounded-lg transition-colors cursor-pointer shrink-0" aria-label="互换语言"
          title="互换语言"
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
        </button>

        {/* Target Language Select */}
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {!isPopup && <span className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider hidden sm:inline">To</span>}
          <select
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            className="w-full rounded-lg text-slate-800 font-semibold cursor-pointer" aria-label="译文语言"
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
          className="yumai-translate-button inline-flex shrink-0 items-center justify-center gap-1.5 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          data-loading={loading}
          aria-label={loading ? '停止翻译' : '翻译文本'}
          title={loading ? '停止生成' : 'Ctrl/Cmd+Enter 翻译，Enter 换行'}
        >
          {loading ? (
            <>
              <X className="w-3.5 h-3.5 shrink-0" />
              <span>停止</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 text-white shrink-0" />
              <span>翻译</span>
            </>
          )}
        </button>
      </div>

      {/* ERROR MESSAGE ALERT */}
      {error && (
        <div className="bg-gradient-to-r from-rose-50 via-rose-50/70 to-pink-50 border border-rose-200 text-rose-800 text-xs rounded-2xl p-2.5 sm:p-3 flex items-start justify-between gap-2.5 animate-in fade-in slide-in-from-top-1 shadow-sm shadow-rose-200/40 max-w-full overflow-hidden shrink-0">
          <div className="flex items-start gap-2 min-w-0 flex-1 overflow-hidden">
            <span className="font-extrabold bg-gradient-to-r from-rose-500 to-pink-500 text-white rounded-md px-1.5 py-0.5 text-[10px] uppercase tracking-wider shrink-0 mt-0.5 shadow-2xs">
              错误
            </span>
            <p className="leading-snug font-medium text-[11px] break-all flex-1 select-text text-rose-900">
              {error}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 ml-1">
            {(error.includes('API Key') ||
              error.includes('Settings') ||
              error.includes('401') ||
              error.includes('402') ||
              error.includes('404') ||
              error.includes('Payment') ||
              error.includes('quota') ||
              error.includes('billing')) && (
              <button
                onClick={openSettings}
                className="bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 text-white font-extrabold px-2.5 py-1 rounded-xl text-[11px] cursor-pointer shadow-sm shadow-rose-500/30 hover:scale-105 active:scale-95 transition-all whitespace-nowrap"
              >
                ⚙️ 设置 Key / 模型
              </button>
            )}
            <button
              onClick={() => setError(null)}
              className="p-1 hover:bg-rose-100/80 rounded-lg text-rose-500 hover:text-rose-800 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Auto-detected content intent with an explicit manual override. */}
      {sourceText.trim() && (
        <div className="yumai-context-chip flex flex-wrap items-center justify-between gap-2 px-1" aria-live="polite">
          <span className="text-slate-500">
            <Sparkles className="w-3.5 h-3.5 inline text-indigo-500 mr-1" />
            智能识别：{selectedWord ? '词语释义' : selectionKind === 'passage' ? '长文阅读' : selectionKind === 'term' ? '短语' : '句子翻译'}
          </span>
          <div className="flex items-center gap-2">
            {selectedWord ? (
              <button type="button" onClick={() => { clearWordSelection(); if (!result?.translation || result.sourceText !== sourceText) handleTranslate(); }}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-indigo-700 hover:bg-indigo-50">
                改看翻译
              </button>
            ) : selectionKind === 'term' ? (
              <button type="button" onClick={() => handleSelectWord(sourceText, selectionContext || sourceText)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-indigo-700 hover:bg-indigo-50">
                查看语境释义
              </button>
            ) : null}
            {selectionKind === 'passage' && (
              <button type="button" onClick={() => setReadingOutlineOpen(v => !v)}
                aria-expanded={readingOutlineOpen}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-indigo-700 hover:bg-indigo-50">
                {readingOutlineOpen ? '收起段落' : '段落导航'}
              </button>
            )}
          </div>
        </div>
      )}
      {selectionKind === 'passage' && readingOutlineOpen && !selectedWord && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-2">
          <p className="text-xs font-semibold text-slate-600">原文段落导航（不与机器译文强行对应）</p>
          <div className="flex flex-wrap gap-2">
            {readingSegments.map((segment, index) => (
              <button type="button" key={segment.start}
                onClick={() => focusReadingSegment(segment.start, segment.end)}
                title={segment.text} className="max-w-full truncate rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700 hover:bg-indigo-50 hover:text-indigo-700">
                {index + 1}. {segment.text.slice(0, 36)}{segment.text.length > 36 ? '…' : ''}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400">定位后可单独翻译所选片段。最多展示前 8 段。</p>
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
        {/* LEFT / TOP COLUMN: SOURCE INPUT BOX — in popup word-lookup mode the
            whole box collapses to a one-line context strip so the word view
            below gets almost all the vertical space. */}
        {isPopup && selectedWord ? (
          <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl select-none">
            <span
              className="flex-1 min-w-0 text-xs text-slate-600 truncate whitespace-nowrap font-medium"
              title={(sourceText || result?.sourceText || '').replace(/\s+/g, ' ').trim()}
            >
              {renderContextSentence()}
            </span>
            <button
              onClick={clearWordSelection}
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold text-indigo-700 bg-indigo-100/70 hover:bg-indigo-200/80 transition-all cursor-pointer shrink-0 shadow-2xs hover:scale-105 active:scale-95"
              title="返回编辑原文 / 整句翻译"
            >
              <PencilLine className="w-3 h-3 text-indigo-600" />
              <span>编辑原文</span>
            </button>
          </div>
        ) : (
        <div
          style={isPopup ? { flex: `0 0 calc(${effectiveVSplitPercent}% - 6px)` } : undefined}
          className={`yumai-source-panel overflow-hidden flex flex-col justify-between transition-colors ${
            isPopup ? 'min-h-[105px]' : 'min-h-[240px] sm:min-h-[300px]'
          }`}
        >
          <div className="flex shrink-0 items-center justify-between px-4 pt-3 pb-1">
            <span className="yumai-panel-caption">原文</span>
            {!isPopup && <span className="text-xs text-slate-400">选中词语可查看语境释义</span>}
          </div>
          <textarea
            aria-label="原文输入区"
            ref={textareaRef}
            value={sourceText}
            onChange={(e) => {
              setSourceText(e.target.value);
              setActiveSelection('');
              setReadingOutlineOpen(false);
              if (selectedWord) {
                setSelectedWord(null);
                setWordExplanation(null);
              }
            }}
            onSelect={handleTextareaSelect}
            onKeyDown={handleTextareaKeyDown}
            placeholder="输入或粘贴文本，选中单词可查看语境释义...（Ctrl+Enter 翻译）"
            className={`${
              isPopup
                ? 'flex-1 min-h-0 px-4 pb-3 resize-none overflow-y-auto text-sm'
                : 'w-full px-4 pb-4 flex-1 min-h-[180px] sm:min-h-[220px] resize-y text-sm sm:text-base'
            } yumai-source-editor text-slate-800 font-normal focus:outline-none placeholder:text-slate-400 bg-transparent leading-relaxed`}
          />

          {/* Input Box Actions Toolbar */}
          <div className="yumai-panel-footer flex shrink-0 items-center justify-between px-3 py-1.5 text-slate-500 text-xs">
            <div className="flex items-center gap-1.5">
              {activeSelection && (
                <button type="button" onClick={() => handleTranslate(activeSelection)}
                  className="rounded-lg bg-indigo-50 px-2 py-1 font-semibold text-indigo-700 hover:bg-indigo-100"
                  title="仅翻译当前高亮选中的句子或段落">
                  翻译所选内容
                </button>
              )}
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
                className={`p-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                  playingTarget === 'source' ? 'bg-indigo-100 text-indigo-700 shadow-inner' : 'hover:bg-indigo-50 text-slate-500 hover:text-indigo-600'
                } disabled:opacity-30`}
                title={selectedWord ? `播放 "${selectedWord}"` : "播放原文"} aria-label="朗读原文"
              >
                {playingTarget === 'source' ? (
                  <PlayIndicator phase={audioPhase} size={14} />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
              </button>

              <button
                onClick={() => handleCopy(selectedWord || sourceText, 'source')}
                disabled={!sourceText.trim()}
                className="p-1.5 rounded-lg hover:bg-emerald-50 text-slate-500 hover:text-emerald-600 transition-all disabled:opacity-30 cursor-pointer"
                title={selectedWord ? `复制 "${selectedWord}"` : "复制原文"} aria-label="复制原文"
              >
                {copied && copiedArea === 'source' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
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
                className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-500 hover:text-rose-600 transition-all disabled:opacity-30 cursor-pointer"
                title="清空文本" aria-label="清空文本"
              >
                <Eraser className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
        )}

        {/* Vertical drag handle in popup mode (hidden while a word is selected —
            the context strip has a fixed height so there is nothing to drag) */}
        {isPopup && !selectedWord && (
          <div
            onPointerDown={handleVSplitPointerDown}
            onPointerMove={handleVSplitPointerMove}
            onPointerUp={handleVSplitPointerUp}
            onPointerCancel={handleVSplitPointerUp}
            onDoubleClick={handleResetAdaptiveSplit}
            className="h-3 flex items-center justify-center cursor-row-resize touch-none group select-none py-1 shrink-0"
            title={userCustomVSplit ? '拖动调整高度 (双击恢复智能自适应)' : '智能自适应高度 (拖动可手动调整)'}
          >
            <div className={`h-[3px] rounded-full transition-all ${
              vSplitDragging ? 'bg-indigo-500 w-16' : 'bg-slate-300 group-hover:bg-indigo-400 w-10'
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
              splitDragging ? 'bg-gradient-to-b from-indigo-500 to-violet-500 h-24 shadow-sm shadow-indigo-500/40' : 'bg-slate-300 group-hover:bg-gradient-to-b group-hover:from-indigo-400 group-hover:to-violet-400'
            }`} />
          </div>
        )}

        {/* RIGHT / BOTTOM COLUMN: TRANSLATION RESULT BOX / DICTIONARY MODE */}
        <div
          style={isPopup ? { flex: '1 1 0%' } : undefined}
          className={`yumai-result-panel relative flex min-h-0 flex-col justify-between transition-colors ${
            isPopup
              ? (selectedWord ? 'min-h-[110px] overflow-hidden p-0' : 'min-h-[110px] overflow-hidden p-3.5')
              : (selectedWord ? 'min-h-[240px] sm:min-h-[300px] overflow-hidden p-0' : 'p-4 min-h-[240px] sm:min-h-[300px]')
          }`}
        >
          {selectedWord ? (
            /* In-place In-Context Word Dictionary view */
            <WordContextCard
              explanation={wordExplanation}
              loading={explainingWord}
              word={selectedWord}
              onClose={clearWordSelection}
              onSwitchToTranslate={clearWordSelection}
              sentence={wordContext || sourceText || result?.sourceText || ''}
              onRetry={() => handleSelectWord(selectedWord, wordContext)}
              settings={settings}
            />
          ) : loading ? (
            streamingText ? (
              /* Typewriter view while the SSE stream is live */
              <div className="yumai-result-scroll space-y-3">
                <div className="text-xs font-semibold">
                  <div className="flex items-center justify-between pb-1.5">
                    <span className="yumai-panel-caption flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                      {result?.sourceText && result.sourceText !== sourceText ? '所选内容译文' : '翻译结果'}
                    </span>
                    <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md font-medium" role="status">生成中…</span>
                  </div>
                  <div className="h-px bg-slate-200" />
                </div>
                <div className={`yumai-result-text ${
                  isPopup
                    ? 'text-slate-900 text-[15px] font-normal leading-relaxed tracking-normal select-text min-h-[60px] whitespace-pre-wrap pt-0.5'
                    : 'text-slate-900 text-base sm:text-lg font-medium leading-relaxed tracking-tight select-text min-h-[60px] whitespace-pre-wrap'
                }`}>
                  {streamingText}
                  <span className="inline-block w-[2px] h-[1.1em] bg-gradient-to-b from-indigo-500 to-violet-500 ml-0.5 align-text-bottom animate-pulse rounded-sm" />
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
              <div className="yumai-result-scroll space-y-3">
                {/* Output Header */}
                <div className="text-xs font-semibold">
                  <div className="flex items-center justify-between pb-1.5">
                    <span className="yumai-panel-caption flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                      {result?.sourceText && result.sourceText !== sourceText ? '所选内容译文' : '翻译结果'}
                    </span>
                    {result?.detectedLang && (
                      <span className="text-xs text-slate-500">
                        识别语种: {result.detectedLang}
                      </span>
                    )}
                  </div>
                  <div className="h-px bg-slate-200" />
                </div>

                {/* Full Sentence Translation - selectable and copyable without hijacking */}
                <div
                  className={`yumai-result-text ${
                    isPopup
                      ? 'text-slate-900 text-[15px] font-medium leading-relaxed tracking-normal select-text min-h-[60px] whitespace-pre-wrap pt-0.5'
                      : 'text-slate-900 text-base sm:text-lg font-semibold leading-relaxed tracking-tight select-text min-h-[60px] whitespace-pre-wrap'
                  }`}
                >
                  {result?.translation || (
                    <span className="text-slate-400 italic font-normal text-xs sm:text-sm flex items-center gap-1.5 pt-2 select-none">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-300 animate-pulse" />
                      翻译结果将在这里显示；选中单词可查看语境释义
                    </span>
                  )}
                </div>
              </div>

              {/* Translation Card Actions Footer */}
              <div className="yumai-result-footer flex shrink-0 items-center justify-between text-xs text-slate-500" aria-label="译文操作">
                <div className="flex items-center gap-1.5 text-xs">
                  <span>引擎</span>
                  <span className="font-medium text-slate-600 text-xs">
                    {settings.defaultProvider}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handlePlayAudio(result?.translation || '', targetLang, 'target')}
                    disabled={!result?.translation}
                    className={`p-2 rounded-xl transition-all cursor-pointer ${
                      playingTarget === 'target'
                        ? 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30'
                        : 'text-slate-500 hover:text-indigo-600 hover:bg-indigo-50'
                    } disabled:opacity-30`}
                    title="朗读译文" aria-label="朗读译文"
                  >
                    {playingTarget === 'target' ? (
                      <PlayIndicator phase={audioPhase} size={16} />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                  </button>

                  <button
                    onClick={() => result?.translation && handleCopy(result.translation, 'target')}
                    disabled={!result?.translation}
                    className="p-2 rounded-xl text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 disabled:opacity-30 cursor-pointer transition-all"
                    title="复制译文" aria-label="复制译文"
                  >
                    {copied && copiedArea === 'target' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
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
