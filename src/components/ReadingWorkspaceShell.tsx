import React, { useMemo, useState } from 'react';
import { BookOpen, Clock3, FileText, Languages, PanelRightClose, PanelRightOpen, Plus, Settings2, Sparkles } from 'lucide-react';
import { getReadingSegments } from '../utils/selectionMode';

interface ReadingWorkspaceShellProps {
  sourceText: string;
  historyCount: number;
  onNewDocument: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onTranslateSegment: (text: string) => void;
  children: React.ReactNode;
}

/**
 * Full-tab presentation intentionally differs from the Chrome popup:
 * a focused editing workspace with optional navigation and original paragraphs.
 * The underlying translator still owns all API operations and user settings.
 */
export const ReadingWorkspaceShell: React.FC<ReadingWorkspaceShellProps> = ({
  sourceText, historyCount, onNewDocument, onOpenHistory, onOpenSettings, onTranslateSegment, children,
}) => {
  const [showOutline, setShowOutline] = useState(true);
  const segments = useMemo(() => getReadingSegments(sourceText, 24), [sourceText]);
  const wordCount = useMemo(() => {
    const cjk = (sourceText.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length;
    const latin = (sourceText.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
    return cjk + latin;
  }, [sourceText]);

  return (
    <div className="yumai-workspace flex min-h-[calc(100vh-60px)]">
      <nav aria-label="阅读工作台导航" className="yumai-workspace-nav hidden lg:flex shrink-0 flex-col">
        <p>工作空间</p>
        <button type="button" onClick={onNewDocument} className="yumai-workspace-new flex items-center justify-center gap-2 font-semibold text-white">
          <Plus className="h-4 w-4"/> 新建翻译
        </button>
        <div className="yumai-nav-item" aria-current="page">
          <span><BookOpen aria-hidden="true"/> 智能阅读</span>
        </div>
        <button type="button" onClick={onOpenHistory} className="yumai-nav-item">
          <span><Clock3 aria-hidden="true"/> 翻译历史</span>
          <span className="yumai-nav-count" aria-label={`${historyCount} 条记录`}>{historyCount}</span>
        </button>
        <button type="button" onClick={onOpenSettings} className="yumai-nav-item">
          <span><Settings2 aria-hidden="true"/> 设置与模型</span>
        </button>
        <div className="yumai-nav-tip">
          <Sparkles className="mb-2 h-4 w-4 text-brand-500" aria-hidden="true" />
          <p>读懂文字，更懂语境。</p>
          <p className="mt-1">选中单词查询语义；选中句子只翻译当前内容。</p>
        </div>
      </nav>

      <section className="yumai-workspace-center min-w-0 flex-1 px-3 pb-6 sm:px-5 xl:px-8" aria-label="双语翻译工作台">
        <div className="yumai-workspace-intro mx-auto flex max-w-[1400px] items-end justify-between gap-3 px-3 sm:px-6">
          <div>
            <div className="yumai-workspace-eyebrow">
              <Languages aria-hidden="true"/> 语境阅读工作台
            </div>
            <h2 className="yumai-workspace-title">让阅读自然流动</h2>
            <p className="yumai-workspace-subtitle">粘贴文章或段落，对照原文阅读译文；选中单词即可查看语境释义。</p>
          </div>
          <button type="button" className="yumai-secondary-action hidden md:inline-flex" onClick={() => setShowOutline(v => !v)} aria-expanded={showOutline}>
            {showOutline ? <PanelRightClose className="h-4 w-4"/> : <PanelRightOpen className="h-4 w-4"/>}
            {showOutline ? '收起阅读导航' : '展开阅读导航'}
          </button>
        </div>
        {children}
      </section>

      {showOutline && (
        <aside className="yumai-workspace-outline hidden xl:flex shrink-0 flex-col" aria-label="原文段落导航">
          <div className="flex items-center justify-between">
            <h3 className="yumai-outline-heading">文章导航</h3>
            <span className="yumai-nav-count">{segments.length} 段</span>
          </div>
          <div className="yumai-outline-stats">
            <FileText className="h-3.5 w-3.5" aria-hidden="true"/>
            {sourceText ? `${sourceText.length} 字符 · 约 ${wordCount} 词` : '输入文本后自动生成导航'}
          </div>
          {segments.length ? (
            <ol className="yumai-outline-scroll min-h-0 flex-1 space-y-1 overflow-y-auto">
              {segments.map((s,i) => (
                <li key={s.start}>
                  <button type="button" onClick={() => onTranslateSegment(s.text)} title={s.text}
                    aria-label={`翻译第 ${i + 1} 段：${s.text.slice(0, 60)}`}
                    className="yumai-outline-item flex w-full items-start text-left">
                    <span aria-hidden="true" className="yumai-outline-index">{i+1}</span>
                    <span className="line-clamp-3">{s.text}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="yumai-outline-note pt-1">在原文区粘贴文章，段落将显示在这里。点击一段可单独翻译，而不替换整篇原文。</p>
          )}
          {segments.length > 0 && <p className="yumai-outline-note">导航仅分析原文结构，不会伪造双语段落对应关系。</p>}
        </aside>
      )}
    </div>
  );
};
