import React, { useState, useEffect } from 'react';
import {
  Volume2,
  Loader2,
  Check,
  X,
  Sparkles,
  Copy,
  ChevronRight,
  RotateCcw,
  Languages
} from 'lucide-react';
import { WordExplanation, AppSettings } from '../types';
import { audioPlayer } from '../utils/audio';

export interface WordContextCardProps {
  explanation: WordExplanation | null;
  loading: boolean;
  onClose: () => void;
  /** The looked-up word itself (available even while the explanation loads). */
  word?: string | null;
  sentence?: string;
  settings: AppSettings;
  onSwitchToTranslate?: () => void;
  onRetry?: () => void;
}

/**
 * Lean in-context word view (openai-translator style): the word's in-context
 * meaning REPLACES the translation output in place — no card chrome, no tabs,
 * no footer. Deselecting the word (or Esc / ✕) returns to the sentence
 * translation, so there is deliberately no "back" affordance.
 */
export const WordContextCard: React.FC<WordContextCardProps> = ({
  explanation,
  loading,
  onClose,
  word,
  sentence,
  settings,
  onSwitchToTranslate,
  onRetry,
}) => {
  const [wordPhase, setWordPhase] = useState<'generating' | 'playing' | null>(null);
  const [copied, setCopied] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);

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

  const displayWord = explanation?.word || word || '';

  const handlePlayWordAudio = () => {
    const wordToSpeak = displayWord || sentence;
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
    if (!displayWord) return;
    navigator.clipboard.writeText(displayWord).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Compact single-row header: word + pronunciation + badges + close. This is
  // the ONLY fixed chrome the view has.
  const renderHeader = () => {
    const posTag = explanation?.pos || explanation?.partOfSpeech;
    return (
      <div className="px-3.5 py-2.5 flex items-center gap-1.5 shrink-0 border-b border-slate-100 select-none">
        {displayWord && (
          <h3 className="text-lg font-black text-slate-900 tracking-tight leading-none truncate">
            {displayWord}
          </h3>
        )}

        {/* Audio Pronunciation Button */}
        <button
          onClick={handlePlayWordAudio}
          disabled={!displayWord && !sentence}
          className={`p-1 rounded-lg transition-all cursor-pointer disabled:opacity-30 ${
            wordPhase
              ? 'bg-indigo-100 text-indigo-700'
              : 'text-indigo-600 hover:bg-indigo-50'
          }`}
          title="播放单词发音"
        >
          {wordPhase === 'generating' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
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

        {/* Phonetic */}
        {explanation?.phonetic && (
          <span className="text-[11px] font-mono text-slate-500">
            {explanation.phonetic.startsWith('/') ? explanation.phonetic : `/${explanation.phonetic}/`}
          </span>
        )}

        {/* POS Tag */}
        {posTag && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200/80">
            {posTag}
          </span>
        )}

        {/* CEFR Tag */}
        {explanation?.cefrLevel && (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200/90">
            {explanation.cefrLevel}
          </span>
        )}

        <div className="flex-1" />

        {/* Copy Word */}
        <button
          onClick={handleCopyWord}
          disabled={!displayWord}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-30"
          title="复制单词"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
        </button>

        {/* Close (deselecting the word has the same effect) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
          title="返回整句翻译 (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="bg-white text-slate-800 w-full flex-1 min-h-0 flex flex-col overflow-hidden animate-in fade-in duration-200">
        {renderHeader()}
        <div className="p-4 space-y-3 animate-pulse select-none">
          <div className="flex items-center gap-2 text-indigo-600 py-1">
            <Sparkles className="w-4 h-4 animate-spin text-indigo-600" />
            <span className="text-xs font-bold text-indigo-700">
              AI 正在解析单词在当前语境中的含义...
            </span>
          </div>
          <div className="h-6 bg-slate-100 rounded-lg w-3/5" />
          <div className="h-4 bg-slate-50 rounded-lg w-4/5" />
        </div>
      </div>
    );
  }

  if (!explanation) {
    return (
      <div className="bg-white text-slate-800 w-full flex-1 min-h-0 flex flex-col overflow-hidden animate-in fade-in duration-200">
        {renderHeader()}
        <div className="flex-1 p-4 text-center space-y-3 flex flex-col items-center justify-center select-none">
          <p className="text-xs text-slate-500 font-medium">未能解析单词语境，请重试或返回整句翻译</p>
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
                <span>返回整句翻译</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const collocations = explanation.collocations || [];
  const synonyms = explanation.synonymsInContext || [];
  const antonyms = explanation.antonyms || [];
  const examplesList = explanation.examples || explanation.exampleSentences || [];

  return (
    <div className="bg-white text-slate-800 w-full flex-1 min-h-0 flex flex-col overflow-hidden animate-in fade-in duration-200">
      {renderHeader()}

      {/* Body: the in-context meaning IS the interface (same typography as the
          translation it temporarily replaces). Secondary info stays flat —
          labels + inline chips, no nested boxes. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3 space-y-3 select-text">
        {/* Original sentence with the word highlighted (desktop only — the popup
            shows a dedicated context strip above instead) */}
        {sentence && sentence.trim() !== displayWord.trim() && (
          <p className="text-[11px] text-slate-400 italic truncate select-none">
            “{sentence}”
          </p>
        )}

        {/* In-context meaning — the hero answer */}
        <section>
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-1 select-none">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>句中含义</span>
          </div>
          <p className="text-lg font-extrabold text-slate-900 leading-snug tracking-tight">
            {explanation.contextualMeaning}
          </p>
        </section>

        {/* Context nuance */}
        {explanation.contextExplanation && (
          <p className="text-xs text-slate-600 leading-relaxed">
            <span className="font-bold text-amber-600 select-none">语境辨析 · </span>
            {explanation.contextExplanation}
          </p>
        )}

        {/* General dictionary definition */}
        {explanation.literalMeaning && (
          <p className="text-xs text-slate-600 leading-relaxed">
            <span className="font-bold text-slate-500 select-none">通用释义 · </span>
            {explanation.literalMeaning}
          </p>
        )}

        {/* Collocations — inline chips */}
        {collocations.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-1 select-none">常用搭配</div>
            <div className="flex flex-wrap gap-1">
              {collocations.map((col, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200/70"
                >
                  {col}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Synonyms & antonyms — inline chips */}
        {(synonyms.length > 0 || antonyms.length > 0) && (
          <div>
            <div className="text-[10px] font-bold text-purple-700 uppercase tracking-wider mb-1 select-none">近义 / 反义</div>
            <div className="flex flex-wrap gap-1">
              {synonyms.map((syn, idx) => (
                <span
                  key={`s-${idx}`}
                  className="px-2 py-0.5 rounded-md text-xs font-medium bg-purple-50 text-purple-800 border border-purple-200/70"
                >
                  {syn}
                </span>
              ))}
              {antonyms.map((ant, idx) => (
                <span
                  key={`a-${idx}`}
                  className="px-2 py-0.5 rounded-md text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200/70 line-through decoration-rose-300"
                >
                  {ant}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Examples — collapsed behind a single line by default */}
        {examplesList.length > 0 && (
          <div>
            <button
              onClick={() => setExamplesOpen((o) => !o)}
              className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-indigo-600 transition-colors cursor-pointer select-none"
            >
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${examplesOpen ? 'rotate-90' : ''}`} />
              <span>{examplesList.length} 条例句</span>
            </button>
            {examplesOpen && (
              <div className="mt-1.5 space-y-1.5">
                {examplesList.map((ex: any, idx: number) => {
                  const src = ex.source || ex.original;
                  const tgt = ex.target || ex.translation;
                  return (
                    <div key={idx} className="text-xs space-y-0.5 border-l-2 border-indigo-200 pl-2.5">
                      <p className="text-slate-900 font-semibold leading-relaxed">{src}</p>
                      <p className="text-indigo-700 leading-relaxed font-medium">{tgt}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
