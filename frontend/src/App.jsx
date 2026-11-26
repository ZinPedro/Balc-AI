import { useCallback, useEffect, useMemo, useState } from 'react';
import { CatalogViewer } from './components/CatalogViewer';
import { VaultInput } from './components/VaultInput';
import { useVoice } from './hooks/useVoice';

const BALC_API_URL = import.meta.env.VITE_BALC_API_URL || 'http://localhost:8001';

export default function App() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const siteId = params.get('site') || 'balc_livre';
  const isEmbedded = params.get('embedded') === '1';

  const [theme, setTheme] = useState('light');
  const [siteConfig, setSiteConfig] = useState(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [error, setError] = useState('');

  // Estado do Modo Foco (1 decisão/pergunta por tela)
  const [mensagem, setMensagem] = useState('');
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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const sendMessage = useCallback(
    async (texto, overrideState = {}) => {
      const clean = (texto || '').trim();
      if (!clean || enviando) return;

      setEnviando(true);
      setError('');
      setTextoInput('');

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
          }),
        });

        if (!resp.ok) {
          const detail = await resp.text();
          throw new Error(detail || 'Falha ao conversar com o servidor do BALC.');
        }

        const data = await resp.json();
        setMensagem(data.mensagem_balconista);
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
    [acaoAtual, dadosColetados, enviando, historico, siteId, tokenUsuario]
  );

  const { isSupported, isListening, isSpeaking, voiceError, speak, stopSpeaking, toggleListening } =
    useVoice({
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
        setMensagem(cfg.greeting);
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

  // Lê em voz alta automaticamente a nova fala do Balconista
  useEffect(() => {
    if (mensagem && !loadingConfig) {
      speak(mensagem);
    }
  }, [mensagem, loadingConfig, speak]);

  function handleVaultSuccess(token) {
    setTokenUsuario(token);
    setModoEntrada('normal');
    sendMessage('Entrei na minha conta com sucesso.', {
      acaoAtual: null,
      usuarioAutenticado: true,
      tokenUsuario: token,
    });
  }

  function handleVaultCancel() {
    setModoEntrada('normal');
    setAcaoAtual(null);
    setMensagem('Tudo bem! Cancelei o acesso à conta. Como posso te ajudar agora?');
    setOpcoes(siteConfig?.initial_options || []);
  }

  function handleCloseEmbedded() {
    stopSpeaking();
    window.parent.postMessage({ type: 'BALC_CLOSE' }, '*');
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
          <strong>🎙️ BALC</strong>
          <span>{siteConfig ? siteConfig.site_name : 'Carregando ambiente...'}</span>
        </div>

        <div className="balc-header-actions">
          {tokenUsuario && <span className="balc-auth-pill">✅ Conta Conectada</span>}

          <button
            type="button"
            className="balc-top-btn"
            onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? '🌙 Modo Escuro' : '☀️ Modo Claro'}
          </button>

          {isEmbedded && (
            <button type="button" className="balc-top-btn" onClick={handleCloseEmbedded}>
              ✖️ Voltar ao site normal
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
          <main className="balc-focus-card" aria-live="polite">
            <p className="balc-message">{loadingConfig ? 'Preparando seu atendimento...' : mensagem}</p>

            <div className="balc-audio-row">
              <button
                type="button"
                className="balc-top-btn"
                onClick={() => (isSpeaking ? stopSpeaking() : speak(mensagem))}
                disabled={!mensagem}
              >
                {isSpeaking ? '⏹️ Parar leitura' : '🔊 Ouvir novamente'}
              </button>

              {enviando && <span className="balc-status-hint">Pensando na melhor resposta...</span>}
            </div>

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
                        {!isConfirm && <span className="balc-option-num">{idx + 1}</span>}
                        <span>{isConfirm ? `✅ ${opcao}` : opcao}</span>
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
                  className={`balc-btn balc-mic-btn ${isListening ? 'listening' : ''}`}
                  onClick={toggleListening}
                  disabled={enviando || !isSupported}
                >
                  {isListening
                    ? '🛑 Ouvindo você... Toque para parar'
                    : '🎙️ Toque aqui para Falar'}
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
                    Enviar
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
