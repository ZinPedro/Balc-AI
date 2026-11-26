import { useEffect, useState } from 'react';
import { ArrowLeftIcon, ArrowRightIcon } from './Icons';

/**
 * Catálogo Limpo: exibe apenas 1 item por tela com navegação clara
 * e botão fixo no topo para voltar à conversa com o BALC a qualquer momento.
 */
export function CatalogViewer({ items, onBackToChat, onSelectItem }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [items]);

  if (!items || items.length === 0) return null;

  const safeIndex = Math.min(index, items.length - 1);
  const current = items[safeIndex] || items[0];
  const entries = Object.entries(current).filter(([key]) => key !== 'id');

  return (
    <section className="balc-catalog" aria-label="Catálogo simplificado">
      <button type="button" className="balc-btn balc-btn-primary balc-catalog-back" onClick={onBackToChat}>
        <ArrowLeftIcon size={22} />
        <span>Voltar para a conversa com o BALC</span>
      </button>

      <div className="balc-catalog-card">
        <span className="balc-catalog-counter">
          Item {safeIndex + 1} de {items.length}
        </span>

        <h2 className="balc-catalog-title">
          {current.titulo || current.nome || current.name || `Registro #${safeIndex + 1}`}
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
            disabled={safeIndex === 0}
            onClick={() => setIndex((prev) => Math.max(0, prev - 1))}
          >
            <ArrowLeftIcon size={22} />
            <span>Anterior</span>
          </button>
          <button
            type="button"
            className="balc-btn balc-btn-primary"
            disabled={safeIndex === items.length - 1}
            onClick={() => setIndex((prev) => Math.min(items.length - 1, prev + 1))}
          >
            <span>Próximo</span>
            <ArrowRightIcon size={22} />
          </button>
        </div>
      )}
    </section>
  );
}
