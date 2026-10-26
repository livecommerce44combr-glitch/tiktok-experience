"use strict";

const { put, get, list } = require("@vercel/blob");

const LISTA = "admin/inscricoes.json";
const PREFIXO_ITEM = "admin/inscricoes/";
const ITEM_OK = /^admin\/inscricoes\/([a-f0-9]{16})\.json$/;
const PARCEIROS = "admin/parceiros.json";
const PARCEIRO_IDS = ["1", "2", "3", "4", "5"];

async function streamToString(stream) {
  return Buffer.from(await new Response(stream).arrayBuffer()).toString("utf8");
}

async function lerListaLegada() {
  try {
    const blob = await get(LISTA, { access: "private", useCache: false });
    if (!blob || blob.statusCode !== 200 || !blob.stream) return [];
    const dados = JSON.parse(await streamToString(blob.stream));
    return Array.isArray(dados) ? dados : [];
  } catch (_) {
    return [];
  }
}

async function lerItemBlob(blob) {
  const match = ITEM_OK.exec(blob.pathname || "");
  if (!match) return null;
  try {
    const baixado = await get(blob.pathname, { access: "private", useCache: false });
    if (!baixado || baixado.statusCode !== 200 || !baixado.stream) return null;
    const dados = JSON.parse(await streamToString(baixado.stream));
    if (!dados || dados.id !== match[1]) return null;
    return dados;
  } catch (_) {
    return null;
  }
}

async function lerItensIndividuais() {
  const itens = [];
  let cursor;
  try {
    do {
      const opcoes = { prefix: PREFIXO_ITEM, limit: 1000, mode: "expanded" };
      if (cursor) opcoes.cursor = cursor;
      const pagina = await list(opcoes);
      const arquivos = (pagina.blobs || []).filter((item) => ITEM_OK.test(item.pathname || ""));
      for (let i = 0; i < arquivos.length; i += 20) {
        const lidos = await Promise.all(arquivos.slice(i, i + 20).map(lerItemBlob));
        itens.push(...lidos.filter(Boolean));
      }
      cursor = pagina.hasMore ? pagina.cursor : undefined;
    } while (cursor);
  } catch (_) {
    return itens;
  }
  return itens;
}

async function listarPrefixo(prefix) {
  const itens = [];
  let cursor;
  do {
    const opcoes = { prefix, limit: 1000, mode: "expanded" };
    if (cursor) opcoes.cursor = cursor;
    const pagina = await list(opcoes);
    itens.push(...(pagina.blobs || []));
    cursor = pagina.hasMore ? pagina.cursor : undefined;
  } while (cursor);
  return itens;
}

function idDoComprovante(pathname) {
  const nome = String(pathname || "").split("/").pop() || "";
  const match = /^([a-f0-9]{16})\.(jpe?g|png|webp|pdf|heic|heif)$/i.exec(nome);
  return match ? match[1].toLowerCase() : "";
}

function dataDoArquivo(uploadedAt) {
  const data = uploadedAt ? new Date(uploadedAt) : null;
  if (!data || Number.isNaN(data.getTime())) return "";
  return data.toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

async function incluirComprovantesSemFicha(porId) {
  let arquivos = [];
  try {
    arquivos = await listarPrefixo("comprovantes/");
  } catch (_) {
    return 0;
  }
  const porArquivo = new Map();
  arquivos.forEach((blob) => {
    const id = idDoComprovante(blob.pathname);
    if (!id) return;
    const anterior = porArquivo.get(id);
    const atualMs = new Date(blob.uploadedAt || 0).getTime();
    const anteriorMs = anterior ? new Date(anterior.uploadedAt || 0).getTime() : -1;
    if (!anterior || atualMs >= anteriorMs) porArquivo.set(id, blob);
  });
  let recuperados = 0;
  for (const [id, blob] of porArquivo) {
    const atual = porId.get(id);
    if (atual && atual.comprovante_arquivo) continue;
    const item = atual
      ? { ...atual }
      : {
          id,
          criado_em: dataDoArquivo(blob.uploadedAt),
          nome: "Comprovante recuperado",
          whatsapp: "",
          indicacao: "Arquivo encontrado sem a ficha no painel",
          parceiro_id: "",
          modalidade_id: "primeiro-lote",
          modalidade: "1º lote",
          valor: "R$ 49,90",
          origem: "pix",
          status: "pendente",
        };
    item.comprovante_arquivo = blob.pathname;
    if (!item.comprovante_nome_original) {
      item.comprovante_nome_original = String(blob.pathname || "").split("/").pop() || "";
    }
    try {
      await gravarItem(item);
    } catch (_) {
      continue;
    }
    porId.set(id, item);
    recuperados += 1;
  }
  return recuperados;
}

async function lerInscricoes() {
  const [legado, individuais] = await Promise.all([lerListaLegada(), lerItensIndividuais()]);
  const porId = new Map();
  legado.forEach((item) => {
    if (item && item.id) porId.set(item.id, item);
  });
  individuais.forEach((item) => porId.set(item.id, item));
  await incluirComprovantesSemFicha(porId);
  return [...porId.values()].sort((a, b) => String(a.criado_em || "").localeCompare(String(b.criado_em || "")));
}

async function gravarItem(item) {
  if (!item || !/^[a-f0-9]{16}$/.test(item.id)) throw new Error("id");
  await put(`${PREFIXO_ITEM}${item.id}.json`, JSON.stringify(item), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 0,
  });
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
  if (!nomes["1"]) nomes["1"] = "marladammas";
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
  gravarItem,
  lerParceiros,
  gravarParceiros,
  nomeParceiroLimpo,
  normalizarParceiros,
  salvarArquivo,
  lerArquivo,
};
