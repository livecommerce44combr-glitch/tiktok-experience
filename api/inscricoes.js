"use strict";

const crypto = require("crypto");
const Busboy = require("busboy");
const { INGRESSOS, ID_OK, json, origemOk, pixTokenValido, rateOk } = require("../lib/pix");
const { gravarItem, salvarArquivo } = require("../lib/store");

const TIPOS = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".pdf": "application/pdf",
};
const MIME_EXT = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/pjpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/heic-sequence": ".heic",
  "image/heif-sequence": ".heif",
  "application/pdf": ".pdf",
};
const MAX = 5 * 1024 * 1024;

function extensaoPorAssinatura(data) {
  if (!data || data.length < 12) return "";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return ".jpg";
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return ".png";
  if (data.slice(0, 5).toString("latin1") === "%PDF-") return ".pdf";
  if (data.slice(0, 4).toString("latin1") === "RIFF" && data.slice(8, 12).toString("latin1") === "WEBP") return ".webp";
  if (data.slice(4, 8).toString("latin1") === "ftyp") {
    const marca = data.slice(8, 12).toString("latin1").toLowerCase();
    if (marca.startsWith("hei") || marca === "mif1" || marca === "msf1") return ".heic";
  }
  return "";
}

function extensaoComprovante(arquivo) {
  const original = String(arquivo.filename || "").split(/[/\\]/).pop() || "";
  let ext = extensaoPorAssinatura(arquivo.data);
  if (!TIPOS[ext]) {
    const ponto = original.lastIndexOf(".");
    if (ponto > 0) ext = original.slice(ponto).toLowerCase().replace(/[^a-z0-9.]/g, "");
  }
  if (!TIPOS[ext]) {
    const mime = String(arquivo.mimeType || "").split(";")[0].trim().toLowerCase();
    ext = MIME_EXT[mime] || "";
  }
  if (!TIPOS[ext]) return null;
  return { ext, nome: original || `comprovante${ext}` };
}

function enviarCorpo(req, bb) {
  const bruto = req.body;
  if (Buffer.isBuffer(bruto) && bruto.length) {
    bb.end(bruto);
    return;
  }
  if (bruto instanceof Uint8Array && bruto.byteLength) {
    bb.end(Buffer.from(bruto));
    return;
  }
  if (typeof req.pipe === "function") {
    req.pipe(bb);
    return;
  }
  (async () => {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    bb.end(Buffer.concat(chunks));
  })().catch((err) => bb.destroy(err));
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers, limits: { fileSize: MAX, files: 1, fields: 20 } });
    const fields = {};
    let file = null;
    let tooBig = false;
    const arquivos = [];
    bb.on("field", (name, val) => {
      fields[name] = val;
    });
    bb.on("file", (name, stream, info) => {
      const chunks = [];
      const meta = info && typeof info === "object" ? info : {};
      arquivos.push(new Promise((res, rej) => {
        stream.on("data", (c) => chunks.push(c));
        stream.on("limit", () => {
          tooBig = true;
        });
        stream.on("error", rej);
        stream.on("end", () => {
          file = {
            filename: meta.filename || (typeof info === "string" ? info : ""),
            mimeType: meta.mimeType || "",
            data: Buffer.concat(chunks),
          };
          res();
        });
      }));
    });
    bb.on("error", reject);
    bb.on("finish", () => {
      Promise.all(arquivos).then(() => {
        if (tooBig) reject(Object.assign(new Error("file"), { code: "LIMIT" }));
        else resolve({ fields, file });
      }, reject);
    });
    enviarCorpo(req, bb);
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
  const parceiroId = campo("parceiro");
  if (parceiroId && !/^[1-5]$/.test(parceiroId)) {
    return json(res, 400, { ok: false, erro: "Parceiro inválido" });
  }
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
  if (arquivo) {
    if (!arquivo.data || !arquivo.data.length) {
      return json(res, 400, { ok: false, erro: "Não foi possível ler o comprovante. Tente outra foto." });
    }
    const reconhecido = extensaoComprovante(arquivo);
    if (!reconhecido) return json(res, 400, { ok: false, erro: "Envie uma foto (JPG, PNG, WEBP ou HEIC) ou PDF" });
    if (arquivo.data.length > MAX) return json(res, 413, { ok: false, erro: "Comprovante acima de 5 MB" });
    comprovanteArquivo = `comprovantes/${inscricaoId}${reconhecido.ext}`;
    comprovanteNome = reconhecido.nome;
    try {
      await salvarArquivo(comprovanteArquivo, arquivo.data, TIPOS[reconhecido.ext]);
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
    parceiro_id: parceiroId,
    modalidade_id: ingresso.id,
    modalidade: ingresso.nome,
    valor: ingresso.valor,
    origem,
    comprovante_arquivo: comprovanteArquivo,
    comprovante_nome_original: comprovanteNome,
    status: "pendente",
  };

  try {
    await gravarItem(item);
  } catch (_) {
    return json(res, 503, { ok: false, erro: "Não foi possível salvar a inscrição." });
  }
  return json(res, 200, { ok: true, id: inscricaoId, valor: ingresso.valor, comprovante: Boolean(comprovanteArquivo) });
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
