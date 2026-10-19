"use strict";

const { adminOk } = require("../lib/auth");
const { json, origemOk } = require("../lib/pix");
const { PARCEIRO_IDS, lerParceiros, gravarParceiros, nomeParceiroLimpo } = require("../lib/store");

function listaDe(nomes) {
  return PARCEIRO_IDS.map((id) => ({ id, nome: nomes[id] || "" }));
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return json(res, 405, { ok: false, erro: "Método não permitido" });
  }
  if (!origemOk(req)) return json(res, 403, { ok: false, erro: "Origem inválida" });
  if (!adminOk(req)) return json(res, 401, { ok: false, erro: "Não autorizado" });

  if (req.method === "GET") {
    return json(res, 200, { ok: true, parceiros: listaDe(await lerParceiros()) });
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let dados = {};
  try {
    dados = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch (_) {
    return json(res, 400, { ok: false, erro: "JSON inválido" });
  }
  const recebidos = dados.nomes;
  if (!recebidos || typeof recebidos !== "object" || Array.isArray(recebidos)) {
    return json(res, 400, { ok: false, erro: "Nomes inválidos" });
  }

  const atual = await lerParceiros();
  for (const id of PARCEIRO_IDS) {
    if (!Object.prototype.hasOwnProperty.call(recebidos, id)) continue;
    if (typeof recebidos[id] !== "string") return json(res, 400, { ok: false, erro: "Nome inválido" });
    atual[id] = nomeParceiroLimpo(recebidos[id]);
  }

  try {
    await gravarParceiros(atual);
  } catch (_) {
    return json(res, 503, { ok: false, erro: "Não foi possível salvar os parceiros." });
  }
  return json(res, 200, { ok: true, parceiros: listaDe(atual) });
};
