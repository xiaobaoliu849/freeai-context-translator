import React from 'react';
import { Settings, History, ChevronRight, ExternalLink } from 'lucide-react';
import { AppSettings } from '../types';

interface HeaderProps {
  openSettings: () => void;
  openHistory: () => void;
  settings?: AppSettings;
  // When rendered inside the 440x570 extension popup, hide actions that only
  // make sense in the full web app (e.g. "open this page in a new tab").
  isPopup?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  openSettings,
  openHistory,
  settings,
  isPopup = false,
}) => {
  const providerName = settings?.defaultProvider ? settings.defaultProvider.toUpperCase() : 'GEMINI';

  const handleOpenFullTab = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
    } else {
      window.open(window.location.href, '_blank');
    }
  };

  return (
    <header className="bg-white/90 backdrop-blur-md border-b border-slate-200/90 sticky top-0 z-30 shadow-xs">
      <div className="max-w-6xl mx-auto px-3 py-2 flex items-center justify-between gap-2">
        {/* Left: Brand Logo */}
        <div className="flex items-center gap-2">
          <img
            src="/assets/logo.png"
            alt="FreeTranslate Logo"
            className="w-7 h-7 rounded-xl shadow-xs border border-indigo-200/50 object-cover shrink-0"
          />
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="font-extrabold text-slate-900 text-sm sm:text-base tracking-tight leading-none">
                FreeTranslate
              </h1>
              <span className="text-[9px] font-extrabold tracking-wider px-1.5 py-0.2 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100/80 uppercase">
                AI
              </span>
            </div>
          </div>
        </div>

        {/* Right: Controls & Actions */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {/* Active AI Engine Pill */}
          <button
            onClick={openSettings}
            className="flex items-center gap-1 px-2 py-1 rounded-xl bg-indigo-50/80 hover:bg-indigo-100/90 border border-indigo-100 text-indigo-700 text-xs font-semibold transition-all cursor-pointer whitespace-nowrap"
            title="点击切换 AI 服务商与模型"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span className="font-bold text-[11px]">{providerName}</span>
            <ChevronRight className="w-3 h-3 text-indigo-400 shrink-0" />
          </button>

          {/* Open Full Tab Button (hidden inside the small popup) */}
          {!isPopup && (
            <button
              onClick={handleOpenFullTab}
              className="p-1.5 rounded-xl text-slate-600 hover:text-indigo-600 hover:bg-slate-100 transition-colors cursor-pointer border border-slate-200/80 bg-white"
              title="在新标签页中打开大屏全屏视图"
            >
              <ExternalLink className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            </button>
          )}

          {/* History Button */}
          <button
            onClick={openHistory}
            className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer border border-slate-200/80 bg-white flex items-center gap-1"
            title="历史翻译记录"
          >
            <History className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="hidden sm:inline">历史</span>
          </button>

          {/* Settings Button */}
          <button
            onClick={openSettings}
            className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer border border-slate-200/80 bg-white flex items-center gap-1"
            title="设置 API Key 与偏好"
          >
            <Settings className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="hidden sm:inline">设置</span>
          </button>
        </div>
      </div>
    </header>
  );
};
