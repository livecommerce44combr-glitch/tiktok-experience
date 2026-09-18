"use strict";

const { senhaOk, criarToken, setCookie, TTL } = require("../lib/auth");
const { json, origemOk, rateOk } = require("../lib/pix");

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { ok: false, erro: "Método não permitido" });
  if (!origemOk(req)) return json(res, 403, { ok: false, erro: "Origem inválida" });
  if (!rateOk(req, "login", 8, 60_000)) return json(res, 429, { ok: false, erro: "Muitas tentativas" });

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let dados = {};
  try {
    dados = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch (_) {
    return json(res, 400, { ok: false, erro: "JSON inválido" });
  }

  const senha = String(dados.senha || "");
  if (!senhaOk(senha)) {
    return json(res, 401, { ok: false, erro: "Senha incorreta" });
  }

  setCookie(res, criarToken(), TTL);
  return json(res, 200, { ok: true });
};
