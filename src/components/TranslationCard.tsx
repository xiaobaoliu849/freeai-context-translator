import React, { useEffect, useState } from 'react';
import { Globe, Loader2, Check, X, Copy, Volume2 } from 'lucide-react';
import { AppSettings } from '../types';
import { audioPlayer } from '../utils/audio';

interface TranslationCardProps {
  sourceText: string;
  translation: string;
  loading: boolean;
  /** Detected source language code (e.g. 'en'); empty when unknown. */
  sourceLang?: string;
  targetLang: string;
  settings: AppSettings;
  /** Optional note shown above the translation (e.g. mode fallback hints). */
  note?: string;
  onClose: () => void;
}

const LANG_LABELS: Record<string, string> = {
  en: '英语',
  'zh-CN': '中文',
  'zh-TW': '繁體中文',
  zh: '中文',
  ja: '日语',
  ko: '韩语',
  fr: '法语',
  de: '德语',
  es: '西班牙语',
  ru: '俄语',
  it: '意大利语',
  pt: '葡萄牙语',
  ar: '阿拉伯语',
  auto: '自动检测',
};

function langLabel(code?: string): string {
  if (!code) return '源语言';
  return LANG_LABELS[code] || LANG_LABELS[code.split('-')[0]] || code;
}

/**
 * Clean "just the translation" card for paragraph-length selections — the
 * counterpart to WordContextCard (word-level deep-dive). Shows the original
 * text, the translation, and actions: copy, close, and read the translation
 * aloud.
 */
export const TranslationCard: React.FC<TranslationCardProps> = ({
  sourceText,
  translation,
  loading,
  sourceLang,
  targetLang,
  settings,
  note,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const [phase, setPhase] = useState<'generating' | 'playing' | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleCopy = () => {
    navigator.clipboard.writeText(translation).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSpeak = () => {
    audioPlayer.speak({
      text: translation,
      lang: targetLang,
      engine: settings.ttsEngine,
      voice: settings.ttsVoice,
      rate: settings.ttsRate,
      apiKey: settings.geminiApiKey,
      providerConfigs: settings.providerConfigs,
      onStart: () => setPhase('generating'),
      onAudioStart: () => setPhase('playing'),
      onEnd: () => setPhase(null),
    });
  };

  if (loading) {
    return (
      <div className="bg-white/95 border border-indigo-200/90 rounded-2xl p-4 sm:p-5 backdrop-blur-xl shadow-xl animate-pulse my-3 text-slate-700 w-[420px] max-w-[92vw]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
            <span className="text-xs font-bold tracking-wide text-indigo-700">正在翻译...</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div className="h-6 bg-slate-100 rounded-lg w-1/2"></div>
          <div className="h-16 bg-slate-50 border border-slate-200/60 rounded-xl w-full"></div>
          <div className="h-8 bg-slate-50 border border-slate-200/60 rounded-xl w-full"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white text-slate-800 overflow-hidden transition-all duration-300 animate-in fade-in slide-in-from-top-2 rounded-2xl shadow-xl my-3 w-[420px] max-w-[92vw]">
      {/* Top Accent Gradient Line */}
      <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />

      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
              <Globe className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold tracking-wide text-indigo-700">
              翻译 · {langLabel(sourceLang)} → {langLabel(targetLang)}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleCopy}
              className="p-1.5 text-slate-500 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
              title="复制译文"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              title="关闭 (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {note && (
          <p className="text-[11px] text-amber-800 bg-amber-50/80 border border-amber-200/80 rounded-lg px-2.5 py-1.5 mb-2.5 leading-relaxed">
            {note}
          </p>
        )}

        {sourceText && (
          <div className="bg-slate-50/90 border border-slate-200/80 rounded-xl p-3 mb-2.5 max-h-28 overflow-y-auto">
            <p className="text-xs text-slate-500 leading-relaxed italic">{sourceText}</p>
          </div>
        )}

        <p className="text-base sm:text-lg font-bold text-slate-900 leading-relaxed">
          {translation || '（无结果）'}
        </p>
      </div>

      <div className="flex items-center justify-between px-4 sm:px-5 pb-4">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
          {langLabel(sourceLang)} → {langLabel(targetLang)}
        </span>
        <button
          onClick={handleSpeak}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
            phase
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-xs'
              : 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border-indigo-200/80'
          }`}
          title="朗读译文"
        >
          {phase === 'generating' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Volume2 className="w-3.5 h-3.5" />
          )}
          <span>{phase ? '播放中' : '朗读译文'}</span>
        </button>
      </div>
    </div>
  );
};
