import React, { useMemo, useState } from 'react';
import { ArrowUpRight, BookOpen, ChevronDown, Code2, Layers2, List, MessageCircle, Plus } from 'lucide-react';
import { getReadingSegments, ReadingSegment } from '../utils/selectionMode';

interface ReadingWorkspaceShellProps {
  sourceText: string;
  onNewDocument: () => void;
  onLoadExample: (text: string) => void;
  onTranslateSegment: (segment: ReadingSegment) => void;
  children: React.ReactNode;
}

const examples = [
  { label: '一词多义', icon: Layers2, excerpt: 'She sat on the bank.', text: 'The river was high after the storm. She sat on the bank and watched the water rise.' },
  { label: '习惯表达', icon: MessageCircle, excerpt: 'Let’s call it a day.', text: 'We have finished the last interview and everyone is tired. Let’s call it a day.' },
  { label: '技术用语', icon: Code2, excerpt: 'The patch landed.', text: 'The engineers reviewed the fix overnight. The patch landed in the main branch this morning.' },
];

export const ReadingWorkspaceShell: React.FC<ReadingWorkspaceShellProps> = ({
  sourceText, onNewDocument, onLoadExample, onTranslateSegment, children,
}) => {
  const [outlineOpen, setOutlineOpen] = useState(false);
  const segments = useMemo(() => getReadingSegments(sourceText, 24), [sourceText]);
  return (
    <section className="yumai-workspace" aria-label="双语翻译工作台">
      <div className="desk-intro">
        <div>
          <p className="desk-kicker"><span aria-hidden="true"/> READING DESK</p>
          <h2>语境翻译</h2>
          <p className="desk-lede">输入原文，或选中其中一段，结合上下文阅读译文。</p>
        </div>
        <svg className="desk-illustration" viewBox="0 0 212 104" fill="none" aria-hidden="true">
          <circle cx="145" cy="48" r="39" fill="#e8e8f6"/>
          <g stroke="#5056a3" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 62 72 32q17-4 35 1l51-25 37 41-55 32q-20-5-34 1L54 98z" fill="#ebeafa"/>
            <path d="m17 57 54-31q20-5 35 3l52-26 37 41-56 30q-18-5-34 2L54 90z" fill="#fff"/>
            <path d="m106 29 33 45M31 56l39-22q13-4 24 0M40 62l35-19q13-4 24 0M48 68l34-18q11-3 22 0M119 33l33-17M125 40l32-17M132 47l30-17" opacity=".68"/>
            <path d="m137 14 14-7 17 19-10 1-4 7z" fill="#5654bd"/>
          </g>
        </svg>
      </div>

      {children}

      {!sourceText.trim() ? (
        <section className="desk-samples" aria-label="翻译示例">
          <h3><BookOpen size={16}/> 从示例开始</h3>
          <div className="desk-example-grid">
            {examples.map(({ label, icon: Icon, excerpt, text }) => (
              <button type="button" key={label} onClick={() => onLoadExample(text)}>
                <span className="desk-example-type"><Icon size={14}/>{label}<ArrowUpRight size={15}/></span>
                <span className="desk-example-text" lang="en">{excerpt}</span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="desk-document" aria-label="原文段落导航">
          <div className="desk-document-actions">
            <button type="button" aria-expanded={outlineOpen} onClick={() => setOutlineOpen(v => !v)}>
              <List size={16}/> 段落导航 <span>{segments.length}</span><ChevronDown size={14}/>
            </button>
            <button type="button" onClick={() => { setOutlineOpen(false); onNewDocument(); }}><Plus size={15}/> 新建翻译</button>
          </div>
          {outlineOpen && <ol>{segments.map((segment, index) =>
            <li key={segment.start}><button type="button" onClick={() => onTranslateSegment(segment)}>
              <span>{String(index + 1).padStart(2, '0')}</span><span>{segment.text}</span><ArrowUpRight size={15}/>
            </button></li>
          )}</ol>}
        </section>
      )}
    </section>
  );
};
