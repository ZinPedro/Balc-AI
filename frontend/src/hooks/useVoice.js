import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hook de Voz nativo do navegador (Web Speech API)
 * - Botão gigante "Toque para Falar" (Toggle / Push-to-Talk)
 * - Trava anti-eco: cancela fala antes de ouvir e bloqueia microfone durante TTS
 */
export function useVoice({ onTranscript }) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const recognitionRef = useRef(null);

  const SpeechRecognition =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null;

  const isSupported = Boolean(SpeechRecognition);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  }, []);

  const speak = useCallback((text) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;

    // Trava anti-eco: para o microfone se estiver ouvindo antes de falar
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignora erro ao abortar
      }
      setIsListening(false);
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.rate = 0.96;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  }, []);

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

  const toggleListening = useCallback(() => {
    setVoiceError('');

    if (!SpeechRecognition) {
      setVoiceError('Reconhecimento de voz disponível no Google Chrome ou Edge.');
      return;
    }

    if (isListening) {
      stopListening();
      return;
    }

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
      if (transcript && onTranscript) {
        onTranscript(transcript);
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
    recognition.start();
  }, [SpeechRecognition, isListening, onTranscript, stopListening, stopSpeaking]);

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
    voiceError,
    speak,
    stopSpeaking,
    toggleListening,
    stopListening,
  };
}
