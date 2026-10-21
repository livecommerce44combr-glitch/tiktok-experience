"use strict";

(function () {
  try {
    if ((new URLSearchParams(location.search).get("p") || "") === "1") {
      var modalMarla = document.getElementById("modal-grupo-whatsapp");
      var ancoraMarla = document.getElementById("grupo-modal-off");
      if (modalMarla) modalMarla.remove();
      if (ancoraMarla) ancoraMarla.remove();
      return;
    }
  } catch (e) {}

  var ATRASO_MS = 5000;
  var HASH_FECHAR = "#grupo-modal-off";
  var modal = document.getElementById("modal-grupo-whatsapp");
  if (!modal) return;

  var reduce = false;
  try {
    reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {}
  if (reduce) document.documentElement.classList.add("grupo-static");

  var inicio = Date.now();
  var aberto = false;
  var fechado = false;
  var timer = 0;
  var fxOn = false;

  function hashFechado() {
    return (location.hash || "") === HASH_FECHAR;
  }

  function setXform(el, value) {
    if (!el) return;
    el.style.webkitTransform = value;
    el.style.transform = value;
  }

  function startFx() {
    if (reduce || fxOn) return;
    fxOn = true;
    var icon = modal.querySelector(".grupo-modal__icon");
    var ripples = modal.querySelectorAll(".grupo-modal__ripple");
    var shine = modal.querySelector(".grupo-modal__shine");
    var cta = modal.querySelector(".grupo-modal__cta");
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    function now() {
      return (window.performance && performance.now) ? performance.now() : Date.now();
    }
    function loop() {
      if (!aberto || fechado) {
        fxOn = false;
        return;
      }
      var t = (now() - t0) / 1000;
      setXform(icon, "translate3d(0," + (Math.sin(t * 3.1) * 6) + "px,0)");
      for (var i = 0; i < ripples.length; i++) {
        var p = ((t / 2.1) + i * 0.5) % 1;
        if (p < 0) p += 1;
        setXform(ripples[i], "scale(" + (0.72 + p * 0.73).toFixed(3) + ")");
        ripples[i].style.opacity = String((0.65 * (1 - p)).toFixed(3));
      }
      if (shine) {
        var x = -120 + ((t / 2.3) % 1) * 340;
        setXform(shine, "translate3d(" + x + "%,0,0) skewX(-20deg)");
      }
      setXform(cta, "scale(" + (1 + Math.sin(t * 2.2) * 0.025).toFixed(4) + ")");
      if (window.requestAnimationFrame) requestAnimationFrame(loop);
      else setTimeout(loop, 16);
    }
    if (window.requestAnimationFrame) requestAnimationFrame(loop);
    else setTimeout(loop, 16);
  }

  function abrir() {
    if (fechado || hashFechado()) return;
    if (aberto) return;
    aberto = true;
    if (timer) clearInterval(timer);
    modal.classList.remove("is-closed");
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    startFx();
  }

  function fechar() {
    fechado = true;
    aberto = false;
    fxOn = false;
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
      fxOn = false;
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
