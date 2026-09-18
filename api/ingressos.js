"use strict";

const { INGRESSOS, WHATSAPP_NUMERO, CHAVE_PIX, json, origemOk, rateOk } = require("../lib/pix");

module.exports = (req, res) => {
  if (req.method !== "GET") return json(res, 405, { ok: false, erro: "Método não permitido" });
  if (!origemOk(req)) return json(res, 403, { ok: false, erro: "Origem inválida" });
  if (!rateOk(req, "ingressos", 60, 60_000)) return json(res, 429, { ok: false, erro: "Muitas tentativas" });
  const ingressos = Object.values(INGRESSOS).map((item) => ({
    id: item.id,
    nome: item.nome,
    valor: item.valor,
    label: item.label,
  }));
  return json(res, 200, { ok: true, ingressos, whatsapp: WHATSAPP_NUMERO, chave_pix: CHAVE_PIX });
};
