"use strict";

const { assinar, corpoBuffer } = require("./store-auth");

const STORE = "https://tiktok-experience-store.vercel.app";

function segredo() {
  const valor = (process.env.ADMIN_SENHA || "").trim();
  if (!valor) throw new Error("senha");
  return valor;
}

async function enviar(op, arquivo, body, contentType) {
  const buf = corpoBuffer(body);
  const ts = String(Date.now());
  const url = new URL("/api/store", STORE);
  url.searchParams.set("op", op);
  if (arquivo) url.searchParams.set("arquivo", arquivo);
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), 20000);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": contentType || "application/octet-stream",
        "x-store-ts": ts,
        "x-store-sig": assinar(segredo(), ts, op, arquivo || "", buf),
      },
      body: buf,
      signal: controle.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  return res;
}

async function jsonOp(op, dados) {
  const res = await enviar(op, "", Buffer.from(dados ? JSON.stringify(dados) : ""), "application/json");
  const texto = await res.text();
  let payload = {};
  try {
    payload = texto ? JSON.parse(texto) : {};
  } catch (_) {
    payload = {};
  }
  if (!res.ok || payload.ok === false) {
    throw new Error(payload.erro || "armazenamento");
  }
  return payload;
}

async function lerInscricoes() {
  const payload = await jsonOp("lerInscricoes");
  return Array.isArray(payload.inscricoes) ? payload.inscricoes : [];
}

async function gravarItem(item) {
  await jsonOp("gravarItem", { item });
}

async function gravarInscricoes(lista) {
  await jsonOp("gravarInscricoes", { lista });
}

async function lerParceiros() {
  const payload = await jsonOp("lerParceiros");
  return payload.parceiros || {};
}

async function gravarParceiros(nomes) {
  await jsonOp("gravarParceiros", { nomes });
}

async function salvarArquivo(pathname, data, contentType) {
  const res = await enviar("salvarArquivo", pathname, data, contentType || "application/octet-stream");
  if (!res.ok) {
    let erro = "arquivo";
    try {
      erro = (await res.json()).erro || erro;
    } catch (_) {}
    throw new Error(erro);
  }
}

async function lerArquivo(pathname) {
  const res = await enviar("lerArquivo", pathname, Buffer.alloc(0), "application/octet-stream");
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("arquivo");
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType: res.headers.get("content-type") || "application/octet-stream" };
}

module.exports = {
  lerInscricoes,
  gravarItem,
  gravarInscricoes,
  lerParceiros,
  gravarParceiros,
  salvarArquivo,
  lerArquivo,
};
