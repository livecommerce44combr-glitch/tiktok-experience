"use strict";

const { put, get } = require("@vercel/blob");

const LISTA = "admin/inscricoes.json";

async function streamToString(stream) {
  return Buffer.from(await new Response(stream).arrayBuffer()).toString("utf8");
}

async function lerInscricoes() {
  try {
    const blob = await get(LISTA, { access: "private", useCache: false });
    if (!blob || blob.statusCode !== 200 || !blob.stream) return [];
    const dados = JSON.parse(await streamToString(blob.stream));
    return Array.isArray(dados) ? dados : [];
  } catch (_) {
    return [];
  }
}

async function gravarInscricoes(lista) {
  await put(LISTA, JSON.stringify(lista), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

async function salvarArquivo(pathname, data, contentType) {
  await put(pathname, data, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
    cacheControlMaxAge: 60,
  });
}

async function lerArquivo(pathname) {
  const blob = await get(pathname, { access: "private", useCache: false });
  if (!blob || blob.statusCode !== 200 || !blob.stream) return null;
  const buffer = Buffer.from(await new Response(blob.stream).arrayBuffer());
  return { buffer, contentType: blob.blob.contentType || "application/octet-stream" };
}

module.exports = { lerInscricoes, gravarInscricoes, salvarArquivo, lerArquivo };
