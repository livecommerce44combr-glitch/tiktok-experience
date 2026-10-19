"use strict";

const { put, get } = require("@vercel/blob");

const LISTA = "admin/inscricoes.json";
const PARCEIROS = "admin/parceiros.json";
const PARCEIRO_IDS = ["1", "2", "3", "4", "5"];

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

function nomeParceiroLimpo(nome) {
  return String(nome || "").replace(/\s+/g, " ").trim().slice(0, 60);
}

function normalizarParceiros(dados) {
  const origem = dados && typeof dados === "object" && !Array.isArray(dados) ? dados : {};
  const nomes = {};
  PARCEIRO_IDS.forEach((id) => {
    nomes[id] = nomeParceiroLimpo(origem[id]);
  });
  return nomes;
}

async function lerParceiros() {
  try {
    const blob = await get(PARCEIROS, { access: "private", useCache: false });
    if (!blob || blob.statusCode !== 200 || !blob.stream) return normalizarParceiros({});
    return normalizarParceiros(JSON.parse(await streamToString(blob.stream)));
  } catch (_) {
    return normalizarParceiros({});
  }
}

async function gravarParceiros(nomes) {
  await put(PARCEIROS, JSON.stringify(normalizarParceiros(nomes)), {
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

module.exports = {
  PARCEIRO_IDS,
  lerInscricoes,
  gravarInscricoes,
  lerParceiros,
  gravarParceiros,
  nomeParceiroLimpo,
  normalizarParceiros,
  salvarArquivo,
  lerArquivo,
};
