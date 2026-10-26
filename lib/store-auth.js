"use strict";

const crypto = require("crypto");

const ARQUIVO_OK = /^(?:admin\/inscricoes\.json|admin\/parceiros\.json|admin\/inscricoes\/[a-f0-9]{16}\.json|comprovantes\/[a-f0-9]{16}\.(?:jpe?g|png|webp|pdf|heic|heif))$/;
const OPS = new Set(["lerInscricoes", "gravarItem", "salvarArquivo", "lerArquivo", "lerParceiros", "gravarParceiros", "gravarInscricoes"]);

function corpoBuffer(body) {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body);
  return Buffer.alloc(0);
}

function assinar(segredo, ts, op, arquivo, body) {
  const hash = crypto.createHash("sha256").update(corpoBuffer(body)).digest("hex");
  return crypto.createHmac("sha256", segredo).update(`${ts}\n${op}\n${arquivo}\n${hash}`).digest("hex");
}

function assinaturaConfere(segredo, ts, op, arquivo, body, sig) {
  if (!segredo || !/^\d{13}$/.test(String(ts)) || !/^[a-f0-9]{64}$/.test(String(sig))) return false;
  const esperado = assinar(segredo, String(ts), op, arquivo, body);
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado));
}

function pedidoValido(op, arquivo) {
  if (!OPS.has(op)) return false;
  if (op === "salvarArquivo" || op === "lerArquivo") return ARQUIVO_OK.test(arquivo);
  return arquivo === "";
}

module.exports = { assinar, assinaturaConfere, pedidoValido, corpoBuffer };
