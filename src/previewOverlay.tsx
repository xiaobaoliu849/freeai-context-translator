import React from 'react';
import { createRoot } from 'react-dom/client';
import { Header } from './components/Header';
import { WordContextCard } from './components/WordContextCard';
import { DEFAULT_SETTINGS } from './config';
import { WordExplanation } from './types';
import './index.css';

/** CI-only visual fixture. It renders real production UI components but uses
 * fixed public sample text, never private keys, network AI calls or fake user history.
 */
const explanation: WordExplanation = {
  word: 'collaborate',
  phonetic: '/kəˈlæbəreɪt/',
  pos: 'verb',
  contextualMeaning: '合作；协作',
  contextExplanation: '在这个句子中，指与团队共同完成一个项目，而不是一般的同处一地。',
  collocations: ['collaborate with', 'collaborate on'],
  synonymsInContext: ['work together', 'cooperate'],
  examples: [{source:'We collaborate with researchers worldwide.', target:'我们与世界各地的研究人员合作。'}],
};
const sentence='Excited to collaborate with the team at Amazon on a new generation of devices.';

function OverlayFixture() {
  return (
    <div className="yumai-app min-h-screen px-8 py-10" style={{background:'#f3f5f8'}}>
      <main aria-label="网页划词组件预览" className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-10 shadow-sm">
        <p className="mb-2 text-xs uppercase tracking-wider text-slate-400">Article · Technology</p>
        <h1 className="mb-8 text-3xl font-semibold text-slate-900">Working together on the next generation of AI</h1>
        <p className="text-lg leading-loose text-slate-500">
          We are excited to <mark className="rounded-md bg-brand-100 px-1 text-brand-800">collaborate</mark> with the team at Amazon
          on a new generation of intelligent devices. The best experiences come from creative partnerships.
        </p>
      </main>
      <aside className="yumai-app yumai-popup yumai-floating mx-auto mt-[-18px] flex h-[480px] w-[460px] max-w-[92vw] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl" aria-label="语脉网页划词卡片">
        <Header openSettings={() => {}} openHistory={() => {}} settings={DEFAULT_SETTINGS} isPopup isFloating isPinned={false} onClose={() => {}} />
        <div className="shrink-0 border-b border-slate-100 px-4 py-3 text-xs text-slate-500">
          当前语境：<span className="font-medium text-slate-700">{sentence}</span>
        </div>
        <div className="yumai-result-panel flex min-h-0 flex-1 flex-col overflow-hidden border-0 shadow-none">
          <WordContextCard explanation={explanation} word="collaborate" sentence={sentence}
            settings={DEFAULT_SETTINGS} loading={false} onClose={() => {}} onSwitchToTranslate={() => {}} />
        </div>
      </aside>
      <p className="mt-4 text-center text-xs text-slate-400">视觉检查样例 · 使用真实 Header 与 WordContextCard 组件，不调用 AI</p>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<OverlayFixture />);
