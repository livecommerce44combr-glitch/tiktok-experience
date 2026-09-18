"use strict";

(function () {
  var ATRASO_MS = 5000;
  var HASH_FECHAR = "#grupo-modal-off";
  var modal = document.getElementById("modal-grupo-whatsapp");
  if (!modal) return;

  try {
    if (window.matchMedia("(hover: none), (pointer: coarse)").matches) {
      document.documentElement.classList.add("grupo-static");
    }
  } catch (e) {}

  var inicio = Date.now();
  var aberto = false;
  var fechado = false;
  var timer = 0;

  function hashFechado() {
    return (location.hash || "") === HASH_FECHAR;
  }

  function abrir() {
    if (fechado || hashFechado()) return;
    if (aberto) return;
    aberto = true;
    if (timer) clearInterval(timer);
    modal.style.webkitAnimation = "none";
    modal.style.animation = "none";
    modal.style.webkitTransform = "none";
    modal.style.transform = "none";
    modal.classList.remove("is-closed");
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
  }

  function fechar() {
    fechado = true;
    aberto = false;
    modal.classList.add("is-closed");
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    if (!hashFechado()) {
      try {
        location.hash = HASH_FECHAR.slice(1);
      } catch (e) {}
    }
  }

  function tick() {
    if (fechado || hashFechado()) {
      if (!fechado) fechar();
      return;
    }
    if (Date.now() - inicio >= ATRASO_MS) abrir();
  }

  var fecharBtn = document.getElementById("btn-fechar-grupo");
  if (fecharBtn) {
    fecharBtn.addEventListener("click", function () {
      fechado = true;
      modal.classList.add("is-closed");
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
    });
  }
  modal.addEventListener("click", function (e) {
    if (e.target === modal) fechar();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") fechar();
  });
  window.addEventListener("hashchange", tick);
  window.addEventListener("pageshow", tick);
  window.addEventListener("focus", tick);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) tick();
  });
  ["touchstart", "pointerdown", "scroll"].forEach(function (ev) {
    window.addEventListener(ev, tick, { capture: true, passive: true });
  });

  timer = setInterval(tick, 200);
  setTimeout(tick, ATRASO_MS);
  tick();
})();
