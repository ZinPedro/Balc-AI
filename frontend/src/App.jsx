import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CatalogViewer } from './components/CatalogViewer';
import {
  CheckIcon,
  CloseIcon,
  MicIcon,
  MoonIcon,
  PhoneIcon,
  PhoneOffIcon,
  SendIcon,
  StopIcon,
  SunIcon,
  VolumeIcon,
  VolumeOffIcon,
} from './components/Icons';
import { VaultInput } from './components/VaultInput';
import { useVoice } from './hooks/useVoice';

const BALC_API_URL = import.meta.env.VITE_BALC_API_URL || 'http://localhost:8001';

function createMsgId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function App() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const siteId = params.get('site') || 'balc_livre';
  const isEmbedded = params.get('embedded') === '1';

  const [theme, setTheme] = useState('light');
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [isCallActive, setIsCallActive] = useState(false);
  const [voice, setVoice] = useState('pt-BR-FranciscaNeural');
  const [siteConfig, setSiteConfig] = useState(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [error, setError] = useState('');

  // Estado da conversa em formato de chat
  const [mensagens, setMensagens] = useState([]);
  const [modoEntrada, setModoEntrada] = useState('normal'); // 'normal' | 'senha_cofre' | 'confirmacao'
  const [opcoes, setOpcoes] = useState([]);
  const [acaoAtual, setAcaoAtual] = useState(null);
  const [dadosColetados, setDadosColetados] = useState({});
  const [identificadorLogin, setIdentificadorLogin] = useState('');
  const [historico, setHistorico] = useState([]);

  // Autenticação isolada (token retornado diretamente do site cliente no Modo Cofre)
  const [tokenUsuario, setTokenUsuario] = useState(null);

  // Catálogo 1 item por tela
  const [itensCatalogo, setItensCatalogo] = useState([]);
  const [mostrarCatalogo, setMostrarCatalogo] = useState(false);

  // Entrada de texto
  const [textoInput, setTextoInput] = useState('');
  const [enviando, setEnviando] = useState(false);

  const chatEndRef = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensagens, enviando]);

  const sendMessage = useCallback(
    async (texto, overrideState = {}) => {
      const clean = (texto || '').trim();
      if (!clean || enviando) return;

      setEnviando(true);
      setError('');
      setTextoInput('');

      const userMsg = { id: createMsgId('user'), role: 'user', text: clean };
      setMensagens((prev) => [...prev, userMsg]);

      const nextHistory = [...historico, { role: 'user', text: clean }].slice(-8);

      try {
        const resp = await fetch(`${BALC_API_URL}/balc/conversar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            site_id: siteId,
            texto_usuario: clean,
            acao_atual: overrideState.acaoAtual !== undefined ? overrideState.acaoAtual : acaoAtual,
            dados_coletados:
              overrideState.dadosColetados !== undefined ? overrideState.dadosColetados : dadosColetados,
            historico: nextHistory,
            usuario_autenticado:
              overrideState.usuarioAutenticado !== undefined
                ? overrideState.usuarioAutenticado
                : Boolean(tokenUsuario),
            token_usuario:
              overrideState.tokenUsuario !== undefined ? overrideState.tokenUsuario : tokenUsuario,
            modo_entrada_anterior:
              overrideState.modoEntradaAnterior !== undefined
                ? overrideState.modoEntradaAnterior
                : modoEntrada,
          }),
        });

        if (!resp.ok) {
          const detail = await resp.text();
          throw new Error(detail || 'Falha ao conversar com o servidor do BALC.');
        }

        const data = await resp.json();
        const assistantMsg = {
          id: createMsgId('assistant'),
          role: 'assistant',
          text: data.mensagem_balconista,
        };

        setMensagens((prev) => [...prev, assistantMsg]);
        setModoEntrada(data.modo_entrada || 'normal');
        setOpcoes(data.opcoes_botoes || []);
        setAcaoAtual(data.acao_atual || null);
        setDadosColetados(data.dados_coletados || {});
        if (data.identificador_login) {
          setIdentificadorLogin(data.identificador_login);
        }

        setHistorico([...nextHistory, { role: 'assistant', text: data.mensagem_balconista }].slice(-8));

        if (data.itens_catalogo && data.itens_catalogo.length > 0) {
          setItensCatalogo(data.itens_catalogo);
          setMostrarCatalogo(true);
        } else {
          setMostrarCatalogo(false);
        }
      } catch (err) {
        setError(`Não consegui falar com o BALC agora. Verifique se o backend está ligado. (${err.message})`);
      } finally {
        setEnviando(false);
      }
    },
    [acaoAtual, dadosColetados, enviando, historico, modoEntrada, siteId, tokenUsuario]
  );

  const {
    isSupported,
    isListening,
    isSpeaking,
    speakingId,
    voiceError,
    speak,
    stopSpeaking,
    toggleListening,
    startListening,
    stopListening,
  } = useVoice({
      voice,
      onTranscript: (transcript) => {
        sendMessage(transcript);
      },
    });

  // Carrega o manifesto do site cliente no início
  useEffect(() => {
    let active = true;
    async function loadConfig() {
      setLoadingConfig(true);
      setError('');
      try {
        const resp = await fetch(`${BALC_API_URL}/balc/config/${encodeURIComponent(siteId)}`);
        if (!resp.ok) {
          throw new Error(`Manifesto '${siteId}' não encontrado.`);
        }
        const cfg = await resp.json();
        if (!active) return;
        setSiteConfig(cfg);
        setMensagens([{ id: 'greeting', role: 'assistant', text: cfg.greeting }]);
        setOpcoes(cfg.initial_options || []);
      } catch (err) {
        if (!active) return;
        setError(
          `Não foi possível carregar o BALC para "${siteId}". Inicie o backend na porta 8001. (${err.message})`
        );
      } finally {
        if (active) setLoadingConfig(false);
      }
    }
    loadConfig();
    return () => {
      active = false;
    };
  }, [siteId]);

  // Lê em voz alta automaticamente apenas quando uma nova fala do Balconista chega
  const lastMessage = mensagens[mensagens.length - 1];
  const lastAutoSpokenIdRef = useRef(null);
  useEffect(() => {
    if (
      (autoSpeak || isCallActive) &&
      lastMessage &&
      lastMessage.role === 'assistant' &&
      !loadingConfig &&
      lastAutoSpokenIdRef.current !== lastMessage.id
    ) {
      lastAutoSpokenIdRef.current = lastMessage.id;
      speak(lastMessage.text, lastMessage.id);
    }
  }, [autoSpeak, isCallActive, lastMessage, loadingConfig, speak]);

  // No modo ligação ao vivo, reabre o microfone automaticamente quando o BALC termina de falar
  useEffect(() => {
    if (
      !isCallActive ||
      isListening ||
      isSpeaking ||
      enviando ||
      loadingConfig ||
      modoEntrada === 'senha_cofre' ||
      voiceError
    ) {
      return;
    }

    const timer = setTimeout(() => {
      startListening();
    }, 350);

    return () => clearTimeout(timer);
  }, [isCallActive, isListening, isSpeaking, enviando, loadingConfig, modoEntrada, voiceError, startListening]);

  const speakFromIndex = useCallback(
    (startIndex) => {
      const nextIndex = mensagens.findIndex(
        (m, idx) => idx >= startIndex && m.role === 'assistant'
      );
      if (nextIndex === -1) return;

      const target = mensagens[nextIndex];
      speak(target.text, target.id, () => {
        speakFromIndex(nextIndex + 1);
      });
    },
    [mensagens, speak]
  );

  function handleToggleAutoSpeak() {
    setAutoSpeak((prev) => {
      if (prev) stopSpeaking();
      return !prev;
    });
  }

  function handleToggleCallMode() {
    if (isCallActive) {
      setIsCallActive(false);
      stopListening();
      stopSpeaking();
      return;
    }
    setIsCallActive(true);
    setAutoSpeak(true);
    if (!isSpeaking && !enviando && modoEntrada !== 'senha_cofre') {
      startListening();
    }
  }

  function handleVaultSuccess(token) {
    setTokenUsuario(token);
    setModoEntrada('normal');
    sendMessage('Entrei na minha conta com sucesso.', {
      acaoAtual: null,
      usuarioAutenticado: true,
      tokenUsuario: token,
      modoEntradaAnterior: 'normal',
    });
  }

  function handleVaultCancel() {
    setModoEntrada('normal');
    setAcaoAtual(null);
    setMensagens((prev) => [
      ...prev,
      {
        id: createMsgId('assistant'),
        role: 'assistant',
        text: 'Tudo bem! Cancelei o acesso à conta. Como posso te ajudar agora?',
      },
    ]);
    setOpcoes(siteConfig?.initial_options || []);
  }

  function handleCloseEmbedded() {
    stopSpeaking();
    let targetOrigin = '*';
    if (document.referrer) {
      try {
        targetOrigin = new URL(document.referrer).origin;
      } catch {
        targetOrigin = '*';
      }
    }
    window.parent.postMessage({ type: 'BALC_CLOSE' }, targetOrigin);
  }

  function handleTextSubmit(e) {
    e.preventDefault();
    sendMessage(textoInput);
  }

  const collectedEntries = Object.entries(dadosColetados || {}).filter(
    ([, value]) => value !== null && value !== undefined && value !== ''
  );

  return (
    <div className="balc-shell">
      <header className="balc-header">
        <div className="balc-brand">
          <strong className="balc-brand-title">
            <MicIcon size={22} />
            <span>BALC</span>
          </strong>
          <span>{siteConfig ? siteConfig.site_name : 'Carregando ambiente...'}</span>
        </div>

        <div className="balc-header-actions">
          {tokenUsuario && (
            <span className="balc-auth-pill">
              <CheckIcon size={16} />
              <span>Conta Conectada</span>
            </span>
          )}

          <select
            className="balc-voice-select"
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            aria-label="Selecionar voz"
            title="Selecionar voz"
          >
            <option value="pt-BR-FranciscaNeural">Francisca</option>
            <option value="pt-BR-AntonioNeural">Antonio</option>
            <option value="pt-BR-ThalitaMultilingualNeural">Thalita</option>
          </select>

          <button
            type="button"
            className={`balc-icon-btn ${isCallActive ? 'active' : ''}`}
            onClick={handleToggleCallMode}
            disabled={!isSupported}
            aria-label={isCallActive ? 'Encerrar ligação ao vivo' : 'Iniciar ligação ao vivo'}
            title={isCallActive ? 'Encerrar ligação ao vivo' : 'Modo ligação ao vivo'}
          >
            {isCallActive ? <PhoneOffIcon size={20} /> : <PhoneIcon size={20} />}
          </button>

          <button
            type="button"
            className={`balc-icon-btn ${autoSpeak ? 'active' : ''}`}
            onClick={handleToggleAutoSpeak}
            aria-label={autoSpeak ? 'Desativar leitura automática' : 'Ativar leitura automática'}
            title={autoSpeak ? 'Leitura automática ativada' : 'Leitura automática desativada'}
          >
            {autoSpeak ? <VolumeIcon size={20} /> : <VolumeOffIcon size={20} />}
          </button>

          <button
            type="button"
            className="balc-icon-btn"
            onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
            aria-label={theme === 'light' ? 'Ativar modo escuro' : 'Ativar modo claro'}
            title={theme === 'light' ? 'Modo escuro' : 'Modo claro'}
          >
            {theme === 'light' ? <MoonIcon size={20} /> : <SunIcon size={20} />}
          </button>

          {isEmbedded && (
            <button
              type="button"
              className="balc-icon-btn"
              onClick={handleCloseEmbedded}
              aria-label="Voltar ao site normal"
              title="Voltar ao site normal"
            >
              <CloseIcon size={20} />
            </button>
          )}
        </div>
      </header>

      {error && (
        <p className="balc-error" role="alert">
          {error}
        </p>
      )}

      {mostrarCatalogo ? (
        <CatalogViewer
          items={itensCatalogo}
          onBackToChat={() => setMostrarCatalogo(false)}
          onSelectItem={(item) => {
            setMostrarCatalogo(false);
            sendMessage(`Quero saber mais sobre ${item.titulo || item.nome || 'este item'}`);
          }}
        />
      ) : (
        <>
          <main className="balc-chat-feed" aria-live="polite">
            {loadingConfig ? (
              <div className="balc-chat-row assistant">
                <div className="balc-bubble assistant">
                  <p className="balc-bubble-text">Preparando seu atendimento...</p>
                </div>
              </div>
            ) : (
              mensagens.map((msg, idx) => {
                const isThisSpeaking = isSpeaking && speakingId === msg.id;
                return (
                  <div key={msg.id} className={`balc-chat-row ${msg.role}`}>
                    <div className={`balc-bubble ${msg.role}`}>
                      <span className="balc-bubble-author">
                        {msg.role === 'assistant' ? 'BALC' : 'Você'}
                      </span>
                      <p className="balc-bubble-text">{msg.text}</p>

                      {msg.role === 'assistant' && (
                        <div className="balc-bubble-actions">
                          <button
                            type="button"
                            className="balc-audio-btn"
                            onClick={() => {
                              if (isThisSpeaking) {
                                stopSpeaking();
                              } else {
                                setAutoSpeak(true);
                                speakFromIndex(idx);
                              }
                            }}
                            aria-label={isThisSpeaking ? 'Parar leitura' : 'Ouvir mensagem'}
                            title={isThisSpeaking ? 'Parar leitura' : 'Ouvir mensagem'}
                          >
                            {isThisSpeaking ? <StopIcon size={16} /> : <VolumeIcon size={16} />}
                            <span>{isThisSpeaking ? 'Parar' : 'Ouvir'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {enviando && (
              <div className="balc-chat-row assistant">
                <div className="balc-bubble assistant balc-bubble-typing">
                  <span className="balc-bubble-author">BALC</span>
                  <p className="balc-bubble-text">Pensando na melhor resposta...</p>
                </div>
              </div>
            )}

            {collectedEntries.length > 0 && (
              <div className="balc-summary-box">
                <p className="balc-summary-title">Resumo até agora:</p>
                <div className="balc-summary-grid">
                  {collectedEntries.map(([key, value]) => (
                    <div key={key} className="balc-summary-item">
                      <strong>{key}:</strong> {String(value)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </main>

          {modoEntrada === 'senha_cofre' && siteConfig ? (
            <VaultInput
              siteConfig={siteConfig}
              identifier={identificadorLogin}
              onSuccess={handleVaultSuccess}
              onCancel={handleVaultCancel}
            />
          ) : (
            <>
              {opcoes.length > 0 && (
                <section className="balc-options" aria-label="Opções de escolha rápida">
                  {opcoes.map((opcao, idx) => {
                    const isConfirm =
                      modoEntrada === 'confirmacao' && opcao.toLowerCase().includes('confirmar');
                    return (
                      <button
                        key={`${opcao}-${idx}`}
                        type="button"
                        className={`balc-btn ${isConfirm ? 'balc-btn-confirm' : 'balc-btn-option'}`}
                        disabled={enviando}
                        onClick={() => sendMessage(opcao)}
                      >
                        {isConfirm ? (
                          <CheckIcon size={22} />
                        ) : (
                          <span className="balc-option-num">{idx + 1}</span>
                        )}
                        <span>{opcao}</span>
                      </button>
                    );
                  })}
                </section>
              )}

              <footer className="balc-input-dock">
                {voiceError && (
                  <p className="balc-error" role="alert">
                    {voiceError}
                  </p>
                )}

                <button
                  type="button"
                  className={`balc-btn balc-mic-btn ${isListening || isCallActive ? 'listening' : ''}`}
                  onClick={() => {
                    if (isCallActive && isSpeaking) {
                      stopSpeaking();
                      startListening();
                      return;
                    }
                    toggleListening();
                  }}
                  disabled={enviando || !isSupported}
                >
                  {isListening ? <StopIcon size={24} /> : <MicIcon size={24} />}
                  <span>
                    {isCallActive
                      ? isSpeaking
                        ? 'BALC falando... Toque para interromper'
                        : enviando
                          ? 'BALC pensando...'
                          : isListening
                            ? 'Ligação ativa — ouvindo você...'
                            : 'Ligação ativa — toque para falar'
                      : isListening
                        ? 'Ouvindo você... Toque para parar'
                        : 'Toque aqui para Falar'}
                  </span>
                </button>

                <form className="balc-text-form" onSubmit={handleTextSubmit}>
                  <input
                    type="text"
                    className="balc-input"
                    value={textoInput}
                    onChange={(e) => setTextoInput(e.target.value)}
                    placeholder="Ou escreva aqui com calma..."
                    disabled={enviando}
                    aria-label="Escreva sua resposta"
                  />
                  <button
                    type="submit"
                    className="balc-btn balc-btn-primary balc-send-btn"
                    disabled={enviando || !textoInput.trim()}
                  >
                    <SendIcon size={20} />
                    <span>Enviar</span>
                  </button>
                </form>
              </footer>
            </>
          )}
        </>
      )}
    </div>
  );
}
