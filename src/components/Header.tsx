import React from 'react';
import { Settings, History, ChevronRight, ExternalLink, Pin, X } from 'lucide-react';
import { AppSettings } from '../types';

interface HeaderProps {
  openSettings: () => void;
  openHistory: () => void;
  settings?: AppSettings;
  isPopup?: boolean;
  isFloating?: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
  onClose?: () => void;
  onDragStart?: (e: React.PointerEvent<HTMLDivElement>) => void;
}

export const Header: React.FC<HeaderProps> = ({
  openSettings,
  openHistory,
  settings,
  isPopup = false,
  isFloating = false,
  isPinned = false,
  onTogglePin,
  onClose,
  onDragStart,
}) => {
  const providerName = settings?.defaultProvider ? settings.defaultProvider.toUpperCase() : 'GEMINI';
  const logoUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL('assets/logo.png')
    : '/assets/logo.png';

  const handleOpenFullTab = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
    } else {
      window.open(window.location.href, '_blank');
    }
  };

  return (
    <header
      onPointerDown={onDragStart}
      className={`bg-white/95 backdrop-blur-md border-b border-slate-200/90 sticky top-0 z-30 shadow-2xs select-none ${
        isFloating ? 'cursor-move' : ''
      }`}
      title={isFloating ? '按住拖拽移动悬浮窗' : undefined}
    >
      <div className="max-w-[1400px] mx-auto px-3 sm:px-6 py-2 flex items-center justify-between gap-2">
        {/* Left: Brand Logo */}
        <div className="flex items-center gap-2">
          <img
            src={logoUrl}
            alt="FreeTranslate Logo"
            className="w-6 h-6 rounded-lg shadow-2xs border border-indigo-200/50 object-cover shrink-0"
          />
          <div className="flex items-center gap-1.5">
            <h1 className="font-extrabold text-slate-900 text-xs sm:text-sm tracking-tight leading-none">
              FreeTranslate
            </h1>
            <span className="text-[8px] font-black tracking-wider px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-200/80 uppercase">
              AI
            </span>
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
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span className="font-bold text-[10px] sm:text-[11px]">{providerName}</span>
            <ChevronRight className="w-3 h-3 text-indigo-400 shrink-0" />
          </button>

          {/* Open Full Tab Button (hidden inside small popup / floating) */}
          {!isPopup && !isFloating && (
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
            className="p-1.5 sm:px-2 rounded-xl text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer border border-slate-200/80 bg-white flex items-center justify-center gap-1"
            title="历史翻译记录"
          >
            <History className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            {!isPopup && !isFloating && <span className="hidden sm:inline">历史</span>}
          </button>

          {/* Settings Button */}
          <button
            onClick={openSettings}
            className="p-1.5 sm:px-2 rounded-xl text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer border border-slate-200/80 bg-white flex items-center justify-center gap-1"
            title="设置 API Key 与偏好"
          >
            <Settings className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            {!isPopup && !isFloating && <span className="hidden sm:inline">设置</span>}
          </button>

          {/* Floating window only: Pin & Close */}
          {isFloating && (
            <>
              {onTogglePin && (
                <button
                  onClick={onTogglePin}
                  className={`p-1.5 rounded-xl transition-colors cursor-pointer border flex items-center justify-center ${
                    isPinned
                      ? 'bg-indigo-100 text-indigo-700 border-indigo-300 font-bold'
                      : 'border-slate-200/80 bg-white text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                  }`}
                  title={isPinned ? '已固定（点击取消固定）' : '固定窗口（点击页面空白处不关闭）'}
                >
                  <Pin className={`w-3.5 h-3.5 ${isPinned ? 'fill-indigo-600 rotate-45' : ''}`} />
                </button>
              )}
              {onClose && (
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-xl border border-slate-200/80 bg-white text-slate-400 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition-colors cursor-pointer flex items-center justify-center"
                  title="关闭 (Esc)"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
};
