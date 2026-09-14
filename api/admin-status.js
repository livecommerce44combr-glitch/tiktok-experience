"use strict";

const { adminOk } = require("../lib/auth");
const { json, origemOk } = require("../lib/pix");
const { lerInscricoes, gravarInscricoes } = require("../lib/store");

const HEX_OK = /^[a-f0-9]{16}$/;

function idDe(req) {
  const url = new URL(req.url, "http://localhost");
  return String(url.searchParams.get("id") || req.query && req.query.id || "");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { ok: false, erro: "Método não permitido" });
  if (!origemOk(req)) return json(res, 403, { ok: false, erro: "Origem inválida" });
  if (!adminOk(req)) return json(res, 401, { ok: false, erro: "Não autorizado" });

  const id = idDe(req);
  if (!HEX_OK.test(id)) return json(res, 400, { ok: false, erro: "Identificador inválido" });

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let dados = {};
  try {
    dados = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch (_) {
    return json(res, 400, { ok: false, erro: "JSON inválido" });
  }
  const status = dados.status;
  if (status !== "pendente" && status !== "confirmado") {
    return json(res, 400, { ok: false, erro: "Status inválido" });
  }

  const lista = await lerInscricoes();
  const item = lista.find((i) => i.id === id);
  if (!item) return json(res, 404, { ok: false, erro: "Inscrição não encontrada" });
  item.status = status;
  try {
    await gravarInscricoes(lista);
  } catch (_) {
    return json(res, 503, { ok: false, erro: "Não foi possível salvar o status." });
  }
  return json(res, 200, { ok: true });
};
