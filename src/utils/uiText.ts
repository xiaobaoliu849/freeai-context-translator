/**
 * Small, pure presentation helpers shared by the popup, the full-tab workspace
 * and the history drawer. Keeping them free of React/DOM makes them testable
 * with node:test and keeps wording consistent across every entry point.
 */

export interface LanguageOption {
  code: string;
  name: string;
}

/** True for Apple platforms, where the translate shortcut is ⌘ + Enter. */
export function isApplePlatform(platform: string | undefined | null): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform || '');
}

/** Human-readable label for the "translate" keyboard shortcut. */
export function getTranslateShortcutLabel(platform?: string | null): string {
  return isApplePlatform(platform) ? '⌘ + Enter' : 'Ctrl + Enter';
}

/** Best-effort platform string in browsers; empty in Node and other hosts. */
export function detectPlatform(): string {
  if (typeof navigator === 'undefined') return '';
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return nav.userAgentData?.platform || nav.platform || '';
}

/**
 * Resolves a language code (or a name the model returned, e.g. "English") to
 * the display name used in the language selectors. Unknown values are
 * returned unchanged so nothing the model said is hidden from the user.
 */
export function getLanguageName(code: string | undefined | null, languages: readonly LanguageOption[]): string {
  const value = (code || '').trim();
  if (!value || value.toLowerCase() === 'auto') return '自动识别';
  const lower = value.toLowerCase();
  const exact = languages.find(l => l.code === value) || languages.find(l => l.code.toLowerCase() === lower);
  if (exact) return exact.name;
  const byName = languages.find(l => l.name.toLowerCase() === lower);
  if (byName) return byName.name;
  // "zh" → first "zh-*" entry; "en-US" → "en".
  const base = lower.split(/[-_]/)[0];
  const related = languages.find(l => l.code.toLowerCase() === base)
    || languages.find(l => l.code.toLowerCase().split('-')[0] === base);
  return related ? related.name : value;
}

/** "自动识别 → 简体中文" for history entries and summaries. */
export function formatLanguagePair(source: string, target: string, languages: readonly LanguageOption[]): string {
  return `${getLanguageName(source, languages)} → ${getLanguageName(target, languages)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Compact, local-time timestamp for the history list. A bare clock time is
 * ambiguous once the list spans several days, so older items carry a date.
 */
export function formatHistoryTime(timestamp: number, now: number = Date.now()): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date(now);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000);
  if (dayDiff === 0) return `今天 ${time}`;
  if (dayDiff === 1) return `昨天 ${time}`;
  if (date.getFullYear() === today.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export type TranslationErrorKind = 'config' | 'rate-limit' | 'network' | 'local-service' | 'unknown';

export interface TranslationErrorInfo {
  kind: TranslationErrorKind;
  /** One short sentence telling the user what to do next. */
  hint: string;
  /** Whether "open settings" is the most useful next step. */
  suggestSettings: boolean;
}

/**
 * Turns a raw provider/network error into an actionable hint. The raw message
 * is still shown, so this only adds guidance; it never hides details.
 */
export function describeTranslationError(message: string, provider?: string): TranslationErrorInfo {
  const text = message || '';
  const lower = text.toLowerCase();
  const isLocal = provider === 'ollama' || provider === 'custom';
  if (/\b429\b|rate.?limit|too many requests|频繁/.test(lower)) {
    return { kind: 'rate-limit', hint: '请求过于频繁或额度已用尽，请稍后重试。', suggestSettings: false };
  }
  if (/api.?key|settings|unauthori[sz]ed|forbidden|\b40[1-4]\b|payment|quota|billing|invalid.?model|model.+not.?found/.test(lower)) {
    return { kind: 'config', hint: '请检查 API Key、模型名称或账户额度。', suggestSettings: true };
  }
  if (/failed to fetch|networkerror|network error|econnrefused|timed? ?out|load failed|无法连接/.test(lower)) {
    return isLocal
      ? { kind: 'local-service', hint: '请确认本地模型服务已启动，并在设置中选择已安装的模型。', suggestSettings: true }
      : { kind: 'network', hint: '网络连接不稳定，请检查网络后重试。', suggestSettings: false };
  }
  return { kind: 'unknown', hint: '可以重试；如果持续失败，请在设置中更换模型或服务商。', suggestSettings: false };
}
