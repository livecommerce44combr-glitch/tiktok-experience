"use strict";

const { adminOk } = require("../lib/auth");
const { json, origemOk } = require("../lib/pix");
const { PARCEIRO_IDS, lerParceiros, gravarParceiros, nomeParceiroLimpo, lerEntradas } = require("../lib/store");

function numeroEntrada(valor) {
  if (Array.isArray(valor)) return valor.length;
  const n = Number(valor);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function listaDe(nomes, entradas) {
  const contagem = entradas && typeof entradas === "object" ? entradas : {};
  return PARCEIRO_IDS.map((id) => ({ id, nome: nomes[id] || "", entradas: numeroEntrada(contagem[id]) }));
}

async function entradasAtuais() {
  try {
    return await lerEntradas();
  } catch (_) {
    return {};
  }
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return json(res, 405, { ok: false, erro: "Método não permitido" });
  }
  if (!origemOk(req)) return json(res, 403, { ok: false, erro: "Origem inválida" });
  if (!adminOk(req)) return json(res, 401, { ok: false, erro: "Não autorizado" });

  if (req.method === "GET") {
    const entradas = await entradasAtuais();
    return json(res, 200, {
      ok: true,
      parceiros: listaDe(await lerParceiros(), entradas),
      entradas_principal: numeroEntrada(entradas.principal),
    });
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
  const entradas = await entradasAtuais();
  return json(res, 200, {
    ok: true,
    parceiros: listaDe(atual, entradas),
    entradas_principal: numeroEntrada(entradas.principal),
  });
};
