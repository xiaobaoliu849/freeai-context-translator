import React, { useState, useEffect, useId } from 'react';
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
  const [copyError, setCopyError] = useState<string | null>(null);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const sectionId = useId();
  useEffect(() => {
    setExamplesOpen(false);
    setDetailsOpen(false);
  }, [word]);

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

  const handleCopyWord = async () => {
    if (!displayWord) return;
    setCopyError(null);
    setCopied(false);
    try {
      await navigator.clipboard.writeText(displayWord);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError('无法复制单词，请检查剪贴板权限');
    }
  };

  // Keep actions separate from metadata: long part-of-speech descriptions must
  // wrap without pushing the close button into a second, mostly empty row.
  const renderHeader = () => {
    const posTag = explanation?.pos || explanation?.partOfSpeech;
    return (
      <div className="yumai-word-header select-none">
        <div className="yumai-word-title-row">
          <div className="yumai-word-title">
            {displayWord && <h3>{displayWord}</h3>}
            <button
              onClick={handlePlayWordAudio}
              disabled={!displayWord && !sentence}
              data-playing={Boolean(wordPhase)}
              className="yumai-word-icon text-brand-600 transition-colors cursor-pointer disabled:opacity-30"
              title="播放单词发音" aria-label="播放单词发音"
            >
              {wordPhase === 'generating' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : wordPhase === 'playing' ? (
                <span className="ft-eq flex items-end gap-0.5 h-3.5 px-0.5">
                  <span className="w-0.5 bg-brand-700 rounded-full animate-bounce h-2.5" />
                  <span className="w-0.5 bg-brand-700 rounded-full animate-bounce h-3.5 delay-75" />
                  <span className="w-0.5 bg-brand-700 rounded-full animate-bounce h-2 delay-150" />
                </span>
              ) : <Volume2 className="w-3.5 h-3.5" />}
            </button>
          </div>
          <div className="yumai-word-actions">
            <button
              onClick={handleCopyWord}
              disabled={!displayWord}
              className="yumai-word-icon text-slate-500 hover:text-slate-800 transition-colors cursor-pointer disabled:opacity-30"
              title="复制单词" aria-label="复制单词"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="yumai-word-icon text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
              title="返回整句翻译 (Esc)" aria-label="关闭词典，返回翻译"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        {(explanation?.phonetic || posTag || explanation?.cefrLevel || explanation?.rootOrLemma) && (
          <div className="yumai-word-meta">
            {explanation?.phonetic && <span className="yumai-word-phonetic">
              {explanation.phonetic.startsWith('/') ? explanation.phonetic : `/${explanation.phonetic}/`}
            </span>}
            {posTag && <span className="yumai-word-pos">{posTag}</span>}
            {explanation?.cefrLevel && <span className="yumai-word-level" title="CEFR 词汇等级">{explanation.cefrLevel}</span>}
            {explanation?.rootOrLemma && explanation.rootOrLemma.toLowerCase() !== displayWord.toLowerCase() && (
              <span>原形：{explanation.rootOrLemma}</span>
            )}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="yumai-word-card bg-white text-slate-800 w-full flex-1 min-h-0 flex flex-col overflow-hidden">
        {renderHeader()}
        <div className="p-4 space-y-3 animate-pulse select-none">
          <div className="flex items-center gap-2 text-brand-600 py-1">
            <Sparkles className="w-4 h-4 animate-spin text-brand-600" />
            <span className="text-xs font-bold text-brand-700">
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
      <div className="yumai-word-card bg-white text-slate-800 w-full flex-1 min-h-0 flex flex-col overflow-hidden">
        {renderHeader()}
        <div className="flex-1 p-4 text-center space-y-3 flex flex-col items-center justify-center select-none">
          <p className="text-xs text-slate-500 font-medium">未能解析单词语境，请重试或返回整句翻译</p>
          <div className="flex items-center justify-center gap-2">
            {onRetry && (
              <button
                onClick={onRetry}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-brand-50 text-brand-700 text-xs font-bold border border-brand-200 hover:bg-brand-100 transition-all cursor-pointer shadow-2xs hover:scale-105 active:scale-95"
              >
                <RotateCcw className="w-3 h-3" />
                <span>重新解析</span>
              </button>
            )}
            {onSwitchToTranslate && (
              <button
                onClick={onSwitchToTranslate}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-brand-700 text-white text-xs font-bold hover:bg-brand-800 transition-all cursor-pointer shadow-md shadow-brand-500/30 hover:scale-105 active:scale-95"
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
  const contextWordIndex = sentence?.toLowerCase().indexOf(displayWord.toLowerCase()) ?? -1;

  return (
    <div className="yumai-word-card bg-white text-slate-800 w-full flex-1 min-h-0 flex flex-col overflow-hidden">
      {renderHeader()}
      {copyError && <p role="alert" className="px-3 py-1 text-xs text-rose-700">{copyError}</p>}

      {/* Body: the in-context meaning IS the interface (same typography as the
          translation it temporarily replaces). Secondary info stays flat —
          labels + inline chips, no nested boxes. */}
      <div className="yumai-word-body select-text" tabIndex={0} role="region" aria-label="完整词语解释">
        {/* In-context meaning — the hero answer */}
        <section className="yumai-word-meaning" aria-labelledby={`${sectionId}-meaning`}>
          <h4 id={`${sectionId}-meaning`}>句中含义</h4>
          <p>
            {explanation.contextualMeaning}
          </p>
        </section>

        {/* Context nuance */}
        {explanation.contextExplanation && (
          <section className="yumai-word-section">
            <h4>为什么是这个意思</h4>
            <p>{explanation.contextExplanation}</p>
          </section>
        )}

        {/* General dictionary definition */}
        {explanation.literalMeaning && (
          <section className="yumai-word-section">
            <h4>通用释义</h4>
            <p>{explanation.literalMeaning}</p>
          </section>
        )}

        {sentence && sentence.trim() !== displayWord.trim() && (
          <details className="yumai-word-context">
            <summary>查看原文语境</summary>
            <p>{contextWordIndex >= 0 && displayWord ? <>
              {sentence!.slice(0, contextWordIndex)}
              <mark>{sentence!.slice(contextWordIndex, contextWordIndex + displayWord.length)}</mark>
              {sentence!.slice(contextWordIndex + displayWord.length)}
            </> : sentence}</p>
          </details>
        )}

        {/* Additional vocabulary data is optional; the contextual meaning remains the hero. */}
        {(collocations.length > 0 || synonyms.length > 0 || antonyms.length > 0) && (
          <button type="button" aria-expanded={detailsOpen} aria-controls={`${sectionId}-vocabulary`}
            onClick={() => setDetailsOpen(v => !v)}
            className="yumai-word-disclosure">
            <ChevronRight className={`w-3.5 h-3.5 transition-transform ${detailsOpen ? 'rotate-90' : ''}`} />
            {detailsOpen ? '收起词汇信息' : '展开搭配、近义词与反义词'}
          </button>
        )}
        {detailsOpen && (<div id={`${sectionId}-vocabulary`} className="yumai-word-vocabulary">
        {/* Collocations — inline chips */}
        {collocations.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-slate-600 mb-2 select-none flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              常用搭配
            </div>
            <div className="flex flex-wrap gap-1.5">
              {collocations.map((col, idx) => (
                <span
                  key={idx}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-50 text-slate-700 border border-slate-200 select-text"
                >
                  {col}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Opposite meanings have an explicit label rather than deletion styling. */}
        {synonyms.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-slate-600 mb-2 select-none flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
              近义表达
            </div>
            <div className="flex flex-wrap gap-1.5">
              {synonyms.map((syn, idx) => (
                <span
                  key={`s-${idx}`}
                  className="px-2.5 py-1.5 rounded-lg text-xs bg-slate-50 text-slate-700 border border-slate-200 select-text"
                >
                  {syn}
                </span>
              ))}
            </div>
          </div>
        )}

        {antonyms.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-slate-600 mb-2">反义表达</div>
            <div className="flex flex-wrap gap-1.5">
              {antonyms.map((ant, idx) => (
                <span key={idx} className="px-2.5 py-1.5 rounded-lg text-xs bg-slate-50 text-slate-700 border border-slate-200 select-text">{ant}</span>
              ))}
            </div>
          </div>
        )}

        </div>)}
        {/* Examples — collapsed behind a single line by default */}
        {examplesList.length > 0 && (
          <div>
            <button
              onClick={() => setExamplesOpen((o) => !o)}
              aria-expanded={examplesOpen}
              aria-controls={`${sectionId}-examples`}
              className="yumai-word-disclosure"
            >
              <ChevronRight className={`w-3.5 h-3.5 text-brand-500 transition-transform ${examplesOpen ? 'rotate-90' : ''}`} />
              <span>{examplesList.length} 条例句参考</span>
            </button>
            {examplesOpen && (
              <div id={`${sectionId}-examples`} className="yumai-word-examples">
                {examplesList.map((ex: any, idx: number) => {
                  const src = ex.source || ex.original;
                  const tgt = ex.target || ex.translation;
                  return (
                    <div
                      key={idx}
                      className="text-sm space-y-1 bg-slate-50 border-l-2 border-brand-400 rounded-r-lg p-3"
                    >
                      <p className="text-slate-900 font-semibold leading-relaxed">{src}</p>
                      <p className="text-brand-700 leading-relaxed font-medium">{tgt}</p>
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
