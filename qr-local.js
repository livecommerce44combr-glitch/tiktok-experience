/* QR Code Pix em PNG nítido (módulos inteiros) para apps de banco */
(function (global) {
  function desenharQRCode(alvo, text) {
    if (typeof qrcode !== "function" || !alvo) return;
    const payload = String(text || "").replace(/[\n\r\t]/g, "").trim();
    const qr = qrcode(0, "M");
    qr.addData(payload, "Byte");
    qr.make();
    const n = qr.getModuleCount();
    const cell = 8;
    const quiet = 4;
    const size = (n + quiet * 2) * cell;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000000";
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (qr.isDark(y, x)) {
          ctx.fillRect((x + quiet) * cell, (y + quiet) * cell, cell, cell);
        }
      }
    }
    const png = canvas.toDataURL("image/png");
    if (alvo.tagName === "IMG") {
      alvo.src = png;
      alvo.width = size;
      alvo.height = size;
      return;
    }
    const ctxAlvo = alvo.getContext && alvo.getContext("2d");
    if (!ctxAlvo) return;
    alvo.width = size;
    alvo.height = size;
    ctxAlvo.fillStyle = "#ffffff";
    ctxAlvo.fillRect(0, 0, size, size);
    const img = new Image();
    img.onload = function () {
      ctxAlvo.drawImage(img, 0, 0);
    };
    img.src = png;
  }

  global.desenharQRCodePix = desenharQRCode;
})(window);
