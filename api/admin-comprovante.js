"use strict";

const { adminOk } = require("../lib/auth");
const { json, origemOk } = require("../lib/pix");
const { lerInscricoes, lerArquivo } = require("../lib/store");

const HEX_OK = /^[a-f0-9]{16}$/;

function idDe(req) {
  const url = new URL(req.url, "http://localhost");
  return String(url.searchParams.get("id") || req.query && req.query.id || "");
}

module.exports = async (req, res) => {
  if (req.method !== "GET") return json(res, 405, { ok: false, erro: "Método não permitido" });
  if (!origemOk(req)) return json(res, 403, { ok: false, erro: "Origem inválida" });
  if (!adminOk(req)) return json(res, 401, { ok: false, erro: "Não autorizado" });

  const id = idDe(req);
  if (!HEX_OK.test(id)) return json(res, 400, { ok: false, erro: "Identificador inválido" });

  const item = (await lerInscricoes()).find((i) => i.id === id);
  const arquivo = (item && item.comprovante_arquivo) || "";
  if (!arquivo || arquivo.includes("..") || !arquivo.startsWith("comprovantes/")) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Comprovante não encontrado");
    return;
  }

  try {
    const blob = await lerArquivo(arquivo);
    if (!blob) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Arquivo não encontrado");
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", blob.contentType);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", 'inline; filename="comprovante"');
    res.end(blob.buffer);
  } catch (_) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Arquivo não encontrado");
  }
};
