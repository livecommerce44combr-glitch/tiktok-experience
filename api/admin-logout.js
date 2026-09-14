"use strict";

const { setCookie } = require("../lib/auth");
const { json, origemOk } = require("../lib/pix");

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { ok: false, erro: "Método não permitido" });
  if (!origemOk(req)) return json(res, 403, { ok: false, erro: "Origem inválida" });
  setCookie(res, "", 0);
  return json(res, 200, { ok: true });
};
