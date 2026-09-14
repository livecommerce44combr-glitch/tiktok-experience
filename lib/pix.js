"use strict";

const crypto = require("crypto");

const CHAVE_PIX = "nutratechdigital@gmail.com";
const PIX_RECEBEDOR = "LIVE COMMERCE 44";
const PIX_CIDADE = "GOIANIA";
const PIX_TOKEN_TTL = 30 * 60;
const ID_OK = /^[a-z0-9-]{3,40}$/;

const INGRESSOS = {
  "basic-individual": {
    id: "basic-individual",
    nome: "Basic · Individual",
    valor: "R$ 97,00",
    valor_numero: "97.00",
    label: "Basic · Individual — R$ 97,00",
  },
  "basic-duplo": {
    id: "basic-duplo",
    nome: "Basic · Duplo",
    valor: "R$ 147,00",
    valor_numero: "147.00",
    label: "Basic · Duplo 🔥 — R$ 147,00",
  },
  "premium-individual": {
    id: "premium-individual",
    nome: "Premium · Individual",
    valor: "R$ 297,00",
    valor_numero: "297.00",
    label: "Premium · Individual — R$ 297,00",
  },
  "premium-duplo": {
    id: "premium-duplo",
    nome: "Premium · Duplo",
    valor: "R$ 397,00",
    valor_numero: "397.00",
    label: "Premium · Duplo — R$ 397,00",
  },
  patrocinador: {
    id: "patrocinador",
    nome: "Cota Patrocinador · até 5 pessoas",
    valor: "R$ 597,00",
    valor_numero: "597.00",
    label: "Cota Patrocinador · até 5 pessoas — R$ 597,00",
  },
};

function tlv(ident, valor) {
  const texto = String(valor);
  return ident + String(texto.length).padStart(2, "0") + texto;
}

function crc16Pix(texto) {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function extrairChave(payload) {
  const gui = "br.gov.bcb.pix";
  const pos = payload.indexOf(gui);
  if (pos < 0) return "";
  const depois = pos + gui.length;
  if (payload.slice(depois, depois + 2) !== "01") return "";
  const tamanho = parseInt(payload.slice(depois + 2, depois + 4), 10);
  if (!tamanho) return "";
  return payload.slice(depois + 4, depois + 4 + tamanho);
}

function montarPix(valorNumero) {
  const conta = tlv("00", "br.gov.bcb.pix") + tlv("01", CHAVE_PIX);
  const extra = tlv("05", "***");
  const corpo =
    tlv("00", "01") +
    tlv("26", conta) +
    tlv("52", "0000") +
    tlv("53", "986") +
    tlv("54", valorNumero) +
    tlv("58", "BR") +
    tlv("59", PIX_RECEBEDOR) +
    tlv("60", PIX_CIDADE) +
    tlv("62", extra) +
    "6304";
  const payload = corpo + crc16Pix(corpo);
  if (extrairChave(payload) !== CHAVE_PIX) {
    throw new Error("Falha ao montar Pix");
  }
  return payload;
}

function hmacSecret() {
  return process.env.PIX_HMAC_SECRET || process.env.ADMIN_SENHA || "livecommerce44-pix-hmac";
}

function pixAssinatura(modalidadeId, payload, expira) {
  return crypto.createHmac("sha256", hmacSecret()).update(`${modalidadeId}|${payload}|${expira}`).digest("hex");
}

function pixTokenValido(modalidadeId, token) {
  if (!token || token.split(".").length !== 2) return false;
  const [expiraS, assinatura] = token.split(".");
  if (!/^\d+$/.test(expiraS) || !/^[a-f0-9]{64}$/.test(assinatura)) return false;
  const expira = Number(expiraS);
  const agora = Math.floor(Date.now() / 1000);
  if (expira < agora || expira > agora + PIX_TOKEN_TTL + 60) return false;
  const ingresso = INGRESSOS[modalidadeId];
  if (!ingresso) return false;
  const payload = montarPix(ingresso.valor_numero);
  const esperado = pixAssinatura(modalidadeId, payload, expiraS);
  try {
    return crypto.timingSafeEqual(Buffer.from(assinatura, "utf8"), Buffer.from(esperado, "utf8"));
  } catch (_) {
    return false;
  }
}

function hostnameDe(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_) {
    return "";
  }
}

function requestHost(req) {
  const forwarded = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const host = (forwarded || req.headers.host || "").split(":")[0].trim().toLowerCase();
  return host;
}

function origemOk(req) {
  const host = requestHost(req);
  if (!host) return false;
  const origin = String(req.headers.origin || "").trim();
  if (origin) return hostnameDe(origin) === host;
  const referer = String(req.headers.referer || "").trim();
  if (referer) return hostnameDe(referer) === host;
  return true;
}

function json(res, code, payload) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

module.exports = {
  CHAVE_PIX,
  ID_OK,
  INGRESSOS,
  PIX_TOKEN_TTL,
  json,
  montarPix,
  extrairChave,
  origemOk,
  pixAssinatura,
  pixTokenValido,
  requestHost,
};
