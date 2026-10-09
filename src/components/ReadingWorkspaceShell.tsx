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
    <div className="yumai-workspace flex min-h-[calc(100vh-60px)] bg-[#f6f7f9]">
      <nav aria-label="阅读工作台导航" className="yumai-workspace-nav hidden lg:flex w-[178px] shrink-0 flex-col gap-2 border-r border-slate-200 bg-white p-4">
        <p className="px-3 pt-3 pb-2 text-[11px] font-semibold tracking-wider text-slate-400">工作空间</p>
        <button type="button" onClick={onNewDocument} className="yumai-workspace-new flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-[13px] font-semibold text-white">
          <Plus className="h-4 w-4"/> 新建翻译
        </button>
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-3 text-[13px] font-semibold text-indigo-700">
          <BookOpen className="h-4 w-4"/> 智能阅读
        </div>
        <button type="button" onClick={onOpenHistory} className="flex items-center justify-between rounded-xl px-3 py-3 text-[13px] text-slate-600 hover:bg-slate-50">
          <span className="flex items-center gap-2"><Clock3 className="h-4 w-4"/> 翻译历史</span>
          <span className="text-xs text-slate-400">{historyCount}</span>
        </button>
        <button type="button" onClick={onOpenSettings} className="flex items-center gap-2 rounded-xl px-3 py-3 text-[13px] text-slate-600 hover:bg-slate-50">
          <Settings2 className="h-4 w-4"/> 设置与模型
        </button>
        <div className="mt-auto rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-xs leading-relaxed text-slate-500">
          <Sparkles className="mb-2 h-4 w-4 text-indigo-500" />
          <p className="font-semibold text-slate-700">读懂文字，更懂语境。</p>
          <p className="mt-1">选中单词查询语义；选中句子只翻译当前内容。</p>
        </div>
      </nav>

      <section className="yumai-workspace-center min-w-0 flex-1 px-3 pb-6 sm:px-5 xl:px-8" aria-label="双语翻译工作台">
        <div className="yumai-workspace-intro mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-3 pt-6 sm:px-6">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-500">
              <Languages className="h-4 w-4 text-indigo-500"/> 语境阅读工作台
            </div>
            <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">让阅读自然流动</h2>
          </div>
          <button type="button" className="yumai-secondary-action hidden md:inline-flex" onClick={() => setShowOutline(v => !v)} aria-expanded={showOutline}>
            {showOutline ? <PanelRightClose className="h-4 w-4"/> : <PanelRightOpen className="h-4 w-4"/>}
            {showOutline ? '收起阅读导航' : '展开阅读导航'}
          </button>
        </div>
        {children}
      </section>

      {showOutline && (
        <aside className="yumai-workspace-outline hidden xl:flex w-[228px] shrink-0 flex-col gap-3 border-l border-slate-200 bg-white px-4 py-6" aria-label="原文段落导航">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">文章导航</h3>
            <span className="text-xs text-slate-400">{segments.length} 段</span>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">
            <FileText className="mr-1 inline h-3.5 w-3.5 text-indigo-500"/>
            {sourceText ? `${sourceText.length} 字符 · 约 ${wordCount} 词` : '输入文本后自动生成导航'}
          </div>
          {segments.length ? (
            <ol className="yumai-outline-scroll min-h-0 flex-1 space-y-1 overflow-y-auto">
              {segments.map((s,i) => (
                <li key={s.start}>
                  <button type="button" onClick={() => onTranslateSegment(s.text)} title={s.text}
                    className="yumai-outline-item flex w-full items-start gap-2.5 rounded-xl px-2.5 py-3 text-left text-xs leading-relaxed text-slate-600 hover:bg-indigo-50 hover:text-indigo-800 focus-visible:outline-2 focus-visible:outline-indigo-500">
                    <span className="grid h-6 min-w-6 place-items-center rounded-lg bg-slate-100 text-[11px] font-semibold text-slate-500">{i+1}</span>
                    <span className="line-clamp-3">{s.text}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="pt-3 text-xs leading-relaxed text-slate-400">在原文区粘贴文章，段落将显示在这里。点击一段可单独翻译，而不替换整篇原文。</p>
          )}
          {segments.length > 0 && <p className="text-xs leading-relaxed text-slate-400">导航仅分析原文结构，不会伪造双语段落对应关系。</p>}
        </aside>
      )}
    </div>
  );
};
