import { AppSettings } from '../types';
import { parseSavedSettings } from '../config';

export const SETTINGS_EXPORT_FORMAT = 'freetranslate-settings';

export interface SettingsExportFile {
  format: string;
  version: number;
  exportedAt: string;
  settings: AppSettings;
}

/**
 * Downloads the current settings as a JSON file. The file contains API keys,
 * so callers should warn the user not to share it.
 */
export function exportSettingsToFile(settings: AppSettings): void {
  const payload: SettingsExportFile = {
    format: SETTINGS_EXPORT_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `freetranslate-settings-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Parses an exported settings file (either the wrapped export format or a raw
 * settings object) and validates it against the schema. Throws on bad input.
 */
export function parseSettingsFile(raw: string): AppSettings {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('不是有效的 JSON 文件');
  }
  const candidate: Partial<AppSettings> =
    parsed && parsed.format === SETTINGS_EXPORT_FORMAT ? parsed.settings : parsed;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('配置文件中没有有效的设置数据');
  }
  return parseSavedSettings(JSON.stringify(candidate));
}
