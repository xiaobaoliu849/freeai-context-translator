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
  Copy
} from 'lucide-react';
import { WordExplanation, AppSettings } from '../types';
import { audioPlayer } from '../utils/audio';

interface WordContextCardProps {
  explanation: WordExplanation | null;
  loading: boolean;
  onClose: () => void;
  sentence: string;
  settings: AppSettings;
}

export const WordContextCard: React.FC<WordContextCardProps> = ({
  explanation,
  loading,
  onClose,
  sentence,
  settings,
}) => {
  const [wordPhase, setWordPhase] = useState<'generating' | 'playing' | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'collocations' | 'examples'>('overview');
  const [copied, setCopied] = useState(false);

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
    if (!explanation?.word) return;
    if (wordPhase) {
      audioPlayer.stopAll();
      setWordPhase(null);
      return;
    }
    audioPlayer.speak({
      text: explanation.word,
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
    if (!explanation?.word) return;
    navigator.clipboard.writeText(explanation.word).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (loading) {
    return (
      <div className="bg-white/95 border border-indigo-200/90 rounded-2xl p-4 sm:p-5 backdrop-blur-xl shadow-xl animate-pulse my-3 text-slate-700">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
              <Sparkles className="w-4 h-4 animate-spin" />
            </div>
            <span className="text-xs font-bold tracking-wide text-indigo-700">
              正在分析单词在句中的特定语境...
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div className="h-7 bg-slate-100 rounded-lg w-1/3"></div>
          <div className="h-16 bg-slate-50 border border-slate-200/60 rounded-xl w-full"></div>
          <div className="h-10 bg-slate-50 border border-slate-200/60 rounded-xl w-full"></div>
        </div>
      </div>
    );
  }

  if (!explanation) return null;

  const posTag = explanation.pos || explanation.partOfSpeech;
  const collocationsCount = explanation.collocations?.length || 0;
  const synonymsCount = (explanation.synonymsInContext?.length || 0) + (explanation.antonyms?.length || 0);
  const examplesList = explanation.examples || explanation.exampleSentences || [];
  const examplesCount = examplesList.length;

  return (
    <div className="h-full min-h-0 flex flex-col bg-white text-slate-800 rounded-2xl overflow-hidden transition-all duration-300 animate-in fade-in slide-in-from-top-2">
      {/* Top Accent Gradient Line */}
      <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 shrink-0" />

      {/* Card Header */}
      <div className="p-3 sm:p-4 pb-2.5 shrink-0">
        <div className="flex items-start justify-between gap-3">
          {/* Left: Word, Phonetic, Badges */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight leading-none">{explanation.word}</h3>

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
                  {explanation.phonetic.startsWith('/') ? explanation.phonetic : `[/${explanation.phonetic}/]`}
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
            {sentence && (
              <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1 truncate">
                <span className="text-indigo-600 font-bold shrink-0">原句语境:</span>
                <span className="italic text-slate-600 truncate">"{sentence}"</span>
              </p>
            )}
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleCopyWord}
              className="p-1 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-colors cursor-pointer"
              title="复制单词"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={onClose}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/80 rounded-xl transition-all cursor-pointer shadow-2xs whitespace-nowrap"
              title="返回整句翻译 (Esc)"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-indigo-600" />
              <span>返回整句</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tabs Header */}
      <div className="flex items-center gap-1 px-3 bg-slate-50/90 border-y border-slate-200/90 shrink-0">
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
            <span>常用搭配 & 同义词</span>
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

      {/* Tab Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">
        {activeTab === 'overview' && (
          <div className="space-y-3.5">
            {/* Primary In-Context Meaning Box */}
            <div className="bg-gradient-to-r from-indigo-50/90 via-purple-50/40 to-emerald-50/70 border border-indigo-200/80 rounded-xl p-4 shadow-2xs">
              <div className="flex items-center gap-2 text-[11px] font-bold text-indigo-700 uppercase tracking-wider mb-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>IN-CONTEXT MEANING (句中精准含义)</span>
              </div>
              <p className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight leading-snug">
                {explanation.contextualMeaning}
              </p>
            </div>

            {/* General Dictionary Definition (if provided) */}
            {explanation.literalMeaning && (
              <div className="bg-slate-50/90 border border-slate-200/80 rounded-xl p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                  <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                  <span>字面 / 通用词典释义</span>
                </div>
                <p className="text-sm text-slate-700 font-medium leading-relaxed">{explanation.literalMeaning}</p>
              </div>
            )}

            {/* Context Nuance & Explanation */}
            {explanation.contextExplanation && (
              <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3.5 text-xs text-amber-900 leading-relaxed">
                <div className="flex items-center gap-1.5 font-bold text-amber-800 mb-1">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-600" />
                  <span>语境细微差别与用法解析</span>
                </div>
                <p className="text-amber-900 font-medium">{explanation.contextExplanation}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'collocations' && (
          <div className="space-y-3.5">
            {/* Collocations */}
            {explanation.collocations && explanation.collocations.length > 0 && (
              <div className="bg-slate-50/90 border border-slate-200/80 rounded-xl p-3.5">
                <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider block mb-2 flex items-center gap-1.5">
                  <ArrowRight className="w-3.5 h-3.5 text-emerald-600" />
                  常用搭配 (Common Collocations)
                </span>
                <div className="flex flex-wrap gap-2">
                  {explanation.collocations.map((col, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200/80 shadow-2xs"
                    >
                      {col}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Synonyms */}
            {explanation.synonymsInContext && explanation.synonymsInContext.length > 0 && (
              <div className="bg-slate-50/90 border border-slate-200/80 rounded-xl p-3.5">
                <span className="text-xs font-bold text-purple-800 uppercase tracking-wider block mb-2 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-purple-600" />
                  语境近义词 (Contextual Synonyms)
                </span>
                <div className="flex flex-wrap gap-2">
                  {explanation.synonymsInContext.map((syn, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-purple-50 text-purple-800 border border-purple-200/80"
                    >
                      {syn}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Antonyms */}
            {explanation.antonyms && explanation.antonyms.length > 0 && (
              <div className="bg-slate-50/90 border border-slate-200/80 rounded-xl p-3.5">
                <span className="text-xs font-bold text-rose-800 uppercase tracking-wider block mb-2 flex items-center gap-1.5">
                  <X className="w-3.5 h-3.5 text-rose-600" />
                  反义词 (Antonyms)
                </span>
                <div className="flex flex-wrap gap-2">
                  {explanation.antonyms.map((ant, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200/80"
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
          <div className="space-y-3">
            {examplesList.length > 0 ? (
              examplesList.map((ex: any, idx: number) => {
                const src = ex.source || ex.original;
                const tgt = ex.target || ex.translation;
                return (
                  <div
                    key={idx}
                    className="p-3 bg-slate-50/90 border border-slate-200/80 rounded-xl text-xs space-y-1 hover:border-indigo-300 transition-colors"
                  >
                    <p className="text-slate-900 font-semibold leading-relaxed flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 shrink-0" />
                      <span>{src}</span>
                    </p>
                    <p className="text-indigo-700 pl-3.5 leading-relaxed font-medium">{tgt}</p>
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-slate-400 italic py-2">暂无例句数据</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
