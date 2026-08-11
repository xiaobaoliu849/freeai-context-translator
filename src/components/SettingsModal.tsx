import React, { useState, useRef } from 'react';
import {
  X,
  Save,
  Sliders,
  Check,
  Eye,
  EyeOff,
  RefreshCw,
  Cpu,
  Sparkles,
  Server,
  Globe,
  ExternalLink,
  Volume2,
  VolumeX,
  Download,
  Upload,
} from 'lucide-react';
import { AppSettings, ProviderType, TTSEngine, ProviderConfig } from '../types';
import { audioPlayer } from '../utils/audio';
import { exportSettingsToFile, parseSettingsFile } from '../utils/settingsExport';
import { bridgeModels, isExtensionContext } from '../services/bridge';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSaveSettings: (newSettings: AppSettings) => void;
  languages: Array<{ code: string; name: string }>;
}

const PROVIDERS_INFO: Array<{
  id: ProviderType;
  name: string;
}> = [
  { id: 'gemini', name: 'Google Gemini' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'qwen', name: '阿里云 DashScope (通义/CosyVoice)' },
  { id: 'doubao', name: '火山引擎 (豆包/Volcano TTS)' },
  { id: 'moonshot', name: '月之暗面 (Kimi)' },
  { id: 'minimax', name: 'MiniMax (T2A 语音模型)' },
  { id: 'groq', name: 'Groq' },
  { id: 'openai', name: 'OpenAI (Audio Speech)' },
  { id: 'fishaudio', name: 'Fish Audio (Fish Speech)' },
  { id: 'custom', name: '自定义 API' },
];

const TTS_VOICES_BY_ENGINE: Record<TTSEngine, Array<{ id: string; name: string }>> = {
  gemini: [
    { id: 'Kore', name: 'Gemini Neural - Kore (Female 24kHz)' },
    { id: 'Zephyr', name: 'Gemini Neural - Zephyr (Female)' },
    { id: 'Puck', name: 'Gemini Neural - Puck (Male)' },
    { id: 'Fenrir', name: 'Gemini Neural - Fenrir (Male)' },
    { id: 'Aoede', name: 'Gemini Neural - Aoede (Female)' },
    { id: 'Charon', name: 'Gemini Neural - Charon (Male)' },
  ],
  edge: [
    { id: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao (zh-CN Female)' },
    { id: 'zh-CN-YunxiNeural', name: 'Yunxi (zh-CN Male)' },
    { id: 'zh-CN-YunjianNeural', name: 'Yunjian (zh-CN News)' },
    { id: 'zh-CN-XiaoyiNeural', name: 'Xiaoyi (zh-CN Female)' },
    { id: 'en-US-JennyNeural', name: 'Jenny (en-US Female)' },
    { id: 'en-US-GuyNeural', name: 'Guy (en-US Male)' },
    { id: 'en-GB-SoniaNeural', name: 'Sonia (en-GB Female)' },
    { id: 'ja-JP-NanamiNeural', name: 'Nanami (ja-JP Female)' },
    { id: 'ko-KR-SunHiNeural', name: 'SunHi (ko-KR Female)' },
  ],
  openai: [
    { id: 'alloy', name: 'OpenAI TTS-1 - Alloy' },
    { id: 'echo', name: 'OpenAI TTS-1 - Echo' },
    { id: 'fable', name: 'OpenAI TTS-1 - Fable' },
    { id: 'onyx', name: 'OpenAI TTS-1 - Onyx' },
    { id: 'nova', name: 'OpenAI TTS-1 - Nova' },
    { id: 'shimmer', name: 'OpenAI TTS-1 - Shimmer' },
  ],
  minimax: [
    { id: 'speech-2.8-hd:male-qingnian', name: 'Speech-2.8 HD - Male' },
    { id: 'speech-2.8-hd:female-shaonv', name: 'Speech-2.8 HD - Female' },
    { id: 'speech-02-hd:presenter_female', name: 'Speech-02 HD - Female Presenter' },
    { id: 'speech-02-hd:presenter_male', name: 'Speech-02 HD - Male Presenter' },
    { id: 'speech-01-hd:female-yujie', name: 'Speech-01 HD - Female' },
  ],
  qwen: [
    { id: 'qwen-audio-3.0-tts-flash:longxiaochun', name: 'Qwen 3.0 TTS Flash (极速超低延迟 - 龙小春)' },
    { id: 'qwen-audio-3.0-tts-flash:longxiaocheng', name: 'Qwen 3.0 TTS Flash (极速超低延迟 - 龙小诚)' },
    { id: 'qwen-audio-3.0-tts-plus:longxiaochun', name: 'Qwen 3.0 TTS Plus (高保真音质 - 龙小春)' },
    { id: 'qwen-audio-3.0-tts-plus:longxiaocheng', name: 'Qwen 3.0 TTS Plus (高保真音质 - 龙小诚)' },
    { id: 'cosyvoice-v3.5-plus:longxiaochun', name: 'CosyVoice v3.5 Plus (自然柔和 - 龙小春)' },
    { id: 'cosyvoice-v3.5-flash:longxiaocheng', name: 'CosyVoice v3.5 Flash (阳光男声 - 龙小诚)' },
    { id: 'cosyvoice-v3-plus:longxiaochun', name: 'CosyVoice v3.0 Plus' },
    { id: 'cosyvoice-v2:longxiaochun', name: 'CosyVoice v2.0' },
  ],
  doubao: [
    { id: 'zh_female_shuangkuai', name: 'Volcano TTS - zh_female_shuangkuai' },
    { id: 'zh_male_chunhou', name: 'Volcano TTS - zh_male_chunhou' },
    { id: 'zh_female_cancan', name: 'Volcano TTS - zh_female_cancan' },
  ],
  fishaudio: [
    { id: 'fish-speech-1.5:preset-female', name: 'Fish Speech 1.5 - Female' },
    { id: 'fish-speech-1.5:preset-male', name: 'Fish Speech 1.5 - Male' },
  ],
  mimo: [
    { id: '冰糖', name: 'MiMo - 冰糖 (中文女声)' },
    { id: '茉莉', name: 'MiMo - 茉莉 (中文女声)' },
    { id: '苏打', name: 'MiMo - 苏打 (中文男声)' },
    { id: '白桦', name: 'MiMo - 白桦 (中文男声)' },
    { id: 'Mia', name: 'MiMo - Mia (英文女声)' },
    { id: 'Chloe', name: 'MiMo - Chloe (英文女声)' },
    { id: 'Milo', name: 'MiMo - Milo (英文男声)' },
    { id: 'Dean', name: 'MiMo - Dean (英文男声)' },
  ],
  browser: [
    { id: 'default', name: 'Web Speech API (Local Browser)' },
  ],
  'google-web': [
    { id: 'default', name: 'Google Translate TTS' },
  ],
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  languages,
}) => {
  const [activeTab, setActiveTab] = useState<'providers' | 'general' | 'tts' | 'shortcuts'>('providers');
  const [formData, setFormData] = useState<AppSettings>(settings);
  const [showKeyMap, setShowKeyMap] = useState<Record<string, boolean>>({});
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchMessage, setFetchMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [validating, setValidating] = useState(false);
  const [backupMessage, setBackupMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [validationResult, setValidationResult] = useState<{
    status: 'ok' | 'issues' | 'unverifiable' | 'error';
    source: 'live' | 'default';
    checkedModel: string;
    currentModelOk: boolean | null;
    error?: string;
  } | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [testingTts, setTestingTts] = useState(false);

  if (!isOpen) return null;

  const currentProvider = formData.defaultProvider || 'gemini';
  const currentConfig: ProviderConfig = formData.providerConfigs?.[currentProvider] || {
    apiKey: '',
    baseUrl: '',
    model: '',
    availableModels: [],
  };

  const toggleShowKey = (prov: string) => {
    setShowKeyMap((prev) => ({ ...prev, [prov]: !prev[prov] }));
  };

  const handleProviderChange = (newProvider: ProviderType) => {
    setFormData((prev) => ({
      ...prev,
      defaultProvider: newProvider,
    }));
    setFetchMessage(null);
  };

  const updateCurrentConfig = (updates: Partial<ProviderConfig>) => {
    setFormData((prev) => {
      const prevConfigs = prev.providerConfigs || {};
      const prevCurrentConfig = prevConfigs[currentProvider] || {
        apiKey: '',
        baseUrl: '',
        model: '',
        availableModels: [],
      };
      const updatedConfig = { ...prevCurrentConfig, ...updates };

      return {
        ...prev,
        providerConfigs: {
          ...prevConfigs,
          [currentProvider]: updatedConfig,
        },
      };
    });
  };

  const fetchModelsForProvider = async (): Promise<{ models: string[]; source: 'live' | 'default' }> => {
    if (isExtensionContext()) {
      // In the extension, fetch models through the background bridge.
      // Pass the form's (possibly unsaved) key along so it works before the
      // user hits Save; the background prefers it over the stored one.
      return bridgeModels({
        provider: currentProvider,
        baseUrl: currentConfig.baseUrl,
        apiKey: currentConfig.apiKey,
      });
    }
    const res = await fetch('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: currentProvider,
        apiKey: currentConfig.apiKey,
        baseUrl: currentConfig.baseUrl,
      }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  };

  const handleFetchModels = async () => {
    setFetchingModels(true);
    setFetchMessage(null);

    try {
      const { models } = await fetchModelsForProvider();

      if (models.length > 0) {
        updateCurrentConfig({
          availableModels: models,
          model: models.includes(currentConfig.model) ? currentConfig.model : models[0],
        });
        setFetchMessage({
          text: `成功获取 ${models.length} 个可用模型！`,
          type: 'success',
        });
      } else {
        setFetchMessage({
          text: currentConfig.apiKey
            ? '未返回模型，请检查 API Key / Base URL 是否正确。'
            : '未配置 API Key，无法获取模型列表。请先填写 Key 后重试。',
          type: 'error',
        });
      }
    } catch (err: any) {
      console.error('Fetch models error:', err);
      setFetchMessage({
        text: `获取失败: ${err.message || '请检查 API Key 或 Base URL'}`,
        type: 'error',
      });
    } finally {
      setFetchingModels(false);
    }
  };

  const handleValidateModels = async () => {
    setValidating(true);
    setValidationResult(null);

    try {
      const { models, source } = await fetchModelsForProvider();

      if (models.length > 0) {
        updateCurrentConfig({
          availableModels: models,
          model: models.includes(currentConfig.model) ? currentConfig.model : models[0],
        });
      }

      if (models.length === 0) {
        setValidationResult({
          status: 'unverifiable',
          source,
          checkedModel: currentConfig.model || '',
          currentModelOk: null,
        });
        return;
      }

      const live = new Set(models);
      const current = currentConfig.model || '';
      const currentModelOk = current ? live.has(current) : false;
      setValidationResult({
        status: currentModelOk ? 'ok' : 'issues',
        source,
        checkedModel: current,
        currentModelOk,
      });
    } catch (err: any) {
      console.error('Validate models error:', err);
      setValidationResult({
        status: 'error',
        source: 'live',
        checkedModel: currentConfig.model || '',
        currentModelOk: null,
        error: err?.message || '校验失败',
      });
    } finally {
      setValidating(false);
    }
  };

  const handleTestTts = () => {
    if (testingTts) {
      audioPlayer.stopAll();
      setTestingTts(false);
      return;
    }

    setTestingTts(true);
    audioPlayer.speak({
      text: "Hello! Welcome to FreeTranslate AI. 欢迎体验多引擎智能语音朗读。",
      lang: "zh-CN",
      engine: formData.ttsEngine,
      voice: formData.ttsVoice,
      rate: formData.ttsRate || 1.0,
      apiKey: formData.geminiApiKey,
      providerConfigs: formData.providerConfigs,
      onStart: () => setTestingTts(true),
      onEnd: () => setTestingTts(false),
    });
  };

  const handleSave = () => {
    onSaveSettings(formData);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 600);
  };

  const handleExportSettings = () => {
    try {
      exportSettingsToFile(formData);
      setBackupMessage({ text: '配置已导出（文件内含 API Key，请妥善保管）', type: 'success' });
    } catch (err: any) {
      setBackupMessage({ text: `导出失败: ${err?.message || '未知错误'}`, type: 'error' });
    }
  };

  const handleImportSettings = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    try {
      const imported = parseSettingsFile(await file.text());
      setFormData(imported);
      onSaveSettings(imported); // persist immediately (localStorage + chrome.storage mirror)
      setBackupMessage({ text: '配置已导入并立即生效', type: 'success' });
    } catch (err: any) {
      setBackupMessage({ text: `导入失败: ${err?.message || '文件格式不正确'}`, type: 'error' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-slate-800 animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-indigo-600" />
            <div>
              <h2 className="text-base font-bold text-slate-900">FreeTranslate 服务商与模型设置</h2>
              <p className="text-[11px] text-slate-500">接入 Google Gemini、DeepSeek、阿里云、豆包、Kimi、MiniMax 等多端 AI</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-100 bg-white px-6 gap-6 text-xs font-semibold">
          {[
            { id: 'providers', label: 'AI 服务商与模型', icon: Sparkles },
            { id: 'general', label: '通用设置', icon: Sliders },
            { id: 'tts', label: '语音朗读 (TTS)', icon: Globe },
            { id: 'shortcuts', label: '快捷键', icon: Server },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-3 flex items-center gap-1.5 transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? 'text-indigo-600 border-indigo-600 font-bold'
                    : 'text-slate-500 border-transparent hover:text-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-600 flex-1">
          {activeTab === 'providers' && (
            <div className="space-y-4 max-w-xl mx-auto py-1">
              {/* 1. Provider Select Dropdown */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1.5 flex items-center justify-between">
                  <span>选择 AI 服务商 (Service Provider)</span>
                  <span className="text-[11px] text-slate-400 font-normal">支持国内与国际主流大模型</span>
                </label>
                <select
                  value={currentProvider}
                  onChange={(e) => handleProviderChange(e.target.value as ProviderType)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 font-bold text-xs focus:outline-none focus:border-indigo-500 focus:bg-white shadow-2xs transition-all"
                >
                  {PROVIDERS_INFO.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. Form Fields for Selected Provider */}
              <div className="bg-slate-50/80 border border-slate-200/90 rounded-2xl p-4 space-y-4 shadow-2xs">
                <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-600" />
                    <h3 className="font-bold text-slate-900 text-xs">
                      {PROVIDERS_INFO.find((p) => p.id === currentProvider)?.name} 参数设置
                    </h3>
                  </div>
                  {currentProvider === 'gemini' && (
                    <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                      云端免 Key 预配置
                    </span>
                  )}
                </div>

                {/* API Base URL */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700">
                      API 请求地址 (Base URL)
                    </label>
                    <span className="text-[10px] text-slate-400 font-mono">OpenAI Compatible</span>
                  </div>
                  <input
                    type="text"
                    value={currentConfig.baseUrl || ''}
                    onChange={(e) => updateCurrentConfig({ baseUrl: e.target.value })}
                    placeholder="https://..."
                    disabled={currentProvider === 'gemini'}
                    className={`w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-indigo-500 font-mono text-xs shadow-2xs ${
                      currentProvider === 'gemini' ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white'
                    }`}
                  />
                </div>

                {/* API Key Input */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700">
                      API Key (密钥)
                    </label>
                    {currentProvider === 'gemini' && (
                      <span className="text-[10px] text-slate-400">留空则自动使用平台默认服务</span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showKeyMap[currentProvider] ? 'text' : 'password'}
                      value={currentConfig.apiKey || ''}
                      onChange={(e) => updateCurrentConfig({ apiKey: e.target.value })}
                      placeholder={currentProvider === 'gemini' ? 'Optional (选填)' : 'sk-...'}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-indigo-500 pr-10 font-mono text-xs shadow-2xs"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShowKey(currentProvider)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700"
                    >
                      {showKeyMap[currentProvider] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Model Selection & Auto Fetch */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700">
                      AI 模型 (API Model)
                    </label>

                    {/* Refresh / Fetch Button */}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleFetchModels}
                        disabled={fetchingModels}
                        className="px-2.5 py-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg flex items-center gap-1 transition-all disabled:opacity-50 cursor-pointer"
                      >
                        <RefreshCw className={`w-3 h-3 ${fetchingModels ? 'animate-spin' : ''}`} />
                        <span>{fetchingModels ? '拉取中...' : '自动获取可用模型'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleValidateModels}
                        disabled={validating}
                        className="px-2.5 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg flex items-center gap-1 transition-all disabled:opacity-50 cursor-pointer"
                      >
                        <Check className={`w-3 h-3 ${validating ? 'animate-pulse' : ''}`} />
                        <span>{validating ? '校验中...' : '校验模型可用性'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={currentConfig.model || ''}
                      onChange={(e) => updateCurrentConfig({ model: e.target.value })}
                      className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-indigo-500 font-semibold shadow-2xs text-xs"
                    >
                      {currentConfig.availableModels?.length ? (
                        currentConfig.availableModels.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))
                      ) : (
                        <option value={currentConfig.model || ''} disabled={!currentConfig.model}>
                          {currentConfig.model || '（请先获取或填写模型）'}
                        </option>
                      )}
                    </select>

                    <input
                      type="text"
                      value={currentConfig.model || ''}
                      onChange={(e) => updateCurrentConfig({ model: e.target.value })}
                      placeholder="自定义模型"
                      className="w-32 bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-indigo-500 font-mono text-xs shadow-2xs"
                      title="手动指定特定模型 ID"
                    />
                  </div>

                  {fetchMessage && (
                    <p
                      className={`mt-1.5 text-[11px] font-medium flex items-center gap-1 ${
                        fetchMessage.type === 'success' ? 'text-emerald-600' : 'text-amber-600'
                      }`}
                    >
                      <span>{fetchMessage.text}</span>
                    </p>
                  )}

                  {validationResult && (
                    <div
                      className={`mt-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${
                        validationResult.status === 'ok'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : validationResult.status === 'unverifiable'
                            ? 'border-slate-200 bg-slate-50 text-slate-500'
                            : 'border-amber-200 bg-amber-50 text-amber-700'
                      }`}
                    >
                      {validationResult.status === 'ok' && (
                        <p className="font-bold">✓ 当前模型可用（实时获取）</p>
                      )}
                      {validationResult.status === 'unverifiable' && (
                        <p>
                          {currentProvider === 'custom'
                            ? '模型接口不可用（未填 Key 或请求失败），无法实时校验。请检查接口配置后重试。'
                            : '未配置 API Key 或未获取到模型列表，无法实时校验。请先配置 Key 并获取模型。'}
                        </p>
                      )}
                      {validationResult.status === 'issues' && (
                        <p className="font-bold">
                          {validationResult.currentModelOk ? '✓' : '✗'} 当前模型 "
                          {validationResult.checkedModel}"{" "}
                          {validationResult.checkedModel
                            ? validationResult.currentModelOk
                              ? '存在'
                              : '不在实时列表中，请重新获取或选择'
                            : '尚未设置，请从列表中选择或手动填写'}
                        </p>
                      )}
                      {validationResult.status === 'error' && (
                        <p>校验失败: {validationResult.error || '请检查网络或 API Key'}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'general' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  默认目标翻译语言 (Default Target Language)
                </label>
                <select
                  value={formData.defaultTargetLang}
                  onChange={(e) => setFormData({ ...formData, defaultTargetLang: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-indigo-500 font-medium"
                >
                  {languages.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <div>
                  <p className="font-semibold text-slate-800">打字实时翻译 (Auto Translate on Type)</p>
                  <p className="text-[11px] text-slate-400">输入框停顿 500ms 后自动触发 AI 翻译</p>
                </div>
                <input
                  type="checkbox"
                  checked={formData.autoTranslate}
                  onChange={(e) => setFormData({ ...formData, autoTranslate: e.target.checked })}
                  className="w-4 h-4 accent-indigo-600 rounded"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  划词触发模式 (Word Selection Mode)
                </label>
                <select
                  value={formData.wordHoverMode || 'click'}
                  onChange={(e) => setFormData({ ...formData, wordHoverMode: e.target.value as any })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-indigo-500 font-medium"
                >
                  <option value="select">选中即翻译 (Select → Translate immediately)</option>
                  <option value="click">选中显示小图标，点击图标翻译 (Icon → Click)</option>
                  <option value="hover">选中显示小图标，悬停图标翻译 (Icon → Hover)</option>
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  控制网页上划词后是直接弹出翻译窗口，还是先显示一个迷你图标、再点击/悬停触发，减少打扰。
                </p>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <div>
                  <p className="font-semibold text-slate-800">输入框内选区翻译 (Selection inside Inputs)</p>
                  <p className="text-[11px] text-slate-400">允许在 input / textarea 内划词时也触发翻译弹窗</p>
                </div>
                <input
                  type="checkbox"
                  checked={formData.selectInputElementsText ?? false}
                  onChange={(e) => setFormData({ ...formData, selectInputElementsText: e.target.checked })}
                  className="w-4 h-4 accent-indigo-600 rounded"
                />
              </div>

              {/* Settings Backup / Restore */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mb-1">
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  配置备份 (Backup & Restore)
                </p>
                <p className="text-[11px] text-amber-600 mb-2 leading-relaxed">
                  导出的 JSON 包含全部 API Key，可在另一台设备/浏览器一键恢复；请勿分享给他人。
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExportSettings}
                    className="px-3 py-1.5 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    导出配置
                  </button>
                  <button
                    type="button"
                    onClick={() => importFileRef.current?.click()}
                    className="px-3 py-1.5 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    导入配置
                  </button>
                  <input
                    ref={importFileRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={handleImportSettings}
                  />
                </div>
                {backupMessage && (
                  <p
                    className={`mt-1.5 text-[11px] font-medium ${
                      backupMessage.type === 'success' ? 'text-emerald-600' : 'text-amber-600'
                    }`}
                  >
                    {backupMessage.text}
                  </p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'tts' && (
            <div className="space-y-4">
              {/* Architecture Explanation Card */}
              <div className="p-3 bg-indigo-50/80 border border-indigo-100 rounded-xl">
                <p className="text-xs font-bold text-indigo-950 flex items-center gap-1.5 mb-1">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                  秘钥共享与自由组合架构
                </p>
                <p className="text-[11px] text-indigo-800/90 leading-relaxed">
                  翻译与语音合成已实现<b>密钥统一共享与解耦</b>：在【模型服务商】中配置的 API Key 会自动同步至 TTS 引擎。您可以自由组合，如用 <b>DeepSeek / Gemini</b> 翻译文本，搭配 <b>阿里 CosyVoice / MiniMax 语音 / Edge 免 Key 神经网络</b> 进行朗读。
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  语音合成服务商 (TTS Engine Provider)
                </label>
                <select
                  value={formData.ttsEngine}
                  onChange={(e) => {
                    const newEngine = e.target.value as TTSEngine;
                    const defaultVoice = TTS_VOICES_BY_ENGINE[newEngine]?.[0]?.id || 'default';
                    setFormData({ ...formData, ttsEngine: newEngine, ttsVoice: defaultVoice });
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-indigo-500 font-medium"
                >
                  <option value="edge">Microsoft Edge Neural (免 Key 极速自然 - 推荐)</option>
                  <option value="gemini">Google Gemini Audio (24kHz 高保真 - 共享 Gemini Key)</option>
                  <option value="openai">OpenAI Audio Speech (TTS-1 / TTS-1-HD - 共享 OpenAI Key)</option>
                  <option value="minimax">MiniMax T2A (Speech-2.8 / Speech-02 - 共享 MiniMax Key)</option>
                  <option value="qwen">阿里云 DashScope (Qwen 3.0 TTS / CosyVoice v3.5 - 共享 DashScope Key)</option>
                  <option value="doubao">火山引擎 (豆包 TTS - 共享火山 Key)</option>
                  <option value="fishaudio">Fish Audio (Fish Speech 1.5 - 共享 Fish Key)</option>
                  <option value="mimo">小米 MiMo-V2.5 TTS (限时免费 - 共享 MiMo Key)</option>
                  <option value="browser">Web Speech API (浏览器本地)</option>
                  <option value="google-web">Google Translate TTS (免 Key 备用)</option>
                </select>
              </div>

              {/* Bound Provider Credentials Card */}
              {['openai', 'minimax', 'qwen', 'doubao', 'fishaudio', 'mimo', 'gemini'].includes(formData.ttsEngine) && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                      🔐 共享 API 密钥 (
                      {formData.ttsEngine === 'gemini' ? 'Google Gemini' :
                       formData.ttsEngine === 'openai' ? 'OpenAI' :
                       formData.ttsEngine === 'minimax' ? 'MiniMax' :
                       formData.ttsEngine === 'qwen' ? '阿里云 DashScope' :
                       formData.ttsEngine === 'doubao' ? '火山引擎/豆包' :
                       formData.ttsEngine === 'mimo' ? '小米 MiMo' : 'Fish Audio'}
                      )
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('providers')}
                      className="text-[11px] text-indigo-600 hover:underline font-medium"
                    >
                      修改服务商设置 &rarr;
                    </button>
                  </div>
                  <div>
                    <input
                      type="password"
                      placeholder={`输入或修改 ${
                        formData.ttsEngine === 'gemini' ? 'Gemini API Key' :
                        formData.ttsEngine === 'openai' ? 'OpenAI API Key' :
                        formData.ttsEngine === 'minimax' ? 'MiniMax API Key' :
                        formData.ttsEngine === 'qwen' ? 'DashScope API Key' :
                        formData.ttsEngine === 'doubao' ? '火山引擎/豆包 Key' :
                        formData.ttsEngine === 'mimo' ? '小米 MiMo Key' : 'Fish Audio API Key'
                      }`}
                      value={
                        formData.ttsEngine === 'gemini' ? formData.geminiApiKey :
                        (formData.providerConfigs[formData.ttsEngine as ProviderType]?.apiKey || '')
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        if (formData.ttsEngine === 'gemini') {
                          setFormData({ ...formData, geminiApiKey: val });
                        } else {
                          const pKey = formData.ttsEngine as ProviderType;
                          setFormData({
                            ...formData,
                            providerConfigs: {
                              ...formData.providerConfigs,
                              [pKey]: {
                                ...(formData.providerConfigs[pKey] || { apiKey: '', baseUrl: '', model: '', availableModels: [] }),
                                apiKey: val,
                              },
                            },
                          });
                        }
                      }}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 font-mono"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      提示：此处输入的密钥与【模型服务商】保持同步，无需重复配置。
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  发音人与音色 (Voice)
                </label>
                <select
                  value={formData.ttsVoice}
                  onChange={(e) => setFormData({ ...formData, ttsVoice: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-indigo-500 font-medium"
                >
                  {(TTS_VOICES_BY_ENGINE[formData.ttsEngine] || []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  朗读语速 (Speech Speed): {formData.ttsRate || 1.0}x
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={formData.ttsRate || 1.0}
                  onChange={(e) => setFormData({ ...formData, ttsRate: parseFloat(e.target.value) })}
                  className="w-full accent-indigo-600 cursor-pointer"
                />
              </div>

              {/* Test Audio Card */}
              <div className="p-3.5 bg-indigo-50/70 border border-indigo-100 rounded-xl flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                    <Volume2 className="w-4 h-4 text-indigo-600" />
                    发音效果试听 (Voice Test)
                  </div>
                  <div className="text-[11px] text-indigo-700/80 mt-0.5">
                    点击测试当前选择的朗读引擎与音色效果
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleTestTts}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    testingTts
                      ? 'bg-rose-500 text-white hover:bg-rose-600 shadow-xs animate-pulse'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs'
                  }`}
                >
                  {testingTts ? (
                    <>
                      <VolumeX className="w-3.5 h-3.5" />
                      停止播放
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-3.5 h-3.5" />
                      试听音色
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'shortcuts' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">Chrome 扩展模式常用快捷键:</p>
              <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span>唤起划词翻译弹窗（需先选中文本）</span>
                <kbd className="px-2 py-1 bg-white border border-slate-300 rounded text-[11px] font-mono text-slate-800 shadow-2xs whitespace-nowrap">
                  Alt + T
                </kbd>
              </div>
              <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span>立即翻译输入框内容</span>
                <kbd className="px-2 py-1 bg-white border border-slate-300 rounded text-[11px] font-mono text-slate-800 shadow-2xs whitespace-nowrap">
                  Ctrl / ⌘ + Enter
                </kbd>
              </div>
              <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span>关闭划词翻译弹窗</span>
                <kbd className="px-2 py-1 bg-white border border-slate-300 rounded text-[11px] font-mono text-slate-800 shadow-2xs">
                  Esc
                </kbd>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                提示：Alt+T 需在浏览器 <code className="font-mono text-indigo-600">chrome://extensions/shortcuts</code> 中确认已绑定；首次安装后请重新加载扩展以注册命令。
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">设置已自动加密保存于本地浏览器</span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200"
            >
              取消
            </button>
            <button
              id="save-settings-btn"
              onClick={handleSave}
              className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 flex items-center gap-1.5 shadow-sm transition-all"
            >
              {savedSuccess ? (
                <>
                  <Check className="w-4 h-4 text-emerald-300" />
                  <span>已保存！</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>保存设置</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

