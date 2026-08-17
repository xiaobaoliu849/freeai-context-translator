import React, { useState } from 'react';
import {
  X,
  Trash2,
  Copy,
  Check,
  Clock,
  ArrowRight,
  Download,
  Search,
  Volume2,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  FileText,
} from 'lucide-react';
import { HistoryItem, AppSettings } from '../types';
import { audioPlayer } from '../utils/audio';

interface HistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  history: HistoryItem[];
  settings: AppSettings;
  onSelectHistory: (item: HistoryItem) => void;
  onRetranslate: (item: HistoryItem) => void;
  onClearHistory: () => void;
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  isOpen,
  onClose,
  history,
  settings,
  onSelectHistory,
  onRetranslate,
  onClearHistory,
}) => {
  const [copiedTransId, setCopiedTransId] = useState<string | null>(null);
  const [copiedSourceId, setCopiedSourceId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playPhase, setPlayPhase] = useState<'generating' | 'playing' | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (!isOpen) {
      audioPlayer.stopAll();
      setPlayingId(null);
      setPlayPhase(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleExpand = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleExpandAll = () => {
    if (expandedIds.size === filteredHistory.length) {
      setExpandedIds(new Set());
    } else {
      setExpandedIds(new Set(filteredHistory.map((item) => item.id)));
    }
  };

  const handleCopy = (text: string, id: string, type: 'source' | 'trans', e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).catch(() => {});
    if (type === 'trans') {
      setCopiedTransId(id);
      setTimeout(() => setCopiedTransId(null), 1500);
    } else {
      setCopiedSourceId(id);
      setTimeout(() => setCopiedSourceId(null), 1500);
    }
  };

  const handleReplay = (item: HistoryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (playingId === item.id) {
      audioPlayer.stopAll();
      setPlayingId(null);
      setPlayPhase(null);
      return;
    }
    audioPlayer.speak({
      text: item.translation,
      lang: item.targetLang || 'zh-CN',
      engine: settings.ttsEngine,
      voice: settings.ttsVoice,
      rate: settings.ttsRate,
      apiKey: settings.geminiApiKey,
      providerConfigs: settings.providerConfigs,
      onStart: () => {
        setPlayingId(item.id);
        setPlayPhase('generating');
      },
      onAudioStart: () => setPlayPhase('playing'),
      onEnd: () => {
        setPlayingId(null);
        setPlayPhase(null);
      },
    });
  };

  const handleExport = () => {
    if (history.length === 0) return;
    const exportData = JSON.stringify(history, null, 2);
    const blob = new Blob([exportData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `translation_history_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredHistory = history.filter((item) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      item.sourceText.toLowerCase().includes(query) ||
      item.translation.toLowerCase().includes(query)
    );
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex justify-end">
      <div className="bg-white border-l border-slate-200 w-full max-w-lg h-full flex flex-col p-5 shadow-2xl text-slate-800 animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-600" />
            <h3 className="font-bold text-base text-slate-900">翻译历史</h3>
            <span className="text-xs bg-indigo-50 text-indigo-700 font-bold px-2 py-0.5 rounded-full border border-indigo-100">
              {history.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {filteredHistory.length > 0 && (
              <button
                onClick={toggleExpandAll}
                className="text-xs font-semibold text-slate-500 hover:text-indigo-600 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                title={expandedIds.size === filteredHistory.length ? '全部收起' : '全部展开'}
              >
                <ChevronsUpDown className="w-3.5 h-3.5" />
                <span>{expandedIds.size === filteredHistory.length ? '全部收起' : '全部展开'}</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              title="关闭"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        {history.length > 0 && (
          <div className="pt-3">
            <div className="relative flex items-center">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索原文或译文..."
                className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 text-slate-400 hover:text-slate-600 p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* History List */}
        <div className="flex-1 overflow-y-auto py-4 space-y-3">
          {filteredHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-slate-400 text-xs py-16 gap-2">
              <FileText className="w-8 h-8 text-slate-300 stroke-1" />
              <span>{searchQuery ? '未找到匹配的翻译记录' : '暂无历史记录，完成的翻译会自动保存在这里'}</span>
            </div>
          ) : (
            filteredHistory.map((item) => {
              const isExpanded = expandedIds.has(item.id);
              return (
                <div
                  key={item.id}
                  className={`bg-slate-50/90 border transition-all rounded-xl p-3.5 ${
                    isExpanded
                      ? 'border-indigo-300 shadow-xs bg-white'
                      : 'border-slate-200 hover:border-indigo-200 hover:bg-slate-50'
                  }`}
                >
                  {/* Top Bar: Language & Timestamp & Expand button */}
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
                    <span className="font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50/80 px-2 py-0.5 rounded-md">
                      {item.sourceLang} → {item.targetLang}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px]">
                        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <button
                        onClick={(e) => toggleExpand(item.id, e)}
                        className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer flex items-center gap-0.5 text-[10px] font-semibold"
                        title={isExpanded ? '收起详情' : '展开查看完整内容'}
                      >
                        <span>{isExpanded ? '收起' : '展开'}</span>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Source & Translated Text Content */}
                  <div
                    onClick={() => toggleExpand(item.id)}
                    className="cursor-pointer space-y-1.5"
                    title={isExpanded ? '点击收起' : '点击展开查看全部内容'}
                  >
                    {/* Source Text */}
                    <div className="relative group">
                      <p className={`text-xs text-slate-700 font-medium leading-relaxed ${isExpanded ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>
                        {item.sourceText}
                      </p>
                    </div>

                    {/* Translation */}
                    <div className="relative group pt-1">
                      <p className={`text-xs text-emerald-700 font-semibold leading-relaxed ${isExpanded ? 'whitespace-pre-wrap text-emerald-800' : 'line-clamp-2'}`}>
                        {item.translation}
                      </p>
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div className="mt-3 pt-2.5 border-t border-slate-200/70 flex items-center justify-between flex-wrap gap-2">
                    {/* Load to Editor Action */}
                    <button
                      onClick={() => {
                        onSelectHistory(item);
                        onClose();
                      }}
                      className="text-[11px] text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2.5 py-1 rounded-lg flex items-center gap-1 font-bold transition-colors cursor-pointer"
                      title="载入到翻译主界面"
                    >
                      <span>载入原文</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>

                    {/* Tool Buttons */}
                    <div className="flex items-center gap-1">
                      {/* Copy Source Button (shown when expanded) */}
                      {isExpanded && (
                        <button
                          onClick={(e) => handleCopy(item.sourceText, item.id, 'source', e)}
                          className="px-2 py-1 rounded-lg text-[10px] font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 cursor-pointer flex items-center gap-1 transition-colors"
                          title="复制原文"
                        >
                          {copiedSourceId === item.id ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                          <span>复制原文</span>
                        </button>
                      )}

                      {/* Retranslate */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRetranslate(item);
                          onClose();
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 cursor-pointer transition-colors"
                        title="重新翻译"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>

                      {/* Audio Speak */}
                      <button
                        onClick={(e) => handleReplay(item, e)}
                        className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                          playingId === item.id ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'
                        }`}
                        title="朗读译文"
                      >
                        {playingId === item.id ? (
                          playPhase === 'generating' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <span className="ft-eq" style={{ height: 14 }}>
                              <span />
                              <span />
                              <span />
                              <span />
                            </span>
                          )
                        ) : (
                          <Volume2 className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {/* Copy Translation */}
                      <button
                        onClick={(e) => handleCopy(item.translation, item.id, 'trans', e)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 cursor-pointer transition-colors flex items-center gap-1 text-[10px]"
                        title="复制译文"
                      >
                        {copiedTransId === item.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Bottom Bar: Export & Clear */}
        {history.length > 0 && (
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition-colors cursor-pointer"
              title="导出历史记录 (JSON)"
            >
              <Download className="w-3.5 h-3.5" />
              <span>导出全部</span>
            </button>

            <button
              onClick={onClearHistory}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>清空历史</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
