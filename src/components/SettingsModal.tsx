import React, { useState, useRef, useEffect } from 'react';
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
  Keyboard,
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

/** Sample sentence per language, used for the TTS preview so users hear the
 * voice in the language they actually translate into (falls back to English). */
const TTS_SAMPLE_BY_LANG: Record<string, { text: string; lang: string }> = {
  'zh-CN': { text: '欢迎使用智能翻译，多引擎语音朗读，让学习更轻松。', lang: 'zh-CN' },
  'zh-TW': { text: '歡迎使用智慧翻譯，多引擎語音朗讀，讓學習更輕鬆。', lang: 'zh-TW' },
  en: { text: 'Welcome to AI Translate. Multi-engine speech, making learning easier.', lang: 'en-US' },
  ja: { text: 'ようこそ、AI翻訳へ。マルチエンジンの音声で、学習をもっと楽に。', lang: 'ja-JP' },
  ko: { text: 'AI 번역에 오신 것을 환영합니다. 여러 엔진의 음성으로 학습을 더 쉽게.', lang: 'ko-KR' },
  es: { text: 'Bienvenido a AI Translate. Voz multilingüe para aprender más fácil.', lang: 'es-ES' },
  fr: { text: 'Bienvenue sur AI Translate. La voix multilingue pour apprendre plus facilement.', lang: 'fr-FR' },
  de: { text: 'Willkommen bei AI Translate. Mehrsprachige Stimme für leichteres Lernen.', lang: 'de-DE' },
  ru: { text: 'Добро пожаловать в AI Translate. Многоголосый синтез для лёгкого обучения.', lang: 'ru-RU' },
  it: { text: 'Benvenuto su AI Translate. Voce multilingue per imparare più facilmente.', lang: 'it-IT' },
  pt: { text: 'Bem-vindo ao AI Translate. Voz multilíngue para aprender mais fácil.', lang: 'pt-PT' },
  ar: { text: 'مرحباً بك في AI Translate. صوت متعدد اللغات لتعلّم أسهل.', lang: 'ar-SA' },
  hi: { text: 'AI अनुवाद में आपका स्वागत है। आसान सीखने के लिए बहु-भाषा आवाज़।', lang: 'hi-IN' },
  vi: { text: 'Chào mừng đến với AI Translate. Giọng đọc đa ngôn ngữ giúp việc học dễ dàng hơn.', lang: 'vi-VN' },
  th: { text: 'ยินดีต้อนรับสู่ AI Translate เสียงหลายภาษาเพื่อการเรียนรู้ที่ง่ายขึ้น', lang: 'th-TH' },
};

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
  { id: 'glm', name: '智谱 GLM（glm-4.7-flash / glm-4-flash 免费）' },
  { id: 'cerebras', name: 'Cerebras（免费额度，1M tokens/天）' },
  { id: 'ollama', name: 'Ollama 本地模型 (如 deepseek-r1, qwen2.5 等)' },
  { id: 'custom', name: '自定义 API / 本地服务' },
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
  const [isCustomModelMode, setIsCustomModelMode] = useState(false);

  // In the extension the background bridge resolves API keys from
  // chrome.storage.local, so persist the form as the user types (debounced) —
  // otherwise a freshly typed key works for fetching models but translation
  // still fails until the explicit Save button is pressed.
  useEffect(() => {
    if (!isOpen || !isExtensionContext()) return;
    const t = setTimeout(() => {
      onSaveSettings(formData);
    }, 400);
    return () => clearTimeout(t);
  }, [formData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-sync the form whenever the modal opens, so settings changed elsewhere
  // (import, another tab, an earlier save) show up instead of stale values —
  // and can't be written back over newer settings by the debounce above.
  useEffect(() => {
    if (isOpen) {
      setFormData(settings);
      setFetchMessage(null);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

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
          text: (currentProvider === 'ollama' || currentProvider === 'custom')
            ? '未获取到模型。请确保本地 Ollama / 本地模型服务已启动（默认 http://localhost:11434）且已通过 `ollama pull ...` 下载模型。'
            : currentConfig.apiKey
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

    // Preview in the target language the user actually translates into, so the
    // voice and pronunciation match what they'll hear in real use.
    const sample = TTS_SAMPLE_BY_LANG[formData.defaultTargetLang] || TTS_SAMPLE_BY_LANG.en;
    setTestingTts(true);
    audioPlayer.speak({
      text: sample.text,
      lang: sample.lang,
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
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-indigo-600 shrink-0" />
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900 leading-tight">AI 服务商与模型设置</h2>
              <p className="text-[11px] text-slate-500">配置 AI 翻译引擎、API Key 与模型参数</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs (Strictly Single Line) */}
        <div className="flex border-b border-slate-100 bg-white px-5 gap-4 sm:gap-6 text-xs font-semibold overflow-x-auto no-scrollbar">
          {[
            { id: 'providers', label: 'AI 服务商', icon: Sparkles },
            { id: 'general', label: '通用设置', icon: Sliders },
            { id: 'tts', label: '语音朗读', icon: Volume2 },
            { id: 'shortcuts', label: '快捷键', icon: Keyboard },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-2.5 flex items-center gap-1.5 transition-colors border-b-2 whitespace-nowrap shrink-0 cursor-pointer ${
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
        <div className="p-5 overflow-y-auto space-y-4 text-xs text-slate-600 flex-1">
          {activeTab === 'providers' && (
            <div className="space-y-3.5 max-w-xl mx-auto py-1">
              {/* 1. Provider Select Dropdown */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  选择 AI 服务商
                </label>
                <select
                  value={currentProvider}
                  onChange={(e) => handleProviderChange(e.target.value as ProviderType)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-bold text-xs focus:outline-none focus:border-indigo-500 focus:bg-white shadow-2xs transition-all cursor-pointer"
                >
                  {PROVIDERS_INFO.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. Form Fields for Selected Provider */}
              <div className="bg-slate-50/80 border border-slate-200/90 rounded-2xl p-3.5 space-y-3.5 shadow-2xs">
                <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                    <h3 className="font-bold text-slate-900 text-xs">
                      {PROVIDERS_INFO.find((p) => p.id === currentProvider)?.name} 配置
                    </h3>
                  </div>
                  {currentProvider === 'gemini' && (
                    <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                      云端免 Key
                    </span>
                  )}
                  {(currentProvider === 'ollama' || currentProvider === 'custom') && (
                    <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                      本地免 Key
                    </span>
                  )}
                </div>

                {/* API Base URL */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700">
                      API Base URL
                    </label>
                    {currentProvider === 'ollama' && currentConfig.baseUrl !== 'http://localhost:11434/v1' && (
                      <button
                        type="button"
                        onClick={() => updateCurrentConfig({ baseUrl: 'http://localhost:11434/v1' })}
                        className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold underline cursor-pointer"
                      >
                        重置为默认 (http://localhost:11434/v1)
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    name="ft_api_base_url"
                    autoComplete="off"
                    data-lpignore="true"
                    data-form-type="other"
                    value={currentConfig.baseUrl || ''}
                    onChange={(e) => updateCurrentConfig({ baseUrl: e.target.value })}
                    placeholder={currentProvider === 'ollama' ? 'http://localhost:11434/v1' : 'https://...'}
                    disabled={currentProvider === 'gemini'}
                    className={`w-full border border-slate-200 rounded-xl px-3 py-1.5 text-slate-800 focus:outline-none focus:border-indigo-500 font-mono text-xs shadow-2xs ${
                      currentProvider === 'gemini' ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white'
                    }`}
                  />
                  {currentConfig.baseUrl?.includes('@') && (
                    <p className="mt-1 text-[11px] text-rose-500 font-medium flex items-center gap-1">
                      <span>⚠️ 检测到 Base URL 为邮箱地址（可能是浏览器自动填充），请点击上方重置为 http://localhost:11434/v1</span>
                    </p>
                  )}
                </div>

                {/* API Key Input */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700">
                      API Key
                    </label>
                    {currentProvider === 'ollama' && currentConfig.apiKey && (
                      <button
                        type="button"
                        onClick={() => updateCurrentConfig({ apiKey: '' })}
                        className="text-[10px] text-slate-500 hover:text-slate-700 font-semibold underline cursor-pointer"
                      >
                        清空 Key (本地无需 Key)
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showKeyMap[currentProvider] ? 'text' : 'password'}
                      name="ft_api_key_secret"
                      autoComplete="new-password"
                      data-lpignore="true"
                      data-form-type="other"
                      value={currentConfig.apiKey || ''}
                      onChange={(e) => updateCurrentConfig({ apiKey: e.target.value })}
                      placeholder={
                        currentProvider === 'gemini'
                          ? 'Optional (选填)'
                          : currentProvider === 'ollama' || currentProvider === 'custom'
                          ? '本地模型无需 API Key（留空即可）'
                          : 'sk-...'
                      }
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-slate-800 focus:outline-none focus:border-indigo-500 pr-10 font-mono text-xs shadow-2xs"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShowKey(currentProvider)}
                      className="absolute right-3 top-2 text-slate-400 hover:text-slate-700"
                    >
                      {showKeyMap[currentProvider] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Model Selection & Auto Fetch */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700">
                      AI 模型
                    </label>

                    {/* Refresh / Fetch Button */}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleFetchModels}
                        disabled={fetchingModels}
                        className="px-2 py-0.5 text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg flex items-center gap-1 transition-all disabled:opacity-50 cursor-pointer whitespace-nowrap"
                      >
                        <RefreshCw className={`w-3 h-3 ${fetchingModels ? 'animate-spin' : ''}`} />
                        <span>{fetchingModels ? '获取中...' : '自动获取'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleValidateModels}
                        disabled={validating}
                        className="px-2 py-0.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg flex items-center gap-1 transition-all disabled:opacity-50 cursor-pointer whitespace-nowrap"
                      >
                        <Check className={`w-3 h-3 ${validating ? 'animate-pulse' : ''}`} />
                        <span>{validating ? '校验中...' : '校验可用性'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Single Clean Full-width Model Selector */}
                  {isCustomModelMode ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={currentConfig.model || ''}
                        onChange={(e) => updateCurrentConfig({ model: e.target.value })}
                        placeholder="输入自定义模型 ID (如 gpt-4o, qwen-max)..."
                        className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-slate-800 focus:outline-none focus:border-indigo-500 font-mono text-xs shadow-2xs"
                      />
                      <button
                        type="button"
                        onClick={() => setIsCustomModelMode(false)}
                        className="px-2.5 py-1.5 text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl border border-slate-200 cursor-pointer whitespace-nowrap"
                      >
                        从列表选择
                      </button>
                    </div>
                  ) : (
                    <select
                      value={currentConfig.model || ''}
                      onChange={(e) => {
                        if (e.target.value === '__custom__') {
                          setIsCustomModelMode(true);
                        } else {
                          updateCurrentConfig({ model: e.target.value });
                        }
                      }}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-slate-800 focus:outline-none focus:border-indigo-500 font-semibold shadow-2xs text-xs cursor-pointer"
                    >
                      {Array.from(new Set([...(currentConfig.availableModels || []), currentConfig.model].filter(Boolean))).map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                      <option value="__custom__">+ 手动输入自定义模型 ID...</option>
                    </select>
                  )}

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
                          {currentProvider === 'ollama' || currentProvider === 'custom'
                            ? '模型接口不可用（服务未启动或未获取到模型），无法实时校验。请检查本地 Ollama 服务或接口配置后重试。'
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
                  默认目标语言
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
                  <p className="font-semibold text-slate-800">打字实时翻译</p>
                  <p className="text-[11px] text-slate-400">输入停顿 500ms 后自动翻译</p>
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
                  划词触发方式
                </label>
                <select
                  value={formData.wordHoverMode || 'click'}
                  onChange={(e) => setFormData({ ...formData, wordHoverMode: e.target.value as any })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-indigo-500 font-medium"
                >
                  <option value="click">显示小图标，点击翻译（推荐）</option>
                  <option value="hover">显示小图标，悬停翻译</option>
                  <option value="select">选中即翻译（直接弹出卡片）</option>
                  <option value="off">关闭划词图标（仅通过右键菜单或 Alt+T 翻译）</option>
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  划词后显示小图标、直接翻译或完全关闭浮标（避免选词干扰）。
                </p>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <div>
                  <p className="font-semibold text-slate-800">输入框内划词翻译</p>
                  <p className="text-[11px] text-slate-400">允许在输入框内划词翻译</p>
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
                  配置备份与恢复
                </p>
                <p className="text-[11px] text-amber-600 mb-2 leading-relaxed">
                  导出文件含全部 API Key，可导入恢复，请勿外传。
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
                  密钥共享，自由组合
                </p>
                <p className="text-[11px] text-indigo-800/90 leading-relaxed">
                  API Key 与【模型服务商】同步，可自由组合，如用 <b>Gemini</b> 翻译、<b>Edge</b> 免 Key 朗读。
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  语音合成引擎
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
                  <option value="edge">Microsoft Edge Neural（免 Key · 推荐）</option>
                  <option value="gemini">Google Gemini Audio（共享 Gemini Key）</option>
                  <option value="openai">OpenAI Audio Speech（共享 OpenAI Key）</option>
                  <option value="minimax">MiniMax T2A（共享 MiniMax Key）</option>
                  <option value="qwen">阿里云 DashScope（Qwen / CosyVoice）</option>
                  <option value="doubao">火山引擎（豆包 TTS）</option>
                  <option value="fishaudio">Fish Audio（Fish Speech 1.5）</option>
                  <option value="mimo">小米 MiMo（限时免费）</option>
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
                      与【模型服务商】同步，无需重复填写。
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  发音人 / 音色
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={formData.ttsVoice}
                    onChange={(e) => setFormData({ ...formData, ttsVoice: e.target.value })}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-indigo-500 font-medium"
                  >
                    {(TTS_VOICES_BY_ENGINE[formData.ttsEngine] || []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleTestTts}
                    title="试听当前音色"
                    className={`shrink-0 px-2.5 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                      testingTts
                        ? 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100'
                        : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                    }`}
                  >
                    {testingTts ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    <span className="hidden sm:inline">{testingTts ? '停止' : '试听'}</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  朗读语速: {formData.ttsRate || 1.0}x
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
                    试听音色
                  </div>
                  <div className="text-[11px] text-indigo-700/80 mt-0.5">
                    试听当前引擎与音色的朗读效果（按目标语言发音）
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
              <p className="text-xs font-bold text-slate-700">常用快捷键（Chrome 扩展模式）</p>
              <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span>唤起划词翻译（需先选中文本）</span>
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
                <span>关闭翻译弹窗</span>
                <kbd className="px-2 py-1 bg-white border border-slate-300 rounded text-[11px] font-mono text-slate-800 shadow-2xs">
                  Esc
                </kbd>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Alt+T 需在 <code className="font-mono text-indigo-600">chrome://extensions/shortcuts</code> 中绑定；首次安装后请重新加载扩展。
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">自动加密存至本地</span>
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

