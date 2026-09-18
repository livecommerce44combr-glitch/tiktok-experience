"use strict";

const crypto = require("crypto");
const Busboy = require("busboy");
const { INGRESSOS, ID_OK, json, origemOk, pixTokenValido, rateOk } = require("../lib/pix");
const { lerInscricoes, gravarInscricoes, salvarArquivo } = require("../lib/store");

const TIPOS = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};
const MAX = 5 * 1024 * 1024;

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers, limits: { fileSize: MAX, files: 1, fields: 20 } });
    const fields = {};
    let file = null;
    let tooBig = false;
    bb.on("field", (name, val) => {
      fields[name] = val;
    });
    bb.on("file", (name, stream, info) => {
      const chunks = [];
      stream.on("data", (c) => chunks.push(c));
      stream.on("limit", () => {
        tooBig = true;
      });
      stream.on("end", () => {
        file = {
          filename: info.filename || "",
          mimeType: info.mimeType || "",
          data: Buffer.concat(chunks),
        };
      });
    });
    bb.on("error", reject);
    bb.on("finish", () => {
      if (tooBig) reject(Object.assign(new Error("file"), { code: "LIMIT" }));
      else resolve({ fields, file });
    });
    req.pipe(bb);
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { ok: false, erro: "Método não permitido" });
  if (!origemOk(req)) return json(res, 403, { ok: false, erro: "Origem inválida" });
  if (!rateOk(req, "insc", 20, 60_000)) return json(res, 429, { ok: false, erro: "Muitas tentativas" });

  const ctype = String(req.headers["content-type"] || "");
  if (!ctype.toLowerCase().includes("multipart/form-data")) {
    return json(res, 400, { ok: false, erro: "Envio inválido" });
  }

  let parsed;
  try {
    parsed = await parseMultipart(req);
  } catch (err) {
    if (err && err.code === "LIMIT") return json(res, 413, { ok: false, erro: "Comprovante acima de 5 MB" });
    return json(res, 400, { ok: false, erro: "Envio inválido" });
  }

  const campo = (nome) => String(parsed.fields[nome] || "").trim();
  if (campo("valor") || campo("chave") || campo("payload") || campo("modalidade")) {
    return json(res, 400, { ok: false, erro: "Campos não permitidos" });
  }

  const nome = campo("nome").slice(0, 120);
  const whatsapp = campo("whatsapp").slice(0, 20);
  const indicacao = (campo("indicacao") || "Ninguém / não informado").slice(0, 80);
  const modalidadeId = campo("modalidade_id");
  const token = campo("pix_token");
  let origem = campo("origem");
  if (origem !== "pix" && origem !== "cartao") origem = "pix";

  if (!ID_OK.test(modalidadeId) || !INGRESSOS[modalidadeId]) {
    return json(res, 400, { ok: false, erro: "Modalidade inválida" });
  }
  if (!pixTokenValido(modalidadeId, token)) {
    return json(res, 403, { ok: false, erro: "Pix inválido ou expirado. Recarregue a página." });
  }
  if (nome.length < 3) return json(res, 400, { ok: false, erro: "Informe o nome completo" });
  const digits = whatsapp.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 11) {
    return json(res, 400, { ok: false, erro: "Informe o WhatsApp com DDD" });
  }

  const ingresso = INGRESSOS[modalidadeId];
  const inscricaoId = crypto.randomBytes(8).toString("hex");
  let comprovanteArquivo = "";
  let comprovanteNome = "";
  const arquivo = parsed.file;
  if (arquivo && arquivo.filename) {
    const original = arquivo.filename.split(/[/\\]/).pop() || "";
    const ext = original.includes(".") ? `.${original.split(".").pop().toLowerCase()}` : "";
    if (!TIPOS[ext]) return json(res, 400, { ok: false, erro: "Envie JPG, PNG, WEBP ou PDF" });
    if (arquivo.data.length > MAX) return json(res, 413, { ok: false, erro: "Comprovante acima de 5 MB" });
    comprovanteArquivo = `comprovantes/${inscricaoId}${ext}`;
    comprovanteNome = original;
    try {
      await salvarArquivo(comprovanteArquivo, arquivo.data, TIPOS[ext]);
    } catch (_) {
      return json(res, 503, { ok: false, erro: "Não foi possível salvar o comprovante." });
    }
  }

  const item = {
    id: inscricaoId,
    criado_em: new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }),
    nome,
    whatsapp,
    indicacao,
    modalidade_id: ingresso.id,
    modalidade: ingresso.nome,
    valor: ingresso.valor,
    origem,
    comprovante_arquivo: comprovanteArquivo,
    comprovante_nome_original: comprovanteNome,
    status: "pendente",
  };

  try {
    const lista = await lerInscricoes();
    lista.push(item);
    await gravarInscricoes(lista);
  } catch (_) {
    return json(res, 503, { ok: false, erro: "Não foi possível salvar a inscrição." });
  }
  return json(res, 200, { ok: true, id: inscricaoId, valor: ingresso.valor });
};
