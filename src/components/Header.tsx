import React from 'react';
import { Settings, History, ChevronDown, ExternalLink, Pin, X, Maximize2, Minimize2 } from 'lucide-react';
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
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
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
  isExpanded = false,
  onToggleExpanded,
}) => {
  const providerName = (settings?.defaultProvider || 'gemini').toUpperCase();
  const logoUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL('assets/yumai-mark.svg')
    : '/assets/yumai-mark.svg';
  const [logoError, setLogoError] = React.useState(false);

  const openFullTab = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url: chrome.runtime.getURL('workspace.html') });
    } else {
      window.open(new URL('./', window.location.href).href, '_blank');
    }
  };

  const iconButton = 'yumai-icon-button inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 transition-colors';

  return (
    <header className="yumai-header sticky top-0 z-30 shrink-0 border-b border-slate-200/75 bg-white">
      <div className="mx-auto max-w-[1400px] h-[60px] px-4 sm:px-6 flex items-center justify-between gap-3">
        <div
          className={`flex min-w-0 items-center gap-2.5 ${isFloating ? 'cursor-move' : ''}`}
          onPointerDown={isFloating ? onDragStart : undefined}
          title={isFloating ? '按住品牌区域移动窗口' : undefined}
        >
          {!logoError ? (
            <img
              src={logoUrl}
              alt="语脉图标"
              onError={() => setLogoError(true)}
              className="h-9 w-9 shrink-0 rounded-xl object-cover"
            />
          ) : (
            <span className="h-9 w-9 shrink-0 rounded-xl bg-indigo-600 text-white grid place-items-center text-base font-bold">语</span>
          )}
          <div className="min-w-0 flex flex-col leading-tight">
            <div className="flex items-baseline gap-2">
              <h1 className="truncate font-bold text-[17px] tracking-tight text-slate-900">语脉</h1>
              <span className="text-[10px] font-semibold tracking-[0.12em] text-slate-400">YUMAI</span>
            </div>
            {!isPopup && !isFloating && (
              <span className="text-[11px] text-slate-500">读懂文字，更懂语境</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <button
            type="button"
            onClick={openSettings}
            className="yumai-provider inline-flex max-w-[112px] items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-500 transition-colors"
            title="选择 AI 服务商与模型（并非连接状态）"
            aria-label={`当前选择的服务商：${providerName}；打开设置`}
          >
            <span className="truncate">{providerName}</span>
            <ChevronDown className="w-3.5 h-3.5 shrink-0" />
          </button>
          {!isFloating && (
            <button type="button" onClick={openFullTab} className={iconButton} title="在独立标签页打开" aria-label="在独立标签页打开">
              <ExternalLink className="h-[17px] w-[17px]" />
            </button>
          )}
          <button type="button" onClick={openHistory} className={iconButton} title="翻译历史" aria-label="查看翻译历史">
            <History className="h-[18px] w-[18px]" />
          </button>
          <button type="button" onClick={openSettings} className={iconButton} title="设置" aria-label="打开设置">
            <Settings className="h-[18px] w-[18px]" />
          </button>
          {isFloating && onTogglePin && (
            <button
              type="button"
              onClick={onTogglePin}
              className={`${iconButton} ${isPinned ? 'bg-indigo-50 text-indigo-700' : ''}`}
              title={isPinned ? '取消固定窗口' : '固定窗口'}
              aria-label={isPinned ? '取消固定窗口' : '固定窗口'}
              aria-pressed={isPinned}
            >
              <Pin className={`h-[17px] w-[17px] ${isPinned ? 'fill-current rotate-45' : ''}`} />
            </button>
          )}
          {isFloating && onToggleExpanded && (
            <button type="button" onClick={onToggleExpanded} className={iconButton}
              title={isExpanded ? '恢复窗口大小' : '展开阅读窗口'}
              aria-label={isExpanded ? '恢复窗口大小' : '展开阅读窗口'} aria-pressed={isExpanded}>
              {isExpanded ? <Minimize2 className="h-[17px] w-[17px]" /> : <Maximize2 className="h-[17px] w-[17px]" />}
            </button>
          )}
          {isFloating && onClose && (
            <button type="button" onClick={onClose} className={iconButton} title="关闭 (Esc)" aria-label="关闭窗口">
              <X className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
