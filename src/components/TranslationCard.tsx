import React, { useEffect, useState, useRef } from 'react';
import {
  Globe,
  Loader2,
  Check,
  X,
  Copy,
  Volume2,
  Pin,
  Sparkles,
  ArrowRightLeft,
  Eraser,
  RefreshCw
} from 'lucide-react';
import { AppSettings } from '../types';
import { audioPlayer } from '../utils/audio';
import { bridgeTranslate } from '../services/bridge';

interface TranslationCardProps {
  sourceText: string;
  translation?: string;
  loading?: boolean;
  /** Detected source language code (e.g. 'en'); empty when unknown. */
  sourceLang?: string;
  targetLang?: string;
  settings: AppSettings;
  /** Optional note shown above the translation (e.g. mode fallback hints). */
  note?: string;
  onClose: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
  onDragStart?: (e: React.PointerEvent<HTMLDivElement>) => void;
}

const SUPPORTED_LANGUAGES = [
  { code: 'auto', label: '自动识别' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en', label: '英语' },
  { code: 'ja', label: '日语' },
  { code: 'ko', label: '韩语' },
  { code: 'fr', label: '法语' },
  { code: 'de', label: '德语' },
  { code: 'es', label: '西班牙语' },
  { code: 'ru', label: '俄语' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'it', label: '意大利语' },
  { code: 'pt', label: '葡萄牙语' },
];

export const TranslationCard: React.FC<TranslationCardProps> = ({
  sourceText: initialSourceText,
  translation: initialTranslation = '',
  loading: initialLoading = false,
  sourceLang: initialSourceLang = 'auto',
  targetLang: initialTargetLang,
  settings,
  note,
  onClose,
  isPinned = false,
  onTogglePin,
  onDragStart,
}) => {
  const [text, setText] = useState(initialSourceText || '');
  const [srcLang, setSrcLang] = useState(initialSourceLang || 'auto');
  const [tgtLang, setTgtLang] = useState(initialTargetLang || settings.defaultTargetLang || 'zh-CN');
  const [resultText, setResultText] = useState(initialTranslation);
  const [detectedLang, setDetectedLang] = useState(initialSourceLang || '');
  const [loading, setLoading] = useState(initialLoading);
  const [copiedTrans, setCopiedTrans] = useState(false);
  const [copiedSource, setCopiedSource] = useState(false);
  const [audioTarget, setAudioTarget] = useState<'source' | 'target' | null>(null);
  const [audioPhase, setAudioPhase] = useState<'generating' | 'playing' | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync initial props when they change externally
  useEffect(() => {
    if (initialSourceText !== undefined) setText(initialSourceText);
  }, [initialSourceText]);

  useEffect(() => {
    if (initialTranslation !== undefined) setResultText(initialTranslation);
  }, [initialTranslation]);

  useEffect(() => {
    if (initialLoading !== undefined) setLoading(initialLoading);
  }, [initialLoading]);

  // Keyboard shortcut listener: Escape closes card (unless user is typing)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      audioPlayer.stopAll();
    };
  }, [onClose]);

  const handleTranslate = async (textToTranslate = text, sLang = srcLang, tLang = tgtLang) => {
    const clean = textToTranslate.trim();
    if (!clean) return;

    setLoading(true);
    try {
      const activeProvider = settings.defaultProvider || 'gemini';
      const activeConfig = settings.providerConfigs?.[activeProvider] || {
        apiKey: '',
        baseUrl: '',
        model: settings.apiModel || '',
        availableModels: [],
      };

      const res = await bridgeTranslate({
        text: clean,
        sourceLang: sLang,
        targetLang: tLang,
        provider: activeProvider,
        baseUrl: activeConfig.baseUrl,
        model: activeConfig.model || settings.apiModel,
      });

      setResultText(res.translation);
      if (res.detectedLang) setDetectedLang(res.detectedLang);
    } catch (err: any) {
      setResultText(`翻译失败：${err?.message || '请检查 API Key / 网络设置'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSwapLanguages = () => {
    if (srcLang === 'auto') {
      const detected = detectedLang || 'en';
      setSrcLang(tgtLang);
      setTgtLang(detected);
    } else {
      const prevSrc = srcLang;
      setSrcLang(tgtLang);
      setTgtLang(prevSrc);
    }
    // Swap texts if translation exists
    if (resultText && !resultText.startsWith('翻译失败')) {
      const prevText = text;
      setText(resultText);
      setResultText(prevText);
    }
  };

  const handleCopy = (content: string, type: 'source' | 'target') => {
    navigator.clipboard.writeText(content).catch(() => {});
    if (type === 'target') {
      setCopiedTrans(true);
      setTimeout(() => setCopiedTrans(false), 1500);
    } else {
      setCopiedSource(true);
      setTimeout(() => setCopiedSource(false), 1500);
    }
  };

  const handleSpeak = (content: string, langCode: string, target: 'source' | 'target') => {
    if (!content.trim()) return;
    if (audioTarget === target && audioPhase) {
      audioPlayer.stopAll();
      setAudioTarget(null);
      setAudioPhase(null);
      return;
    }
    audioPlayer.speak({
      text: content,
      lang: langCode === 'auto' ? (detectedLang || 'en') : langCode,
      engine: settings.ttsEngine,
      voice: settings.ttsVoice,
      rate: settings.ttsRate,
      apiKey: settings.geminiApiKey,
      providerConfigs: settings.providerConfigs,
      onStart: () => {
        setAudioTarget(target);
        setAudioPhase('generating');
      },
      onAudioStart: () => setAudioPhase('playing'),
      onEnd: () => {
        setAudioTarget(null);
        setAudioPhase(null);
      },
    });
  };

  const activeProvider = (settings.defaultProvider || 'gemini').toUpperCase();

  return (
    <div className="bg-white/95 backdrop-blur-2xl text-slate-800 rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden w-[450px] max-w-[94vw] transition-all select-none animate-in fade-in zoom-in-95 duration-200">
      {/* Top Accent Gradient Bar */}
      <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />

      {/* Card Header (Draggable Handle) */}
      <div
        onPointerDown={onDragStart}
        className="px-3.5 py-2.5 bg-slate-50/90 border-b border-slate-200/80 flex items-center justify-between cursor-move select-none"
        title="按住拖拽移动弹窗"
      >
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-black text-[10px] shadow-xs">
            FT
          </div>
          <span className="text-xs font-black text-slate-800 tracking-tight">FreeTranslate AI</span>
          <span className="px-1.5 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 text-[9px] font-extrabold tracking-wide uppercase">
            {activeProvider}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Pin Button */}
          {onTogglePin && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin();
              }}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
                isPinned
                  ? 'bg-indigo-100 text-indigo-700 font-bold'
                  : 'text-slate-400 hover:text-slate-700 hover:bg-slate-200/60'
              }`}
              title={isPinned ? '已钉住（点击取消固定）' : '钉住弹窗（防止点击页面空白处自动关闭）'}
            >
              <Pin className={`w-3.5 h-3.5 ${isPinned ? 'fill-indigo-600 rotate-45' : ''}`} />
            </button>
          )}

          {/* Close Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
            title="关闭 (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Language Bar & Controls */}
      <div className="px-3.5 py-2 bg-white flex items-center justify-between gap-2 border-b border-slate-100">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {/* Source Lang Select */}
          <select
            value={srcLang}
            onChange={(e) => {
              setSrcLang(e.target.value);
              handleTranslate(text, e.target.value, tgtLang);
            }}
            className="text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>

          {/* Swap Button */}
          <button
            onClick={handleSwapLanguages}
            className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
            title="切换语言"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
          </button>

          {/* Target Lang Select */}
          <select
            value={tgtLang}
            onChange={(e) => {
              setTgtLang(e.target.value);
              handleTranslate(text, srcLang, e.target.value);
            }}
            className="text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
          >
            {SUPPORTED_LANGUAGES.filter((l) => l.code !== 'auto').map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        {/* Quick Action: Translate Button */}
        <button
          onClick={() => handleTranslate()}
          disabled={loading || !text.trim()}
          className="flex items-center gap-1 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs disabled:opacity-40 cursor-pointer shrink-0"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          <span>翻译</span>
        </button>
      </div>

      {/* Main Content Area */}
      <div className="p-3.5 space-y-2.5">
        {note && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1 leading-relaxed">
            {note}
          </p>
        )}

        {/* Source Text Input Box */}
        <div className="relative bg-slate-50 border border-slate-200/90 rounded-xl focus-within:border-indigo-500 focus-within:bg-white transition-all overflow-hidden">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleTranslate();
              }
            }}
            placeholder="输入或粘贴文本... (Ctrl+Enter 翻译)"
            rows={Math.min(5, Math.max(2, (text.match(/\n/g) || []).length + 1))}
            className="w-full p-2.5 text-xs text-slate-800 bg-transparent resize-none focus:outline-none leading-relaxed select-text"
          />
          <div className="flex items-center justify-between px-2.5 py-1 border-t border-slate-200/60 text-[10px] text-slate-400 bg-slate-50/80">
            <span>{text.length} 字符</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleSpeak(text, srcLang, 'source')}
                disabled={!text.trim()}
                className={`p-1 rounded hover:bg-slate-200 transition-colors disabled:opacity-30 cursor-pointer ${
                  audioTarget === 'source' ? 'text-indigo-600' : 'text-slate-500'
                }`}
                title="朗读原文"
              >
                <Volume2 className="w-3 h-3" />
              </button>
              <button
                onClick={() => handleCopy(text, 'source')}
                disabled={!text.trim()}
                className="p-1 rounded hover:bg-slate-200 transition-colors text-slate-500 disabled:opacity-30 cursor-pointer"
                title="复制原文"
              >
                {copiedSource ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
              </button>
              <button
                onClick={() => {
                  setText('');
                  setResultText('');
                  textareaRef.current?.focus();
                }}
                disabled={!text}
                className="p-1 rounded hover:bg-slate-200 transition-colors text-slate-500 disabled:opacity-30 cursor-pointer"
                title="清空输入"
              >
                <Eraser className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* Translation Output Box */}
        <div className="bg-indigo-50/40 border border-indigo-100 rounded-xl p-3 relative min-h-[70px]">
          {loading ? (
            <div className="flex items-center justify-center py-4 text-indigo-600 gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-xs font-bold">AI 正在翻译与润色...</span>
            </div>
          ) : resultText ? (
            <div className="text-slate-900 text-sm font-medium leading-relaxed select-text whitespace-pre-wrap">
              {resultText}
            </div>
          ) : (
            <div className="text-slate-400 text-xs italic py-2">
              暂无翻译结果，请在上方输入文本并点击翻译
            </div>
          )}
        </div>
      </div>

      {/* Card Footer Actions */}
      <div className="px-3.5 py-2.5 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1 text-[10px] text-slate-400">
          <span>语种:</span>
          <span className="font-semibold text-slate-600">
            {detectedLang ? (SUPPORTED_LANGUAGES.find((l) => l.code === detectedLang)?.label || detectedLang) : '自动'}
            {' → '}
            {SUPPORTED_LANGUAGES.find((l) => l.code === tgtLang)?.label || tgtLang}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => handleSpeak(resultText, tgtLang, 'target')}
            disabled={!resultText || resultText.startsWith('翻译失败')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
              audioTarget === 'target' && audioPhase
                ? 'bg-indigo-600 text-white border-indigo-500 shadow-xs'
                : 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border-indigo-200/80'
            } disabled:opacity-30`}
            title="朗读译文"
          >
            {audioTarget === 'target' && audioPhase === 'generating' ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Volume2 className="w-3 h-3" />
            )}
            <span>{audioTarget === 'target' && audioPhase ? '播放中' : '朗读'}</span>
          </button>

          <button
            onClick={() => handleCopy(resultText, 'target')}
            disabled={!resultText || resultText.startsWith('翻译失败')}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition-all cursor-pointer disabled:opacity-30 shadow-2xs"
            title="复制译文"
          >
            {copiedTrans ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
            <span>{copiedTrans ? '已复制' : '复制'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
