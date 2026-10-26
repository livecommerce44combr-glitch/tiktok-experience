"use strict";

const crypto = require("crypto");

const CHAVE_PIX = "arcanodigital.com.br@gmail.com";
const PIX_RECEBEDOR = "TIKTOK EXPERIENCE CN";
const PIX_CIDADE = "GOIANIA";
const PIX_TOKEN_TTL = 30 * 60;
const ID_OK = /^[a-z0-9-]{3,40}$/;
const WHATSAPP_NUMERO = String(process.env.WHATSAPP_NUMERO || "5562981201160").replace(/\D/g, "");
const RATE = new Map();

const INGRESSOS = {
  "primeiro-lote": {
    id: "primeiro-lote",
    nome: "1º lote",
    valor: "R$ 49,90",
    valor_numero: "49.90",
    label: "1º lote — R$ 49,90",
  },
  "combo-2": {
    id: "combo-2",
    nome: "Combo 2 ingressos",
    valor: "R$ 69,90",
    valor_numero: "69.90",
    label: "Combo 2 ingressos — R$ 69,90",
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
  const env = String(process.env.PIX_HMAC_SECRET || process.env.ADMIN_SENHA || "").trim();
  if (env) return env;
  if (process.env.VERCEL) {
    return `${process.env.VERCEL_ENV || ""}|${process.env.VERCEL_URL || ""}`;
  }
  return "dev-only-local-pix-hmac";
}

function pixAssinatura(modalidadeId, payload, expira) {
  return crypto
    .createHmac("sha256", hmacSecret())
    .update(`${modalidadeId}|${payload}|${expira}|${CHAVE_PIX}|${WHATSAPP_NUMERO}`)
    .digest("hex");
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
  const host = String(req.headers.host || "")
    .split(":")[0]
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host)) return "";
  return host;
}

function hostsPermitidos() {
  return String(process.env.ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, "").split(":")[0])
    .filter(Boolean);
}

function origemOk(req) {
  const host = requestHost(req);
  if (!host) return false;
  const extra = hostsPermitidos();
  if (extra.length && !extra.includes(host) && host !== "localhost" && host !== "127.0.0.1") return false;

  const origin = String(req.headers.origin || "").trim();
  const referer = String(req.headers.referer || "").trim();
  const origemHost = origin ? hostnameDe(origin) : hostnameDe(referer);
  if (!origemHost) return false;
  return origemHost === host;
}

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  if (xf && /^[\d.:a-fA-F]+$/.test(xf)) return xf;
  return "0";
}

function rateOk(req, chave, limite, janelaMs) {
  const id = `${chave}:${clientIp(req)}`;
  const agora = Date.now();
  const fila = (RATE.get(id) || []).filter((t) => t > agora - janelaMs);
  if (fila.length >= limite) {
    RATE.set(id, fila);
    return false;
  }
  fila.push(agora);
  RATE.set(id, fila);
  return true;
}

function cabecalhosSeguros(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cache-Control", "no-store");
}

function json(res, code, payload) {
  res.statusCode = code;
  cabecalhosSeguros(res);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

module.exports = {
  CHAVE_PIX,
  ID_OK,
  INGRESSOS,
  PIX_TOKEN_TTL,
  WHATSAPP_NUMERO,
  json,
  montarPix,
  extrairChave,
  origemOk,
  pixAssinatura,
  pixTokenValido,
  requestHost,
  rateOk,
};
