import { TTSEngine } from '../types';
import { bridgeTts, isExtensionContext } from '../services/bridge';

// TTS engines that need a cloud API key (routed via background in the extension)
const CLOUD_TTS_ENGINES: TTSEngine[] = ['gemini', 'openai', 'minimax', 'qwen', 'doubao', 'fishaudio'];

class AudioPlayerService {
  private currentAudioCtx: AudioContext | null = null;
  private currentSourceNode: AudioBufferSourceNode | null = null;
  private currentAudioElement: HTMLAudioElement | null = null;
  private isPlaying: boolean = false;

  public stopAll() {
    // Stop Web Speech API
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    // Stop HTMLAudioElement
    if (this.currentAudioElement) {
      try {
        this.currentAudioElement.pause();
        this.currentAudioElement.currentTime = 0;
      } catch (e) {
        // ignore
      }
      this.currentAudioElement = null;
    }

    // Stop AudioContext PCM node
    if (this.currentSourceNode) {
      try {
        this.currentSourceNode.stop();
        this.currentSourceNode.disconnect();
      } catch (e) {
        // ignore
      }
      this.currentSourceNode = null;
    }

    if (this.currentAudioCtx) {
      try {
        this.currentAudioCtx.close();
      } catch (e) {
        // ignore
      }
      this.currentAudioCtx = null;
    }

    this.isPlaying = false;
  }

  /**
   * Play speech using Browser Native Web Speech API
   */
  public playBrowserSpeech(text: string, lang: string = 'en', rate: number = 1.0, onEnd?: () => void, onError?: () => void): boolean {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return false;
    }

    this.stopAll();

    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = Math.max(0.5, Math.min(2.0, rate));
      utterance.lang = lang;

      // Select matching voice if available
      const voices = window.speechSynthesis.getVoices();
      const matchingVoice = voices.find(v => v.lang.toLowerCase().startsWith(lang.toLowerCase().slice(0, 2)));
      if (matchingVoice) {
        utterance.voice = matchingVoice;
      }

      utterance.onend = () => {
        this.isPlaying = false;
        onEnd?.();
      };

      utterance.onerror = (err) => {
        console.warn('Speech synthesis error:', err);
        this.isPlaying = false;
        onError?.();
      };

      this.isPlaying = true;
      window.speechSynthesis.speak(utterance);
      return true;
    } catch (err) {
      console.error('Failed to trigger browser speech:', err);
      return false;
    }
  }

  /**
   * Decode base64 16-bit PCM Audio data at 24kHz from Gemini TTS API
   */
  public async playPcmBase64(base64Data: string, sampleRate: number = 24000, onEnd?: () => void): Promise<void> {
    this.stopAll();

    try {
      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // 16-bit PCM little endian
      const pcm16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0;
      }

      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.currentAudioCtx = new AudioCtxClass({ sampleRate });

      const buffer = this.currentAudioCtx.createBuffer(1, float32.length, sampleRate);
      buffer.getChannelData(0).set(float32);

      const source = this.currentAudioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.currentAudioCtx.destination);

      source.onended = () => {
        this.isPlaying = false;
        onEnd?.();
      };

      this.currentSourceNode = source;
      this.isPlaying = true;
      source.start(0);
    } catch (err) {
      console.error('Failed to decode/play PCM audio:', err);
      this.isPlaying = false;
      throw err;
    }
  }

  /**
   * Play general audio data (PCM or MP3/WAV Data URLs)
   */
  public async playAudioData({
    audioBase64,
    mimeType = 'audio/mp3',
    sampleRate = 24000,
    onEnd,
  }: {
    audioBase64: string;
    mimeType?: string;
    sampleRate?: number;
    onEnd?: () => void;
  }): Promise<void> {
    if (mimeType.includes('pcm')) {
      await this.playPcmBase64(audioBase64, sampleRate, onEnd);
      return;
    }

    this.stopAll();

    try {
      const dataUrl = audioBase64.startsWith('data:')
        ? audioBase64
        : `data:${mimeType};base64,${audioBase64}`;
      const audio = new Audio(dataUrl);
      this.currentAudioElement = audio;
      audio.onended = () => {
        this.isPlaying = false;
        this.currentAudioElement = null;
        onEnd?.();
      };
      audio.onerror = (err) => {
        console.error('Audio element error:', err);
        this.isPlaying = false;
        this.currentAudioElement = null;
        onEnd?.();
      };
      this.isPlaying = true;
      await audio.play();
    } catch (err) {
      console.error('Failed to play audio base64 data url:', err);
      this.isPlaying = false;
      this.currentAudioElement = null;
      throw err;
    }
  }

  /**
   * Smart play with fallback chain
   */
  public async speak({
    text,
    lang = 'en',
    engine = 'gemini',
    voice = 'Kore',
    rate = 1.0,
    apiKey,
    baseUrl,
    providerConfigs,
    onStart,
    onEnd,
  }: {
    text: string;
    lang?: string;
    engine?: TTSEngine;
    voice?: string;
    rate?: number;
    apiKey?: string;
    baseUrl?: string;
    providerConfigs?: any;
    onStart?: () => void;
    onEnd?: () => void;
  }): Promise<void> {
    onStart?.();

    if (engine === 'browser') {
      const success = this.playBrowserSpeech(text, lang, rate, onEnd, () => {
        this.playGoogleTtsUrl(text, lang, onEnd);
      });
      if (!success) {
        this.playGoogleTtsUrl(text, lang, onEnd);
      }
      return;
    }

    if (engine === 'google-web') {
      this.playGoogleTtsUrl(text, lang, onEnd);
      return;
    }

    // Cloud TTS engines. In the extension this is relayed through the
    // background bridge (no API key in page context); in the web app it goes
    // through the server's /api/tts endpoint.
    try {
      let data: { audioBase64?: string; mimeType?: string; sampleRate?: number } | null = null;

      if (CLOUD_TTS_ENGINES.includes(engine)) {
        if (isExtensionContext()) {
          data = await bridgeTts({ text, lang, engine, voice, rate });
        } else {
          const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text,
              lang,
              engine,
              voice,
              rate,
              apiKey,
              baseUrl,
              providerConfigs,
            }),
          });
          if (res.ok) {
            data = await res.json();
          } else {
            const errData = await res.json().catch(() => ({}));
            console.warn(`Server TTS API returned error (${res.status}):`, errData.error || res.statusText);
          }
        }
      } else {
        // Edge / legacy engines still try the server endpoint in the web app.
        if (!isExtensionContext()) {
          const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text,
              lang,
              engine,
              voice,
              rate,
              apiKey,
              baseUrl,
              providerConfigs,
            }),
          });
          if (res.ok) data = await res.json();
        }
      }

      if (data?.audioBase64) {
        await this.playAudioData({
          audioBase64: data.audioBase64,
          mimeType: data.mimeType || 'audio/mp3',
          sampleRate: data.sampleRate || 24000,
          onEnd,
        });
        return;
      }
    } catch (err) {
      console.warn(`TTS engine ${engine} request failed, falling back to Web Speech API:`, err);
    }

    // Fallback: Browser Web Speech API -> Google Web TTS
    const success = this.playBrowserSpeech(text, lang, rate, onEnd, () => {
      this.playGoogleTtsUrl(text, lang, onEnd);
    });

    if (!success) {
      this.playGoogleTtsUrl(text, lang, onEnd);
    }
  }

  private playGoogleTtsUrl(text: string, lang: string, onEnd?: () => void) {
    try {
      this.stopAll();
      const cleanLang = lang.split('-')[0] || 'en';
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.slice(0, 200))}&tl=${cleanLang}&client=tw-ob`;
      const audio = new Audio(url);
      this.currentAudioElement = audio;
      audio.onended = () => {
        this.isPlaying = false;
        this.currentAudioElement = null;
        onEnd?.();
      };
      audio.onerror = () => {
        this.isPlaying = false;
        this.currentAudioElement = null;
        onEnd?.();
      };
      this.isPlaying = true;
      audio.play();
    } catch (e) {
      this.isPlaying = false;
      this.currentAudioElement = null;
      onEnd?.();
    }
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }
}

export const audioPlayer = new AudioPlayerService();
