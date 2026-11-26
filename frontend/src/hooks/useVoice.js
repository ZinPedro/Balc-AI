import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Limpa emojis, markdown e símbolos que fazem o sintetizador soletrar ou pausar errado.
 */
function sanitizeTextForSpeech(text) {
  return String(text || '')
    .replace(/[*_`#~>|]/g, ' ')
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Escolhe a voz pt-BR mais natural disponível no navegador, evitando vozes robóticas (ex: eSpeak).
 */
function selectBestPtBrVoice(voices) {
  if (!voices || voices.length === 0) return null;

  const ptBrVoices = voices.filter((v) => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith('pt-br'));
  const ptVoices = ptBrVoices.length > 0 ? ptBrVoices : voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('pt'));

  if (ptVoices.length === 0) return null;

  const preferredKeywords = ['natural', 'neural', 'google', 'francisca', 'antonio', 'thalita', 'luciana', 'maria', 'online'];
  for (const kw of preferredKeywords) {
    const match = ptVoices.find((v) => v.name.toLowerCase().includes(kw));
    if (match) return match;
  }

  return ptVoices.find((v) => !v.localService) || ptVoices[0];
}

const BALC_API_URL = import.meta.env.VITE_BALC_API_URL || 'http://localhost:8001';

/**
 * Hook de Voz:
 * - TTS neural via backend (/balc/tts com edge-tts) e fallback para Web Speech API
 * - Botão "Toque para Falar" (Toggle / Push-to-Talk)
 * - Trava anti-eco: cancela fala antes de ouvir e bloqueia microfone durante TTS
 */
export function useVoice({ onTranscript, voice = 'pt-BR-FranciscaNeural' }) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingId, setSpeakingId] = useState(null);
  const [voiceError, setVoiceError] = useState('');

  const recognitionRef = useRef(null);
  const bestVoiceRef = useRef(null);
  const audioRef = useRef(null);
  const onTranscriptRef = useRef(onTranscript);
  const speakSessionRef = useRef(0);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const SpeechRecognition =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null;

  const isSupported = Boolean(SpeechRecognition);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      bestVoiceRef.current = selectBestPtBrVoice(voices);
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const clearVoiceError = useCallback(() => {
    setVoiceError('');
  }, []);

  const stopSpeaking = useCallback(() => {
    speakSessionRef.current += 1;

    if (audioRef.current) {
      const audio = audioRef.current;
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      try {
        audio.load();
      } catch {
        // ignora erro ao resetar elemento de áudio
      }
      audioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setSpeakingId(null);
  }, []);

  const speakWithBrowserFallback = useCallback((cleanText, messageId, onEnded, sessionId) => {
    if (sessionId !== speakSessionRef.current) return;

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setIsSpeaking(false);
      setSpeakingId(null);
      if (onEnded) onEnded();
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'pt-BR';
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    const selectedVoice =
      bestVoiceRef.current || selectBestPtBrVoice(window.speechSynthesis.getVoices());
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    utterance.onstart = () => {
      if (sessionId !== speakSessionRef.current) return;
      setIsSpeaking(true);
      setSpeakingId(messageId);
    };
    utterance.onend = () => {
      if (sessionId !== speakSessionRef.current) return;
      setIsSpeaking(false);
      setSpeakingId(null);
      if (onEnded) onEnded();
    };
    utterance.onerror = () => {
      if (sessionId !== speakSessionRef.current) return;
      setIsSpeaking(false);
      setSpeakingId(null);
      if (onEnded) onEnded();
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  const speak = useCallback(
    async (text, messageId = null, onEnded = null) => {
      if (typeof window === 'undefined' || !text) return;

      const cleanText = sanitizeTextForSpeech(text);
      if (!cleanText) {
        if (onEnded) onEnded();
        return;
      }

      // Trava anti-eco: para o microfone se estiver ouvindo antes de falar
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignora erro ao abortar
        }
        setIsListening(false);
      }

      stopSpeaking();
      const sessionId = speakSessionRef.current;
      let fallbackTriggered = false;

      const triggerFallback = () => {
        if (fallbackTriggered || sessionId !== speakSessionRef.current) return;
        fallbackTriggered = true;
        if (audioRef.current) {
          audioRef.current.onended = null;
          audioRef.current.onerror = null;
          audioRef.current.pause();
          audioRef.current.removeAttribute('src');
          audioRef.current = null;
        }
        speakWithBrowserFallback(cleanText, messageId, onEnded, sessionId);
      };

      try {
        setIsSpeaking(true);
        setSpeakingId(messageId);

        const ttsText = cleanText.slice(0, 600);
        const params = new URLSearchParams({ text: ttsText, voice });
        const streamUrl = `${BALC_API_URL}/balc/tts?${params.toString()}`;
        const audio = new Audio(streamUrl);
        audioRef.current = audio;

        audio.onended = () => {
          if (sessionId !== speakSessionRef.current) return;
          stopSpeaking();
          if (onEnded) onEnded();
        };
        audio.onerror = () => {
          triggerFallback();
        };

        await audio.play();
      } catch (err) {
        if (sessionId !== speakSessionRef.current) return;
        if (err.name === 'AbortError') return;
        if (err.name === 'NotAllowedError') {
          stopSpeaking();
          return;
        }
        triggerFallback();
      }
    },
    [speakWithBrowserFallback, stopSpeaking, voice]
  );

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignora
      }
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    setVoiceError('');

    if (!SpeechRecognition) {
      setVoiceError('Reconhecimento de voz disponível no Google Chrome ou Edge.');
      return;
    }

    if (isListening) return;

    // Trava anti-eco: silencia o BALC antes de abrir o microfone
    stopSpeaking();

    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      setIsListening(false);
      if (transcript && onTranscriptRef.current) {
        onTranscriptRef.current(transcript);
      }
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      if (event.error === 'not-allowed') {
        setVoiceError('Permita o uso do microfone no navegador para falar com o BALC.');
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setVoiceError('Não consegui ouvir direito. Tente falar novamente ou toque em um botão.');
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // ignora se já estiver iniciando
    }
  }, [SpeechRecognition, isListening, stopSpeaking]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
      return;
    }
    startListening();
  }, [isListening, startListening, stopListening]);

  useEffect(() => {
    return () => {
      stopSpeaking();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignora
        }
      }
    };
  }, [stopSpeaking]);

  return {
    isSupported,
    isListening,
    isSpeaking,
    speakingId,
    voiceError,
    clearVoiceError,
    speak,
    stopSpeaking,
    toggleListening,
    startListening,
    stopListening,
  };
}
