"use strict";

const crypto = require("crypto");

const COOKIE = "admin_token";
const TTL = 60 * 60 * 12;
const FALLBACK_SHA256 = "5bdafda5a2d90c34171928bd21a8e130904f36e811465d84af9eadb8f4565aee";

function sha256buf(texto) {
  return crypto.createHash("sha256").update(String(texto), "utf8").digest();
}

function iguais(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function senhaOk(tentativa) {
  if (!tentativa || String(tentativa).length > 200) return false;
  const env = (process.env.ADMIN_SENHA || "").trim();
  if (env) return iguais(sha256buf(tentativa), sha256buf(env));
  return iguais(sha256buf(tentativa), Buffer.from(FALLBACK_SHA256, "hex"));
}

function sessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_SENHA || FALLBACK_SHA256;
}

function assinar(exp, nonce) {
  return crypto.createHmac("sha256", sessionSecret()).update(`${exp}.${nonce}`).digest("hex");
}

function criarToken() {
  const exp = String(Math.floor(Date.now() / 1000) + TTL);
  const nonce = crypto.randomBytes(16).toString("hex");
  return `${exp}.${nonce}.${assinar(exp, nonce)}`;
}

function tokenValido(token) {
  const partes = String(token || "").split(".");
  if (partes.length !== 3) return false;
  const [expS, nonce, sig] = partes;
  if (!/^\d+$/.test(expS) || nonce.length !== 32 || !/^[a-f0-9]{64}$/.test(sig)) return false;
  if (Number(expS) < Math.floor(Date.now() / 1000)) return false;
  const esperado = assinar(expS, nonce);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(esperado, "utf8"));
  } catch (_) {
    return false;
  }
}

function cookieDe(req) {
  const raw = String(req.headers.cookie || "");
  const m = raw.match(/(?:^|;\s*)admin_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

function setCookie(res, token, maxAge) {
  const partes = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ];
  if (process.env.VERCEL) partes.push("Secure");
  res.setHeader("Set-Cookie", partes.join("; "));
}

function adminOk(req) {
  return tokenValido(cookieDe(req));
}

module.exports = { senhaOk, criarToken, adminOk, setCookie, TTL };
