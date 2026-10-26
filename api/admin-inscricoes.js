"use strict";

const { adminOk } = require("../lib/auth");
const { json, origemOk } = require("../lib/pix");
const { lerInscricoes } = require("../lib/store");

module.exports = async (req, res) => {
  if (req.method !== "GET") return json(res, 405, { ok: false, erro: "Método não permitido" });
  if (!origemOk(req)) return json(res, 403, { ok: false, erro: "Origem inválida" });
  if (!adminOk(req)) return json(res, 401, { ok: false, erro: "Não autorizado" });
  try {
    const lista = await lerInscricoes();
    return json(res, 200, { ok: true, inscricoes: lista.slice().reverse() });
  } catch (_) {
    return json(res, 200, { ok: true, inscricoes: [] });
  }
};
