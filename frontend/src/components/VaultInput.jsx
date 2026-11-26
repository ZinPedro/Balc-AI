import { useState } from 'react';

/**
 * Modo Cofre (Zero-Knowledge):
 * Envia a senha DIRETAMENTE para a API do site cliente, sem nunca passar pela LLM
 * ou pelo backend do BALC. O microfone fica desativado neste modo por privacidade.
 */
export function VaultInput({ siteConfig, identifier, onSuccess, onCancel }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!password.trim()) {
      setError('Digite sua senha para continuar.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Modo sandbox (sem API externa conectada): simula retorno de token seguro
      if (siteConfig.simulation_mode || !siteConfig.api_base_url) {
        const fakeToken = `sandbox_jwt_${Date.now()}`;
        setPassword('');
        onSuccess(fakeToken);
        return;
      }

      const auth = siteConfig.auth;
      const loginUrl = `${siteConfig.api_base_url.replace(/\/$/, '')}/${auth.login_endpoint.replace(/^\//, '')}`;
      const parsedLoginUrl = new URL(loginUrl);
      const isLocalDev =
        parsedLoginUrl.hostname === 'localhost' || parsedLoginUrl.hostname === '127.0.0.1';
      if (parsedLoginUrl.protocol !== 'https:' && !isLocalDev) {
        throw new Error('Conexão insegura: o login requer HTTPS para proteger sua senha.');
      }

      const resp = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [auth.identifier_field]: identifier,
          [auth.password_field]: password,
        }),
      });

      if (!resp.ok) {
        throw new Error('Senha ou usuário incorretos. Tente novamente.');
      }

      const data = await resp.json();
      const token = data[auth.token_response_key] || data.token || data.access_token;

      if (!token) {
        throw new Error('Login aceito, mas não recebemos o token de acesso do site.');
      }

      // Limpa a senha imediatamente da memória
      setPassword('');
      onSuccess(token);
    } catch (err) {
      setError(err.message || 'Não foi possível validar sua senha agora.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="balc-vault-card" onSubmit={handleSubmit}>
      <div className="balc-vault-badge">
        🔒 Modo Cofre Ativo — Sua senha vai direto para {siteConfig.site_name} e nunca passa pela IA
      </div>

      {identifier && (
        <p className="balc-vault-id">
          Conta: <strong>{identifier}</strong>
        </p>
      )}

      <label htmlFor="balc-vault-password" className="balc-label">
        Digite sua senha com segurança:
      </label>

      <input
        id="balc-vault-password"
        type="password"
        className="balc-input"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••••"
        autoFocus
        autoComplete="current-password"
      />

      {error && (
        <p className="balc-error" role="alert">
          {error}
        </p>
      )}

      <div className="balc-vault-actions">
        <button type="submit" className="balc-btn balc-btn-confirm" disabled={loading}>
          {loading ? 'Verificando...' : '🔓 Entrar com Segurança'}
        </button>
        <button type="button" className="balc-btn balc-btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
