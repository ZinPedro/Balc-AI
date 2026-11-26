import { useState } from 'react';

/**
 * Catálogo Limpo: exibe apenas 1 item por tela com navegação clara
 * e botão fixo no topo para voltar à conversa com o BALC a qualquer momento.
 */
export function CatalogViewer({ items, onBackToChat, onSelectItem }) {
  const [index, setIndex] = useState(0);

  if (!items || items.length === 0) return null;

  const current = items[index] || items[0];
  const entries = Object.entries(current).filter(([key]) => key !== 'id');

  return (
    <section className="balc-catalog" aria-label="Catálogo simplificado">
      <button type="button" className="balc-btn balc-btn-primary balc-catalog-back" onClick={onBackToChat}>
        ← Voltar para a conversa com o BALC
      </button>

      <div className="balc-catalog-card">
        <span className="balc-catalog-counter">
          Item {index + 1} de {items.length}
        </span>

        <h2 className="balc-catalog-title">
          {current.titulo || current.nome || current.name || `Registro #${index + 1}`}
        </h2>

        <dl className="balc-catalog-details">
          {entries.map(([key, value]) => {
            if (key === 'titulo' || key === 'nome' || key === 'name') return null;
            return (
              <div key={key} className="balc-catalog-row">
                <dt>{key}:</dt>
                <dd>{key.includes('preco') || key.includes('valor') ? `R$ ${value}` : String(value)}</dd>
              </div>
            );
          })}
        </dl>

        {onSelectItem && (
          <button
            type="button"
            className="balc-btn balc-btn-confirm"
            onClick={() => onSelectItem(current)}
          >
            Quero saber mais sobre este item
          </button>
        )}
      </div>

      {items.length > 1 && (
        <div className="balc-catalog-nav">
          <button
            type="button"
            className="balc-btn balc-btn-secondary"
            disabled={index === 0}
            onClick={() => setIndex((prev) => Math.max(0, prev - 1))}
          >
            ⬅️ Anterior
          </button>
          <button
            type="button"
            className="balc-btn balc-btn-primary"
            disabled={index === items.length - 1}
            onClick={() => setIndex((prev) => Math.min(items.length - 1, prev + 1))}
          >
            Próximo ➡️
          </button>
        </div>
      )}
    </section>
  );
}
