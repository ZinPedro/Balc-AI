import { useState } from 'react';
import { EyeIcon, EyeOffIcon, LockIcon, UnlockIcon } from './Icons';

/**
 * Modo Cofre (Zero-Knowledge):
 * Envia a senha DIRETAMENTE para a API do site cliente, sem nunca passar pela LLM
 * ou pelo backend do BALC. O microfone fica desativado neste modo por privacidade.
 */
export function VaultInput({ siteConfig, identifier, onSuccess, onCancel }) {
  const [localIdentifier, setLocalIdentifier] = useState(identifier || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const effectiveIdentifier = (identifier || localIdentifier).trim();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!effectiveIdentifier) {
      setError(`Informe ${siteConfig.auth.identifier_label || 'seu identificador'} para continuar.`);
      return;
    }
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
          [auth.identifier_field]: effectiveIdentifier,
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
        <LockIcon size={20} />
        <span>
          Modo Cofre Ativo — Sua senha vai direto para {siteConfig.site_name} e nunca passa pela IA
        </span>
      </div>

      {identifier ? (
        <p className="balc-vault-id">
          Conta: <strong>{identifier}</strong>
        </p>
      ) : (
        <>
          <label htmlFor="balc-vault-identifier" className="balc-label">
            Informe {siteConfig.auth.identifier_label || 'seu e-mail ou telefone'}:
          </label>
          <input
            id="balc-vault-identifier"
            type="text"
            className="balc-input"
            value={localIdentifier}
            onChange={(e) => setLocalIdentifier(e.target.value)}
            placeholder={siteConfig.auth.identifier_label || 'seu e-mail ou telefone'}
            autoFocus
            autoComplete="username"
          />
        </>
      )}

      <label htmlFor="balc-vault-password" className="balc-label">
        Digite sua senha com segurança:
      </label>

      <div className="balc-password-wrap">
        <input
          id="balc-vault-password"
          type={showPassword ? 'text' : 'password'}
          className="balc-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoFocus={Boolean(identifier)}
          autoComplete="current-password"
        />
        <button
          type="button"
          className="balc-password-toggle"
          onClick={() => setShowPassword((prev) => !prev)}
          aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
          aria-pressed={showPassword}
        >
          {showPassword ? <EyeOffIcon size={22} /> : <EyeIcon size={22} />}
          <span>{showPassword ? 'Ocultar' : 'Mostrar'}</span>
        </button>
      </div>

      {error && (
        <p className="balc-error" role="alert">
          {error}
        </p>
      )}

      <div className="balc-vault-actions">
        <button type="submit" className="balc-btn balc-btn-confirm" disabled={loading}>
          <UnlockIcon size={22} />
          <span>{loading ? 'Verificando...' : 'Entrar com Segurança'}</span>
        </button>
        <button type="button" className="balc-btn balc-btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
