import React from 'react';
import { Volume2, BookOpen, Layers, Info, Check, X, Sparkles, ArrowRight, Lightbulb } from 'lucide-react';
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
  const [playingWord, setPlayingWord] = React.useState(false);

  const handlePlayWordAudio = () => {
    if (!explanation?.word) return;
    setPlayingWord(true);
    audioPlayer.speak({
      text: explanation.word,
      lang: settings.defaultSourceLang || 'en',
      engine: settings.ttsEngine,
      voice: settings.ttsVoice,
      rate: settings.ttsRate,
      apiKey: settings.geminiApiKey,
      providerConfigs: settings.providerConfigs,
      onStart: () => setPlayingWord(true),
      onEnd: () => setPlayingWord(false),
    });
  };

  if (loading) {
    return (
      <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-2xl p-5 backdrop-blur-md shadow-lg animate-pulse my-4 text-slate-200">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400 animate-spin" />
            <span className="text-sm font-semibold text-indigo-300">Analyzing word in sentence context...</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-2">
          <div className="h-6 bg-slate-800/80 rounded w-1/3"></div>
          <div className="h-4 bg-slate-800/60 rounded w-2/3"></div>
          <div className="h-16 bg-slate-800/40 rounded w-full"></div>
        </div>
      </div>
    );
  }

  if (!explanation) return null;

  return (
    <div className="bg-gradient-to-b from-indigo-950/80 via-slate-900/95 to-slate-900 border border-indigo-500/40 rounded-2xl p-5 shadow-2xl relative overflow-hidden my-4 text-slate-100 transition-all duration-300">
      {/* Decorative background glow */}
      <div className="absolute -top-12 -right-12 w-36 h-36 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

      {/* Header Bar */}
      <div className="flex items-start justify-between border-b border-indigo-500/20 pb-3 mb-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 className="text-2xl font-bold text-white tracking-tight">{explanation.word}</h3>
            {explanation.phonetic && (
              <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-slate-800/80 text-indigo-300 border border-slate-700">
                [{explanation.phonetic}]
              </span>
            )}
            {explanation.pos && (
              <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-950 text-purple-300 border border-purple-800/60">
                {explanation.pos}
              </span>
            )}
            {explanation.cefrLevel && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                CEFR: {explanation.cefrLevel}
              </span>
            )}
            <button
              onClick={handlePlayWordAudio}
              className={`p-1.5 rounded-lg border transition-all ${
                playingWord
                  ? 'bg-indigo-600 text-white border-indigo-400 animate-bounce'
                  : 'bg-slate-800 text-indigo-300 hover:text-white border-slate-700 hover:bg-indigo-900/50'
              }`}
              title="Pronounce word"
            >
              <Volume2 className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
            <span className="text-indigo-400 font-semibold">Context Sentence:</span>
            <span className="italic line-clamp-1">"{sentence}"</span>
          </p>
        </div>

        <button
          onClick={onClose}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-300 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 rounded-lg transition-colors"
          title="Return to full sentence translation"
        >
          <X className="w-3.5 h-3.5 text-slate-400" />
          <span>Back to Sentence</span>
        </button>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left Column: Contextual vs Literal Meaning */}
        <div className="space-y-3">
          <div className="bg-indigo-900/30 border border-indigo-500/30 rounded-xl p-3.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-300 uppercase tracking-wider mb-1">
              <Sparkles className="w-3.5 h-3.5 text-pink-400" />
              <span>In-Context Meaning</span>
            </div>
            <p className="text-lg font-bold text-emerald-300">
              {explanation.contextualMeaning}
            </p>
          </div>

          {explanation.literalMeaning && (
            <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                <BookOpen className="w-3.5 h-3.5" />
                <span>General Dictionary Definition</span>
              </div>
              <p className="text-sm text-slate-300">{explanation.literalMeaning}</p>
            </div>
          )}

          {explanation.contextExplanation && (
            <div className="bg-slate-800/30 border border-indigo-500/20 rounded-xl p-3 text-xs text-slate-300 leading-relaxed">
              <div className="flex items-center gap-1.5 font-semibold text-amber-300 mb-1">
                <Lightbulb className="w-3.5 h-3.5" />
                <span>Contextual Nuance</span>
              </div>
              <p>{explanation.contextExplanation}</p>
            </div>
          )}
        </div>

        {/* Right Column: Root, Synonyms, Collocations, Example Sentences */}
        <div className="space-y-3">
          {explanation.collocations && explanation.collocations.length > 0 && (
            <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-1.5">
                <ArrowRight className="w-3.5 h-3.5" />
                <span>Common Collocations (常用搭配)</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {explanation.collocations.map((col, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-0.5 rounded-md text-xs font-medium bg-emerald-950/60 text-emerald-200 border border-emerald-800/60"
                  >
                    {col}
                  </span>
                ))}
              </div>
            </div>
          )}

          {explanation.synonymsInContext && explanation.synonymsInContext.length > 0 && (
            <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                <Layers className="w-3.5 h-3.5 text-purple-400" />
                <span>Contextual Synonyms</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {explanation.synonymsInContext.map((syn, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 rounded-md text-xs font-medium bg-slate-900/80 text-indigo-200 border border-slate-700"
                  >
                    {syn}
                  </span>
                ))}
              </div>
            </div>
          )}

          {explanation.antonyms && explanation.antonyms.length > 0 && (
            <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-400 uppercase tracking-wider mb-1.5">
                <X className="w-3.5 h-3.5" />
                <span>Antonyms</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {explanation.antonyms.map((ant, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 rounded-md text-xs font-medium bg-rose-950/50 text-rose-200 border border-rose-800/50"
                  >
                    {ant}
                  </span>
                ))}
              </div>
            </div>
          )}

          {explanation.examples && explanation.examples.length > 0 && (
            <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                <Info className="w-3.5 h-3.5 text-blue-400" />
                <span>Example Usages</span>
              </div>
              <div className="space-y-2">
                {explanation.examples.map((ex, idx) => (
                  <div key={idx} className="text-xs border-l-2 border-indigo-500 pl-2 py-0.5">
                    <p className="text-slate-200 font-medium">{ex.source}</p>
                    <p className="text-indigo-300">{ex.target}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
