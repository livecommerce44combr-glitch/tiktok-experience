"use strict";

const local = require("./blob-store");
const remoto = require("./remoto");

function usarLocal() {
  if (process.env.ARMAZEM === "local") return true;
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function escolher() {
  return usarLocal() ? local : remoto;
}

module.exports = {
  PARCEIRO_IDS: local.PARCEIRO_IDS,
  nomeParceiroLimpo: local.nomeParceiroLimpo,
  normalizarParceiros: local.normalizarParceiros,
  lerInscricoes: (...args) => escolher().lerInscricoes(...args),
  gravarInscricoes: (...args) => escolher().gravarInscricoes(...args),
  gravarItem: (...args) => escolher().gravarItem(...args),
  lerParceiros: (...args) => escolher().lerParceiros(...args),
  gravarParceiros: (...args) => escolher().gravarParceiros(...args),
  salvarArquivo: (...args) => escolher().salvarArquivo(...args),
  lerArquivo: (...args) => escolher().lerArquivo(...args),
};
