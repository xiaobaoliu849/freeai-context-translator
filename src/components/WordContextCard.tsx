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
  /** Present when the current entry is concise; fetches collocations, synonyms and examples. */
  onLoadMore?: () => void;
  /** True while extra vocabulary (collocations/synonyms) is being fetched in place. */
  loadingMore?: boolean;
  /** Background the lookup was resolved against, shown so the reader knows why a sense was chosen. */
  readerNote?: string;
  /** Resolved source language for TTS playback (never 'auto'). */
  speechLang?: string;
  /** Target language for reading meanings and explanations aloud. */
  targetLang?: string;
  /** Whether to show the inner "back to sentence translation" close button. */
  showCloseButton?: boolean;
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
  onLoadMore,
  loadingMore = false,
  readerNote,
  speechLang,
  targetLang,
  showCloseButton = true,
}) => {
  // One audio slot for the card: 'word', 'meaning', 'full', 'context', or 'ex-N'.
  const [audio, setAudio] = useState<{ key: string; phase: 'generating' | 'playing' } | null>(null);
  const wordPhase = audio?.key === 'word' ? audio.phase : null;
  const meaningPhase = audio?.key === 'meaning' ? audio.phase : null;
  const fullPhase = audio?.key === 'full' ? audio.phase : null;
  const contextPhase = audio?.key === 'context' ? audio.phase : null;
  const [copiedKey, setCopiedKey] = useState<'full' | 'meaning' | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [examplesOpen, setExamplesOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const sectionId = useId();
  useEffect(() => {
    setExamplesOpen(true);
    setDetailsOpen(false);
    setAudio(null);
    setCopiedKey(null);
    setCopyError(null);
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
  const resolvedLang = speechLang && speechLang !== 'auto'
    ? speechLang
    : (settings.defaultSourceLang && settings.defaultSourceLang !== 'auto' ? settings.defaultSourceLang : 'en');
  const resolvedTargetLang = targetLang && targetLang !== 'auto'
    ? targetLang
    : (settings.defaultTargetLang || 'zh-CN');

  /** Plays `text` in the given slot; pressing the active slot again stops it. */
  const playText = (key: string, text: string, lang: string = resolvedLang) => {
    if (!text?.trim()) return;
    if (audio?.key === key) {
      audioPlayer.stopAll();
      setAudio(null);
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
      onStart: () => setAudio({ key, phase: 'generating' }),
      onAudioStart: () => setAudio(current => current?.key === key ? { key, phase: 'playing' } : current),
      onEnd: () => setAudio(current => current?.key === key ? null : current),
    });
  };

  const renderAudioIcon = (phase: 'generating' | 'playing' | null) => {
    if (phase === 'generating') {
      return <Loader2 className="w-3.5 h-3.5 animate-spin" />;
    }
    if (phase === 'playing') {
      return (
        <span className="ft-eq flex items-end gap-0.5 h-3.5 px-0.5">
          <span className="w-0.5 bg-brand-600 rounded-full animate-bounce h-2.5" />
          <span className="w-0.5 bg-brand-600 rounded-full animate-bounce h-3.5 delay-75" />
          <span className="w-0.5 bg-brand-600 rounded-full animate-bounce h-2 delay-150" />
        </span>
      );
    }
    return <Volume2 className="w-3.5 h-3.5" />;
  };

  const ipa = (value: string) => value.startsWith('/') ? value : `/${value}/`;
  const hasContext = Boolean(sentence && sentence.trim() && sentence.trim().toLowerCase() !== displayWord.trim().toLowerCase());

  const formatFullExplanation = (): string => {
    if (!explanation) return displayWord;
    const lines: string[] = [];
    const posTag = explanation.pos || explanation.partOfSpeech;
    const phonetics = [
      explanation.phoneticUk ? `英 ${ipa(explanation.phoneticUk)}` : '',
      explanation.phoneticUs ? `美 ${ipa(explanation.phoneticUs)}` : '',
      !explanation.phoneticUk && !explanation.phoneticUs && explanation.phonetic ? ipa(explanation.phonetic) : '',
    ].filter(Boolean).join(' ');
    const headerParts = [displayWord, phonetics, posTag, explanation.cefrLevel].filter(Boolean);
    if (headerParts.length > 0) {
      lines.push(headerParts.join('  '));
    }
    if (explanation.contextualMeaning?.trim()) {
      lines.push(`${hasContext ? '句中含义' : '核心释义'}：${explanation.contextualMeaning.trim()}`);
    }
    if (explanation.contextExplanation?.trim()) {
      lines.push(`语境解析：${explanation.contextExplanation.trim()}`);
    }
    const sensesList = explanation.senses || [];
    if (sensesList.length > 0) {
      lines.push(
        `${hasContext ? '常见义项对比' : '全部常见义项'}：\n` +
        sensesList.map(s => `${s.pos ? `${s.pos} ` : ''}${s.meaning}${s.inContext && hasContext ? '（本句义项）' : ''}`).join('\n')
      );
    } else if (explanation.literalMeaning?.trim() && explanation.literalMeaning.trim() !== explanation.contextualMeaning?.trim()) {
      lines.push(`通用释义：${explanation.literalMeaning.trim()}`);
    }
    return lines.join('\n') || displayWord;
  };

  const buildFullExplanationSpeech = (): string => {
    if (!explanation) return '';
    const parts: string[] = [];
    if (explanation.contextualMeaning?.trim()) {
      parts.push(explanation.contextualMeaning.trim());
    }
    if (explanation.contextExplanation?.trim()) {
      parts.push(explanation.contextExplanation.trim());
    }
    const sensesList = explanation.senses || [];
    if (sensesList.length > 0) {
      parts.push(sensesList.map(s => `${s.pos ? `${s.pos}，` : ''}${s.meaning}`).join('；'));
    } else if (explanation.literalMeaning?.trim() && explanation.literalMeaning.trim() !== explanation.contextualMeaning?.trim()) {
      parts.push(explanation.literalMeaning.trim());
    }
    return parts.join('。');
  };

  const handlePlayWordAudio = () => playText('word', displayWord || sentence || '', resolvedLang);
  const handlePlayMeaningAudio = () => {
    if (!explanation?.contextualMeaning) return;
    playText('meaning', explanation.contextualMeaning, resolvedTargetLang);
  };
  const handlePlayFullExplanationAudio = () => {
    const text = buildFullExplanationSpeech();
    if (!text) return;
    playText('full', text, resolvedTargetLang);
  };

  const handleCopyText = async (text: string, key: 'full' | 'meaning') => {
    if (!text?.trim()) return;
    setCopyError(null);
    setCopiedKey(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(current => current === key ? null : current), 1500);
    } catch {
      setCopyError('无法复制内容，请检查剪贴板权限');
    }
  };

  // Keep actions separate from metadata: long part-of-speech descriptions must
  // wrap without pushing the close button into a second, mostly empty row.
  const renderHeader = () => {
    const posTag = explanation?.pos || explanation?.partOfSpeech;
    const copyLabel = explanation ? '复制完整释义' : '复制单词';
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
              {renderAudioIcon(wordPhase)}
            </button>
          </div>
          <div className="yumai-word-actions">
            {explanation && (
              <button
                type="button"
                onClick={handlePlayFullExplanationAudio}
                data-playing={Boolean(fullPhase)}
                className="yumai-word-icon text-slate-500 hover:text-brand-600 transition-colors cursor-pointer"
                title="朗读完整释义" aria-label="朗读完整释义"
              >
                {renderAudioIcon(fullPhase)}
              </button>
            )}
            <button
              type="button"
              onClick={() => handleCopyText(formatFullExplanation(), 'full')}
              disabled={!displayWord && !explanation}
              className="yumai-word-icon text-slate-500 hover:text-slate-800 transition-colors cursor-pointer disabled:opacity-30"
              title={copyLabel} aria-label={copyLabel}
            >
              {copiedKey === 'full' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            {showCloseButton && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                className="yumai-word-icon text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
                title="返回整句翻译 (Esc)" aria-label="关闭词典，返回翻译"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        {(explanation?.phonetic || explanation?.phoneticUk || explanation?.phoneticUs || posTag || explanation?.cefrLevel || explanation?.rootOrLemma) && (
          <div className="yumai-word-meta">
            {explanation?.phoneticUk || explanation?.phoneticUs ? (
              <>
                {explanation.phoneticUk && <span className="yumai-word-phonetic"><small>英</small> {ipa(explanation.phoneticUk)}</span>}
                {explanation.phoneticUs && <span className="yumai-word-phonetic"><small>美</small> {ipa(explanation.phoneticUs)}</span>}
              </>
            ) : explanation?.phonetic && <span className="yumai-word-phonetic">{ipa(explanation.phonetic)}</span>}
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
              正在查找句中含义…
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
          <p className="text-xs text-slate-500 font-medium">暂时无法获取释义，请检查模型设置后重试。</p>
          <div className="flex items-center justify-center gap-2">
            {onRetry && (
              <button
                onClick={onRetry}
                className="yumai-secondary-action"
              >
                <RotateCcw className="w-3 h-3" />
                <span>重新解析</span>
              </button>
            )}
            {onSwitchToTranslate && (
              <button
                onClick={onSwitchToTranslate}
                className="yumai-secondary-action"
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
  const senses = explanation.senses || [];
  const examplesList = explanation.examples || explanation.exampleSentences || [];
  const contextWordIndex = sentence?.toLowerCase().indexOf(displayWord.toLowerCase()) ?? -1;
  const normalize = (value: string) => value.replace(/[\s。.，,；;、]/g, '');
  const literal = explanation.literalMeaning?.trim() || '';
  const showLiteral = literal && normalize(literal) !== normalize(explanation.contextualMeaning);
  const hasLexicalExtras = collocations.length > 0 || synonyms.length > 0 || antonyms.length > 0;

  return (
    <div className="yumai-word-card bg-white text-slate-800 w-full flex-1 min-h-0 flex flex-col overflow-hidden">
      {renderHeader()}
      {copyError && <p role="alert" className="px-3 py-1 text-xs text-rose-700">{copyError}</p>}

      {/* Body: the in-context meaning IS the interface (same typography as the
          translation it temporarily replaces). Secondary info stays flat —
          labels + inline chips, no nested boxes. */}
      <div className="yumai-word-body select-text" tabIndex={0} role="region" aria-label="完整词语解释">
        {explanation.spellingSuggestion && explanation.spellingSuggestion.toLowerCase() !== displayWord.toLowerCase() && (
          <p className="yumai-word-note">
            拼写提示：你是不是想查 <strong>{explanation.spellingSuggestion}</strong>？
          </p>
        )}

        {/* In-context or primary meaning — the hero answer */}
        <section className="yumai-word-meaning" aria-labelledby={`${sectionId}-meaning`}>
          <div className="yumai-word-meaning-head">
            <h4 id={`${sectionId}-meaning`}>{hasContext ? '句中含义' : '核心释义'}</h4>
            <div className="yumai-word-meaning-actions select-none">
              <button
                type="button"
                onClick={handlePlayMeaningAudio}
                disabled={!explanation.contextualMeaning?.trim()}
                data-playing={Boolean(meaningPhase)}
                className="yumai-word-icon yumai-word-icon--sm text-slate-500 hover:text-brand-600 transition-colors cursor-pointer disabled:opacity-30"
                title="朗读核心释义"
                aria-label="朗读核心释义"
              >
                {renderAudioIcon(meaningPhase)}
              </button>
              <button
                type="button"
                onClick={() => handleCopyText(explanation.contextualMeaning, 'meaning')}
                disabled={!explanation.contextualMeaning?.trim()}
                className="yumai-word-icon yumai-word-icon--sm text-slate-500 hover:text-slate-800 transition-colors cursor-pointer disabled:opacity-30"
                title="复制核心释义"
                aria-label="复制核心释义"
              >
                {copiedKey === 'meaning' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
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

        {/* Common dictionary senses */}
        {senses.length > 0 ? (
          <section className="yumai-word-section">
            <h4>{hasContext ? '常见义项对比' : '全部常见义项'}</h4>
            <ul className="space-y-1.5 text-sm leading-relaxed">
              {senses.map((sense, idx) => (
                <li key={idx} className="flex items-baseline gap-2">
                  {sense.pos && (
                    <span className="yumai-word-pos shrink-0 text-xs font-semibold text-slate-500">
                      {sense.pos}
                    </span>
                  )}
                  <span className={sense.inContext ? 'font-semibold text-slate-900' : 'text-slate-700'}>
                    {sense.meaning}
                  </span>
                  {sense.inContext && hasContext && (
                    <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                      本句义项
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : showLiteral && (
          <section className="yumai-word-section">
            <h4>通用释义</h4>
            <p>{literal}</p>
          </section>
        )}

        {/* Etymology / memory note */}
        {explanation.etymology && (
          <section className="yumai-word-section">
            <h4>词源与记忆</h4>
            <p>{explanation.etymology}</p>
          </section>
        )}

        {readerNote?.trim() && (
          <p className="yumai-word-note" title={readerNote}>已参考背景：{readerNote}</p>
        )}

        {hasContext && (
          <details className="yumai-word-context">
            <summary>查看原文语境</summary>
            <div className="yumai-word-context-row">
              <p>{contextWordIndex >= 0 && displayWord ? <>
                {sentence!.slice(0, contextWordIndex)}
                <mark>{sentence!.slice(contextWordIndex, contextWordIndex + displayWord.length)}</mark>
                {sentence!.slice(contextWordIndex + displayWord.length)}
              </> : sentence}</p>
              <button
                type="button"
                onClick={() => playText('context', sentence!, resolvedLang)}
                data-playing={Boolean(contextPhase)}
                className="yumai-word-icon yumai-word-icon--sm shrink-0 text-slate-500 hover:text-brand-600 transition-colors cursor-pointer select-none"
                title="朗读原文语境"
                aria-label="朗读原文语境"
              >
                {renderAudioIcon(contextPhase)}
              </button>
            </div>
          </details>
        )}

        {/* Additional vocabulary data is optional; the contextual meaning remains the hero. */}
        {hasLexicalExtras && (
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
        {/* Examples — open by default so learners immediately see usage */}
        {examplesList.length > 0 && (
          <div>
            <button
              onClick={() => setExamplesOpen((o) => !o)}
              aria-expanded={examplesOpen}
              aria-controls={`${sectionId}-examples`}
              className="yumai-word-disclosure"
            >
              <ChevronRight className={`w-3.5 h-3.5 text-brand-500 transition-transform ${examplesOpen ? 'rotate-90' : ''}`} />
              <span>{examplesList.length} 条双语例句</span>
            </button>
            {examplesOpen && (
              <div id={`${sectionId}-examples`} className="yumai-word-examples">
                {examplesList.map((ex: any, idx: number) => {
                  const src = ex.source || ex.original;
                  const tgt = ex.target || ex.translation;
                  const exKey = `ex-${idx}`;
                  const exPhase = audio?.key === exKey ? audio.phase : null;
                  return (
                    <div
                      key={idx}
                      className="text-sm space-y-1 bg-slate-50 border-l-2 border-brand-400 rounded-r-lg p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-slate-900 font-semibold leading-relaxed flex-1">{src}</p>
                        {src && (
                          <button
                            type="button"
                            onClick={() => playText(exKey, src, resolvedLang)}
                            data-playing={Boolean(exPhase)}
                            className="yumai-word-icon shrink-0 text-slate-500 hover:text-brand-600 transition-colors cursor-pointer"
                            title="朗读例句"
                            aria-label={`朗读例句 ${idx + 1}`}
                          >
                            {renderAudioIcon(exPhase)}
                          </button>
                        )}
                      </div>
                      <p className="text-brand-700 leading-relaxed font-medium">{tgt}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {onLoadMore && !hasLexicalExtras && (
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => {
              setDetailsOpen(true);
              onLoadMore();
            }}
            className="yumai-word-disclosure disabled:opacity-60"
          >
            {loadingMore ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>正在补充搭配与近义词…</span>
              </>
            ) : (
              <>
                <ChevronRight className="w-3.5 h-3.5" />
                <span>查看搭配与近义词</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
};
