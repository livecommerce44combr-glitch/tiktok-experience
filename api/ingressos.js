"use strict";

const { INGRESSOS, json, origemOk } = require("../lib/pix");

module.exports = (req, res) => {
  if (req.method !== "GET") return json(res, 405, { ok: false, erro: "Método não permitido" });
  if (!origemOk(req)) return json(res, 403, { ok: false, erro: "Origem inválida" });
  const ingressos = Object.values(INGRESSOS).map((item) => ({
    id: item.id,
    nome: item.nome,
    valor: item.valor,
    label: item.label,
  }));
  return json(res, 200, { ok: true, ingressos });
};
