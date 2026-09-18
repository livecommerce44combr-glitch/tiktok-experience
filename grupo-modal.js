"use strict";

(function () {
  var ATRASO_MS = 5000;
  var HASH_FECHAR = "#grupo-modal-off";
  var modal = document.getElementById("modal-grupo-whatsapp");
  if (!modal) return;

  var ua = navigator.userAgent || "";
  var ios = /iP(hone|ad|od)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var mobile = ios || /Android|Mobile|webOS|Silk/i.test(ua) || ("ontouchstart" in window && Math.min(screen.width, screen.height) < 1024);
  document.documentElement.classList.add("grupo-static");
  if (!mobile) {
    document.documentElement.classList.remove("grupo-static");
    document.documentElement.classList.add("grupo-motion");
  } else {
    document.documentElement.classList.remove("grupo-motion");
    var extras = modal.querySelectorAll(".grupo-modal__ripple, .grupo-modal__glow");
    for (var i = 0; i < extras.length; i++) {
      extras[i].parentNode.removeChild(extras[i]);
    }
  }

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
    modal.style.cssText += ";animation:none!important;-webkit-animation:none!important;transform:none;filter:none;";
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
