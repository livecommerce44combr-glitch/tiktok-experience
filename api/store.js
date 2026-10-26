"use strict";

const { assinaturaConfere, pedidoValido } = require("../lib/store-auth");
const blob = require("../lib/blob-store");

const MAX = 5 * 1024 * 1024;

function souArmazem() {
  return process.env.ARMAZEM === "local" || Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function json(res, status, dados) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(dados));
}

async function lerCorpo(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body instanceof Uint8Array) return Buffer.from(req.body);
  if (typeof req.body === "string") return Buffer.from(req.body);
  const chunks = [];
  if (req && typeof req[Symbol.asyncIterator] === "function") {
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { ok: false, erro: "Método não permitido" });
  if (!souArmazem()) return json(res, 404, { ok: false, erro: "Rota não encontrada" });

  const segredo = (process.env.ADMIN_SENHA || "").trim();
  const url = new URL(req.url, "http://localhost");
  const op = String(url.searchParams.get("op") || (req.query && req.query.op) || "");
  const arquivo = String(url.searchParams.get("arquivo") || (req.query && req.query.arquivo) || "");
  const ts = String(req.headers["x-store-ts"] || "");
  const sig = String(req.headers["x-store-sig"] || "");
  if (!pedidoValido(op, arquivo)) return json(res, 400, { ok: false, erro: "Pedido inválido" });
  if (!/^\d{13}$/.test(ts) || Math.abs(Date.now() - Number(ts)) > 5 * 60 * 1000) {
    return json(res, 401, { ok: false, erro: "Pedido expirado" });
  }

  let body;
  try {
    body = await lerCorpo(req);
  } catch (_) {
    return json(res, 400, { ok: false, erro: "Envio inválido" });
  }
  if (body.length > MAX) return json(res, 413, { ok: false, erro: "Arquivo acima de 5 MB" });
  if (!assinaturaConfere(segredo, ts, op, arquivo, body, sig)) {
    return json(res, 401, { ok: false, erro: "Não autorizado" });
  }

  try {
    if (op === "lerInscricoes") {
      return json(res, 200, { ok: true, inscricoes: await blob.lerInscricoes() });
    }
    if (op === "gravarItem") {
      const dados = JSON.parse(body.toString("utf8") || "{}");
      await blob.gravarItem(dados.item);
      return json(res, 200, { ok: true });
    }
    if (op === "gravarInscricoes") {
      const dados = JSON.parse(body.toString("utf8") || "{}");
      if (!Array.isArray(dados.lista)) return json(res, 400, { ok: false, erro: "Lista inválida" });
      await blob.gravarInscricoes(dados.lista);
      return json(res, 200, { ok: true });
    }
    if (op === "lerParceiros") {
      return json(res, 200, { ok: true, parceiros: await blob.lerParceiros() });
    }
    if (op === "gravarParceiros") {
      const dados = JSON.parse(body.toString("utf8") || "{}");
      await blob.gravarParceiros(dados.nomes || {});
      return json(res, 200, { ok: true });
    }
    if (op === "salvarArquivo") {
      const tipo = String(req.headers["content-type"] || "application/octet-stream").split(";")[0].trim();
      await blob.salvarArquivo(arquivo, body, tipo || "application/octet-stream");
      return json(res, 200, { ok: true });
    }
    if (op === "lerArquivo") {
      const achado = await blob.lerArquivo(arquivo);
      if (!achado) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Arquivo não encontrado");
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", achado.contentType || "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      res.end(achado.buffer);
      return;
    }
  } catch (_) {
    return json(res, 503, { ok: false, erro: "Não foi possível salvar." });
  }
  return json(res, 404, { ok: false, erro: "Rota não encontrada" });
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
