"use strict";

const QRCode = require("qrcode");
const {
  CHAVE_PIX,
  ID_OK,
  INGRESSOS,
  PIX_TOKEN_TTL,
  WHATSAPP_NUMERO,
  json,
  montarPix,
  extrairChave,
  origemOk,
  pixAssinatura,
  rateOk,
} = require("../lib/pix");

module.exports = async (req, res) => {
  if (req.method !== "GET") return json(res, 405, { ok: false, erro: "Método não permitido" });
  if (!origemOk(req)) return json(res, 403, { ok: false, erro: "Origem inválida" });
  if (!rateOk(req, "pix", 30, 60_000)) return json(res, 429, { ok: false, erro: "Muitas tentativas" });

  const url = new URL(req.url, "http://localhost");
  if ([...url.searchParams.keys()].some((chave) => chave !== "modalidade")) {
    return json(res, 400, { ok: false, erro: "Parâmetros inválidos" });
  }

  const modalidadeId = url.searchParams.get("modalidade") || "";
  if (!ID_OK.test(modalidadeId) || !INGRESSOS[modalidadeId]) {
    return json(res, 400, { ok: false, erro: "Modalidade inválida" });
  }
  if (!/^\d{12,13}$/.test(WHATSAPP_NUMERO)) {
    return json(res, 500, { ok: false, erro: "WhatsApp oficial indisponível" });
  }

  const ingresso = INGRESSOS[modalidadeId];
  let payload;
  try {
    payload = montarPix(ingresso.valor_numero);
  } catch (_) {
    return json(res, 500, { ok: false, erro: "Falha ao montar Pix" });
  }
  const chave = extrairChave(payload);
  if (chave !== CHAVE_PIX || !payload.includes(ingresso.valor_numero)) {
    return json(res, 500, { ok: false, erro: "Falha ao montar Pix" });
  }

  let qr = "";
  try {
    qr = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: "M",
      margin: 4,
      width: 512,
      color: { dark: "#000000FF", light: "#FFFFFFFF" },
    });
  } catch (_) {
    qr = "";
  }

  const expira = String(Math.floor(Date.now() / 1000) + PIX_TOKEN_TTL);
  const token = `${expira}.${pixAssinatura(modalidadeId, payload, expira)}`;
  return json(res, 200, {
    ok: true,
    modalidade_id: ingresso.id,
    nome: ingresso.nome,
    valor: ingresso.valor,
    chave,
    payload,
    qr,
    token,
    whatsapp: WHATSAPP_NUMERO,
  });
};
