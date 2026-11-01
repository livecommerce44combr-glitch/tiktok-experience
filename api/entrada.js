"use strict";

const { json, origemOk, rateOk } = require("../lib/pix");
const { registrarEntrada } = require("../lib/store");

const PAGINAS = new Set(["principal", "1", "2", "3", "4", "5"]);

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { ok: false, erro: "Método não permitido" });
  if (!origemOk(req)) return json(res, 403, { ok: false, erro: "Origem inválida" });
  if (!rateOk(req, "entrada", 30, 60_000)) return json(res, 429, { ok: false, erro: "Muitas tentativas" });

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let dados = {};
  try {
    dados = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch (_) {
    return json(res, 400, { ok: false, erro: "JSON inválido" });
  }

  const pagina = String(dados.pagina || "");
  const visitante = String(dados.visitante || "");
  if (!PAGINAS.has(pagina) || !/^[a-f0-9]{16}$/.test(visitante)) {
    return json(res, 400, { ok: false, erro: "Entrada inválida" });
  }

  try {
    await registrarEntrada(pagina, visitante);
  } catch (_) {
    return json(res, 503, { ok: false, erro: "Não foi possível registrar a entrada." });
  }
  return json(res, 200, { ok: true });
};
