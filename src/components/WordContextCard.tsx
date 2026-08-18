import React, { useState, useEffect } from 'react';
import {
  Volume2,
  Loader2,
  BookOpen,
  Layers,
  Check,
  X,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Lightbulb,
  Copy,
  Pin,
  Languages,
  RotateCcw
} from 'lucide-react';
import { WordExplanation, AppSettings } from '../types';
import { audioPlayer } from '../utils/audio';

export interface WordContextCardProps {
  explanation: WordExplanation | null;
  loading: boolean;
  onClose: () => void;
  sentence?: string;
  settings: AppSettings;
  isPinned?: boolean;
  onTogglePin?: () => void;
  onDragStart?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onSwitchToTranslate?: () => void;
  onRetry?: () => void;
}

export const WordContextCard: React.FC<WordContextCardProps> = ({
  explanation,
  loading,
  onClose,
  sentence,
  settings,
  isPinned = false,
  onTogglePin,
  onDragStart,
  onSwitchToTranslate,
  onRetry,
}) => {
  const [wordPhase, setWordPhase] = useState<'generating' | 'playing' | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'collocations' | 'examples'>('overview');
  const [copied, setCopied] = useState(false);
  const [copiedFull, setCopiedFull] = useState(false);

  // Keyboard shortcut listener: Escape key closes card
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      audioPlayer.stopAll();
    };
  }, [onClose]);

  const handlePlayWordAudio = () => {
    const wordToSpeak = explanation?.word || sentence;
    if (!wordToSpeak) return;
    if (wordPhase) {
      audioPlayer.stopAll();
      setWordPhase(null);
      return;
    }
    audioPlayer.speak({
      text: wordToSpeak,
      lang: settings.defaultSourceLang || 'en',
      engine: settings.ttsEngine,
      voice: settings.ttsVoice,
      rate: settings.ttsRate,
      apiKey: settings.geminiApiKey,
      providerConfigs: settings.providerConfigs,
      onStart: () => setWordPhase('generating'),
      onAudioStart: () => setWordPhase('playing'),
      onEnd: () => setWordPhase(null),
    });
  };

  const handleCopyWord = () => {
    const w = explanation?.word || sentence;
    if (!w) return;
    navigator.clipboard.writeText(w).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleCopyFull = () => {
    if (!explanation) return;
    const parts = [
      `${explanation.word} ${explanation.phonetic ? `[${explanation.phonetic}]` : ''}`,
      `句中释义: ${explanation.contextualMeaning}`,
      explanation.literalMeaning ? `通用释义: ${explanation.literalMeaning}` : '',
      explanation.contextExplanation ? `语境辨析: ${explanation.contextExplanation}` : '',
    ].filter(Boolean);
    navigator.clipboard.writeText(parts.join('\n')).catch(() => {});
    setCopiedFull(true);
    setTimeout(() => setCopiedFull(false), 1500);
  };

  const activeProvider = (settings.defaultProvider || 'gemini').toUpperCase();

  // Top header with Draggable Handle, Branding, Provider, Switch & Pin & Close
  const renderHeader = () => (
    <div
      onPointerDown={onDragStart}
      className="px-3.5 py-2.5 bg-slate-50/90 border-b border-slate-200/80 flex items-center justify-between cursor-move select-none shrink-0"
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
        {onSwitchToTranslate && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSwitchToTranslate();
            }}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg border border-transparent hover:border-indigo-100 transition-colors cursor-pointer mr-0.5"
            title="切换至整句翻译模式"
          >
            <Languages className="w-3 h-3 text-indigo-500" />
            <span>整句翻译</span>
          </button>
        )}

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
            title={isPinned ? '已固定（点击取消固定）' : '固定弹窗（防止点击页面空白处自动关闭）'}
          >
            <Pin className={`w-3.5 h-3.5 ${isPinned ? 'fill-indigo-600 rotate-45' : ''}`} />
          </button>
        )}

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
  );

  if (loading) {
    return (
      <div className="bg-white/95 backdrop-blur-2xl text-slate-800 rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden w-[450px] max-w-[94vw] transition-all select-none animate-in fade-in duration-200">
        <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 shrink-0" />
        {renderHeader()}
        <div className="p-4 space-y-3 animate-pulse">
          <div className="flex items-center gap-2 text-indigo-600 py-1">
            <Sparkles className="w-4 h-4 animate-spin text-indigo-600" />
            <span className="text-xs font-bold text-indigo-700">
              AI 正在深度解析单词在当前语境中的精准释义...
            </span>
          </div>
          <div className="h-6 bg-slate-100 rounded-lg w-2/5" />
          <div className="h-16 bg-slate-50 border border-slate-200/60 rounded-xl w-full" />
          <div className="h-10 bg-slate-50 border border-slate-200/60 rounded-xl w-full" />
        </div>
      </div>
    );
  }

  if (!explanation) {
    return (
      <div className="bg-white/95 backdrop-blur-2xl text-slate-800 rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden w-[450px] max-w-[94vw] transition-all select-none animate-in fade-in duration-200">
        <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 shrink-0" />
        {renderHeader()}
        <div className="p-4 text-center space-y-3">
          <p className="text-xs text-slate-500 font-medium">未能解析单词语境，请重试或切换至整句翻译</p>
          <div className="flex items-center justify-center gap-2">
            {onRetry && (
              <button
                onClick={onRetry}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-bold border border-indigo-200 hover:bg-indigo-100 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>重新解析</span>
              </button>
            )}
            {onSwitchToTranslate && (
              <button
                onClick={onSwitchToTranslate}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-colors cursor-pointer"
              >
                <Languages className="w-3 h-3" />
                <span>切换整句翻译</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const posTag = explanation.pos || explanation.partOfSpeech;
  const collocationsCount = explanation.collocations?.length || 0;
  const synonymsCount = (explanation.synonymsInContext?.length || 0) + (explanation.antonyms?.length || 0);
  const examplesList = explanation.examples || explanation.exampleSentences || [];
  const examplesCount = examplesList.length;

  return (
    <div className="bg-white/95 backdrop-blur-2xl text-slate-800 rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden w-[450px] max-w-[94vw] max-h-[85vh] flex flex-col transition-all select-none animate-in fade-in zoom-in-95 duration-200">
      {/* Top Accent Gradient Line */}
      <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 shrink-0" />

      {/* Draggable Header */}
      {renderHeader()}

      {/* Word Hero & Badges */}
      <div className="p-3.5 pb-2.5 shrink-0 bg-white border-b border-slate-100">
        <div className="flex items-start justify-between gap-3">
          {/* Left: Word, Pronounce, Phonetic, Badges */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-xl font-black text-slate-900 tracking-tight leading-none">
                {explanation.word}
              </h3>

              {/* Audio Pronunciation Button */}
              <button
                onClick={handlePlayWordAudio}
                className={`p-1.5 rounded-xl border transition-all flex items-center gap-1 cursor-pointer ${
                  wordPhase
                    ? 'bg-indigo-600 text-white border-indigo-500 shadow-xs'
                    : 'bg-indigo-50/80 hover:bg-indigo-100 text-indigo-700 border-indigo-200/80'
                }`}
                title="播放单词发音"
              >
                {wordPhase === 'generating' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                ) : wordPhase === 'playing' ? (
                  <span className="ft-eq flex items-end gap-0.5 h-3.5 px-0.5">
                    <span className="w-0.5 bg-indigo-600 rounded-full animate-bounce h-2.5" />
                    <span className="w-0.5 bg-indigo-600 rounded-full animate-bounce h-3.5 delay-75" />
                    <span className="w-0.5 bg-indigo-600 rounded-full animate-bounce h-2 delay-150" />
                  </span>
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
              </button>

              {/* Phonetic Tag */}
              {explanation.phonetic && (
                <span className="text-[11px] font-mono px-1.5 py-0.5 rounded-lg bg-slate-100 text-slate-600 border border-slate-200">
                  {explanation.phonetic.startsWith('/') ? explanation.phonetic : `[${explanation.phonetic}]`}
                </span>
              )}

              {/* POS Tag */}
              {posTag && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-lg bg-purple-50 text-purple-700 border border-purple-200/80">
                  {posTag}
                </span>
              )}

              {/* CEFR Tag */}
              {explanation.cefrLevel && (
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200/90">
                  CEFR: {explanation.cefrLevel}
                </span>
              )}
            </div>

            {/* Context Sentence */}
            {sentence && sentence.trim() !== explanation.word.trim() && (
              <p className="text-[11px] text-slate-500 mt-1.5 flex items-center gap-1 truncate">
                <span className="text-indigo-600 font-bold shrink-0">原句语境:</span>
                <span className="italic text-slate-600 truncate">"{sentence}"</span>
              </p>
            )}
          </div>

          {/* Right: Copy Word */}
          <button
            onClick={handleCopyWord}
            className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-colors cursor-pointer shrink-0"
            title="复制单词"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Tabs Header */}
      <div className="flex items-center gap-1 px-3 bg-slate-50/90 border-b border-slate-200/90 shrink-0">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-2.5 py-1.5 text-xs font-semibold border-b-2 transition-all flex items-center gap-1 cursor-pointer ${
            activeTab === 'overview'
              ? 'border-indigo-600 text-indigo-700 bg-white shadow-2xs font-bold'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
          }`}
        >
          <Sparkles className="w-3 h-3 text-indigo-600" />
          <span>语境释义</span>
        </button>

        {(collocationsCount > 0 || synonymsCount > 0) && (
          <button
            onClick={() => setActiveTab('collocations')}
            className={`px-2.5 py-1.5 text-xs font-semibold border-b-2 transition-all flex items-center gap-1 cursor-pointer ${
              activeTab === 'collocations'
                ? 'border-indigo-600 text-indigo-700 bg-white shadow-2xs font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
            }`}
          >
            <Layers className="w-3 h-3 text-purple-600" />
            <span>搭配 & 同反义词</span>
            <span className="px-1.5 py-0.2 rounded-full bg-slate-200 text-[10px] text-slate-700 font-bold">
              {collocationsCount + synonymsCount}
            </span>
          </button>
        )}

        {examplesCount > 0 && (
          <button
            onClick={() => setActiveTab('examples')}
            className={`px-2.5 py-1.5 text-xs font-semibold border-b-2 transition-all flex items-center gap-1 cursor-pointer ${
              activeTab === 'examples'
                ? 'border-indigo-600 text-indigo-700 bg-white shadow-2xs font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
            }`}
          >
            <BookOpen className="w-3 h-3 text-emerald-600" />
            <span>经典例句</span>
            <span className="px-1.5 py-0.2 rounded-full bg-slate-200 text-[10px] text-slate-700 font-bold">
              {examplesCount}
            </span>
          </button>
        )}
      </div>

      {/* Tab Body with Smooth Scroll */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3">
        {activeTab === 'overview' && (
          <div className="space-y-2.5">
            {/* Primary In-Context Meaning */}
            <div className="bg-gradient-to-r from-indigo-50/90 via-purple-50/40 to-emerald-50/70 border border-indigo-200/80 rounded-xl p-3.5 shadow-2xs">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-700 uppercase tracking-wider mb-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>IN-CONTEXT MEANING (句中精准含义)</span>
              </div>
              <p className="text-lg font-black text-slate-900 tracking-tight leading-snug">
                {explanation.contextualMeaning}
              </p>
            </div>

            {/* General Dictionary Definition (if provided) */}
            {explanation.literalMeaning && (
              <div className="bg-slate-50/90 border border-slate-200/80 rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  <BookOpen className="w-3 h-3 text-slate-400" />
                  <span>字面 / 通用词典释义</span>
                </div>
                <p className="text-xs text-slate-700 font-medium leading-relaxed">
                  {explanation.literalMeaning}
                </p>
              </div>
            )}

            {/* Context Nuance & Explanation */}
            {explanation.contextExplanation && (
              <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3 text-xs leading-relaxed">
                <div className="flex items-center gap-1.5 font-bold text-amber-800 mb-1 text-[11px]">
                  <Lightbulb className="w-3 h-3 text-amber-600" />
                  <span>语境细微差别与用法辨析</span>
                </div>
                <p className="text-amber-900 font-medium">{explanation.contextExplanation}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'collocations' && (
          <div className="space-y-2.5">
            {/* Collocations */}
            {explanation.collocations && explanation.collocations.length > 0 && (
              <div className="bg-slate-50/90 border border-slate-200/80 rounded-xl p-3">
                <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider block mb-2 flex items-center gap-1">
                  <ArrowRight className="w-3 h-3 text-emerald-600" />
                  常用搭配 (Common Collocations)
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {explanation.collocations.map((col, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200/80 shadow-2xs"
                    >
                      {col}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Synonyms */}
            {explanation.synonymsInContext && explanation.synonymsInContext.length > 0 && (
              <div className="bg-slate-50/90 border border-slate-200/80 rounded-xl p-3">
                <span className="text-[11px] font-bold text-purple-800 uppercase tracking-wider block mb-2 flex items-center gap-1">
                  <Layers className="w-3 h-3 text-purple-600" />
                  语境近义词 (Contextual Synonyms)
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {explanation.synonymsInContext.map((syn, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-purple-50 text-purple-800 border border-purple-200/80"
                    >
                      {syn}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Antonyms */}
            {explanation.antonyms && explanation.antonyms.length > 0 && (
              <div className="bg-slate-50/90 border border-slate-200/80 rounded-xl p-3">
                <span className="text-[11px] font-bold text-rose-800 uppercase tracking-wider block mb-2 flex items-center gap-1">
                  <X className="w-3 h-3 text-rose-600" />
                  反义词 (Antonyms)
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {explanation.antonyms.map((ant, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200/80"
                    >
                      {ant}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'examples' && (
          <div className="space-y-2.5">
            {examplesList.length > 0 ? (
              examplesList.map((ex: any, idx: number) => {
                const src = ex.source || ex.original;
                const tgt = ex.target || ex.translation;
                return (
                  <div
                    key={idx}
                    className="p-2.5 bg-slate-50/90 border border-slate-200/80 rounded-xl text-xs space-y-1 hover:border-indigo-300 transition-colors"
                  >
                    <p className="text-slate-900 font-semibold leading-relaxed flex items-start gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 shrink-0" />
                      <span>{src}</span>
                    </p>
                    <p className="text-indigo-700 pl-3 leading-relaxed font-medium">{tgt}</p>
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-slate-400 italic py-2 text-center">暂无例句数据</p>
            )}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="px-3.5 py-2 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between text-xs shrink-0">
        <div className="text-[10px] text-slate-400 font-medium">
          按 <kbd className="px-1 py-0.5 bg-slate-200 text-slate-700 rounded text-[9px] font-mono">Esc</kbd> 退出
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handlePlayWordAudio}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
              wordPhase
                ? 'bg-indigo-600 text-white border-indigo-500 shadow-xs'
                : 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border-indigo-200/80'
            }`}
            title="朗读单词发音"
          >
            <Volume2 className="w-3 h-3" />
            <span>{wordPhase ? '播放中' : '发音'}</span>
          </button>

          <button
            onClick={handleCopyFull}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition-all cursor-pointer shadow-2xs"
            title="复制完整释义"
          >
            {copiedFull ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
            <span>{copiedFull ? '已复制' : '复制释义'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
