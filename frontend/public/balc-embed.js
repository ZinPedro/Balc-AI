/**
 * BALC Embed Script (Plug & Unplug em 1 linha)
 *
 * Como qualquer site acopla o BALC:
 * <script src="http://localhost:5174/balc-embed.js" data-site="demo_generico"></script>
 *
 * Para remover: basta apagar a linha acima. Zero alterações no backend ou banco do cliente.
 */
(function () {
  if (window.__BALC_EMBED_LOADED__) return;
  window.__BALC_EMBED_LOADED__ = true;

  const currentScript = document.currentScript;
  const siteId = (currentScript && currentScript.getAttribute("data-site")) || "demo_generico";
  const balcBaseUrl =
    (currentScript && currentScript.getAttribute("data-url")) ||
    (currentScript ? new URL(currentScript.src).origin : "http://localhost:5174");

  // 1. Botão flutuante de alto contraste
  const triggerBtn = document.createElement("button");
  triggerBtn.id = "balc-floating-trigger";
  triggerBtn.type = "button";
  triggerBtn.setAttribute("aria-label", "Ativar BALC — Atendimento por Voz e Letras Grandes");
  triggerBtn.textContent = "🎙️ Ativar BALC (Modo Fácil)";
  Object.assign(triggerBtn.style, {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    zIndex: "2147483646",
    backgroundColor: "#0b57d0",
    color: "#ffffff",
    border: "3px solid #ffffff",
    borderRadius: "999px",
    padding: "16px 24px",
    fontSize: "20px",
    fontWeight: "700",
    fontFamily: "system-ui, -apple-system, sans-serif",
    cursor: "pointer",
    boxShadow: "0 8px 28px rgba(0, 0, 0, 0.35)",
  });

  // 2. Overlay em tela cheia com iframe isolado (allow="microphone")
  const overlay = document.createElement("div");
  overlay.id = "balc-overlay-container";
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    display: "none",
    flexDirection: "column",
  });

  const iframe = document.createElement("iframe");
  iframe.title = "BALC — Balconista Virtual Acessível";
  iframe.setAttribute("allow", "microphone");
  Object.assign(iframe.style, {
    width: "100%",
    height: "100%",
    border: "none",
    backgroundColor: "#ffffff",
  });

  overlay.appendChild(iframe);

  function openBalc() {
    if (!iframe.src) {
      iframe.src = `${balcBaseUrl.replace(/\/$/, "")}/?site=${encodeURIComponent(siteId)}&embedded=1`;
    }
    overlay.style.display = "flex";
    triggerBtn.style.display = "none";
  }

  function closeBalc() {
    overlay.style.display = "none";
    triggerBtn.style.display = "inline-flex";
  }

  triggerBtn.addEventListener("click", openBalc);

  // Permite que o botão "Fechar BALC" dentro do iframe feche o overlay
  window.addEventListener("message", function (event) {
    if (event.data && event.data.type === "BALC_CLOSE") {
      closeBalc();
    }
  });

  document.body.appendChild(triggerBtn);
  document.body.appendChild(overlay);
})();
