#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Servidor da inscrição TikTok Experience Caldas Novas + painel admin."""

# ============================================================
# REVISAR ANTES DE PUBLICAR
# ============================================================
PORTA = 8766
CHAVE_PIX = "arcanodigital.com.br@gmail.com"
WHATSAPP_NUMERO = "5562981201160"
PIX_RECEBEDOR = "TIKTOK EXPERIENCE CN"
PIX_CIDADE = "GOIANIA"
HOSTS_LOCAIS = {"127.0.0.1", "localhost"}
# Senha do admin: variável ADMIN_SENHA ou arquivo .admin_password (fora do git)
# ============================================================

import cgi
import hashlib
import hmac
import json
import os
import posixpath
import re
import secrets
import threading
import time
import urllib.parse
from collections import defaultdict, deque
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "inscricoes.json"
PARCEIROS_FILE = ROOT / "parceiros.json"
UPLOADS = ROOT / "uploads"
SECRET_FILE = ROOT / ".admin_secret"
PASSWORD_FILE = ROOT / ".admin_password"
WHATSAPP_NUMERO = "".join(ch for ch in os.environ.get("WHATSAPP_NUMERO", WHATSAPP_NUMERO) if ch.isdigit())
EXT_BLOQUEADAS = {".py", ".json", ".secret", ".md", ".gitignore"}
ARQUIVOS_BLOQUEADOS = {"inscricoes.json", "parceiros.json", ".admin_secret", ".admin_password", "server.py", ".gitignore"}
PARCEIRO_IDS = ("1", "2", "3", "4", "5")
TIPOS_OK = {".jpg", ".jpeg", ".png", ".webp", ".pdf", ".heic", ".heif"}
MIME_EXT = {
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
}
INSCRICOES_LOCK = threading.Lock()
MAX_ARQUIVO = 5 * 1024 * 1024
PIX_TOKEN_TTL = 30 * 60
ID_OK = re.compile(r"^[a-z0-9-]{3,40}$")
HEX_OK = re.compile(r"^[a-f0-9]{16}$")

INGRESSOS = {
    "primeiro-lote": {"id": "primeiro-lote", "nome": "1º lote", "valor": "R$ 49,90", "valor_numero": "49.90", "label": "1º lote — R$ 49,90"},
    "combo-2": {"id": "combo-2", "nome": "Combo 2 ingressos", "valor": "R$ 69,90", "valor_numero": "69.90", "label": "Combo 2 ingressos — R$ 69,90"},
}

GET_API = {"/api/pix", "/api/ingressos", "/api/admin/inscricoes"}
POST_API = {"/api/inscricoes", "/api/admin/login", "/api/admin/logout"}

SESSOES = {}
TOKENS_PIX_USADOS = {}
RATE = defaultdict(lambda: deque())


def admin_senha():
    env = (os.environ.get("ADMIN_SENHA") or "").strip()
    if env:
        return env
    if PASSWORD_FILE.exists():
        return PASSWORD_FILE.read_text(encoding="utf-8").strip()
    return ""


def senha_admin_ok(tentativa):
    atual = admin_senha()
    if not atual or not tentativa:
        return False
    recebido = hashlib.sha256(tentativa.encode("utf-8")).digest()
    esperado = hashlib.sha256(atual.encode("utf-8")).digest()
    return hmac.compare_digest(recebido, esperado)


def secret():
    if SECRET_FILE.exists():
        return SECRET_FILE.read_bytes()
    valor = secrets.token_bytes(32)
    SECRET_FILE.write_bytes(valor)
    try:
        os.chmod(SECRET_FILE, 0o600)
    except OSError:
        pass
    return valor


def ler_inscricoes():
    if not DATA_FILE.exists():
        return []
    try:
        dados = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        return dados if isinstance(dados, list) else []
    except json.JSONDecodeError:
        return []


def gravar_inscricoes(lista):
    tmp = DATA_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(lista, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, DATA_FILE)


def extensao_por_assinatura(conteudo):
    if conteudo.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if conteudo.startswith(b"\x89PNG"):
        return ".png"
    if conteudo.startswith(b"%PDF-"):
        return ".pdf"
    if conteudo.startswith(b"RIFF") and conteudo[8:12] == b"WEBP":
        return ".webp"
    if len(conteudo) >= 12 and conteudo[4:8] == b"ftyp":
        marca = conteudo[8:12].lower()
        if marca.startswith(b"hei") or marca in (b"mif1", b"msf1"):
            return ".heic"
    return ""


def extensao_comprovante(nome, mime, conteudo):
    original = os.path.basename(nome or "")
    ext = extensao_por_assinatura(conteudo)
    if ext not in TIPOS_OK:
        ext = Path(original).suffix.lower()
    if ext not in TIPOS_OK:
        ext = MIME_EXT.get((mime or "").split(";")[0].strip().lower(), "")
    if ext not in TIPOS_OK:
        return "", original
    if not original:
        original = "comprovante" + ext
    return ext, original


def limpar_nome_parceiro(nome):
    return re.sub(r"\s+", " ", str(nome or "")).strip()[:60]


def ler_parceiros():
    nomes = {i: "" for i in PARCEIRO_IDS}
    dados = None
    if PARCEIROS_FILE.exists():
        try:
            dados = json.loads(PARCEIROS_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            dados = None
    if isinstance(dados, dict):
        for i in PARCEIRO_IDS:
            valor = dados.get(i, "")
            nomes[i] = limpar_nome_parceiro(valor if isinstance(valor, str) else "")
    if not nomes.get("1"):
        nomes["1"] = "marladammas"
    return nomes


def gravar_parceiros(nomes):
    limpos = {i: limpar_nome_parceiro(nomes.get(i, "")) for i in PARCEIRO_IDS}
    tmp = PARCEIROS_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(limpos, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, PARCEIROS_FILE)


def lista_parceiros(nomes):
    return [{"id": i, "nome": nomes[i]} for i in PARCEIRO_IDS]


def novo_token():
    token = secrets.token_urlsafe(32)
    SESSOES[token] = time.time() + 60 * 60 * 12
    return token


def sessao_valida(token):
    expira = SESSOES.get(token)
    if not expira or expira < time.time():
        SESSOES.pop(token, None)
        return False
    return True


def cookie_token(headers):
    raw = headers.get("Cookie")
    if not raw:
        return ""
    cookie = SimpleCookie()
    try:
        cookie.load(raw)
    except Exception:
        return ""
    morsel = cookie.get("admin_token")
    return morsel.value if morsel else ""


def tlv(ident, valor):
    valor = str(valor)
    return "%s%02d%s" % (ident, len(valor), valor)


def crc16_pix(texto):
    crc = 0xFFFF
    for ch in texto:
        crc ^= ord(ch) << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) if (crc & 0x8000) else (crc << 1)
            crc &= 0xFFFF
    return "%04X" % crc


def montar_pix(valor_numero):
    conta = tlv("00", "br.gov.bcb.pix") + tlv("01", CHAVE_PIX)
    extra = tlv("05", "***")
    corpo = (
        tlv("00", "01")
        + tlv("26", conta)
        + tlv("52", "0000")
        + tlv("53", "986")
        + tlv("54", valor_numero)
        + tlv("58", "BR")
        + tlv("59", PIX_RECEBEDOR)
        + tlv("60", PIX_CIDADE)
        + tlv("62", extra)
        + "6304"
    )
    return corpo + crc16_pix(corpo)


def pix_token(modalidade_id, payload, expira, ip):
    msg = ("%s|%s|%s|%s|%s|%s" % (modalidade_id, payload, expira, ip, CHAVE_PIX, WHATSAPP_NUMERO)).encode("utf-8")
    return hmac.new(secret(), msg, hashlib.sha256).hexdigest()


def limpar_tokens_pix():
    agora = time.time()
    vencidos = [chave for chave, expira in TOKENS_PIX_USADOS.items() if expira < agora]
    for chave in vencidos:
        TOKENS_PIX_USADOS.pop(chave, None)


def hash_token_pix(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def pix_token_valido(modalidade_id, token, ip):
    if not token or token.count(".") != 1:
        return False
    limpar_tokens_pix()
    if hash_token_pix(token) in TOKENS_PIX_USADOS:
        return False
    expira_s, assinatura = token.split(".", 1)
    if not expira_s.isdigit() or len(assinatura) != 64:
        return False
    expira = int(expira_s)
    agora = int(time.time())
    if expira < agora or expira > agora + PIX_TOKEN_TTL + 60:
        return False
    ingresso = INGRESSOS.get(modalidade_id)
    if not ingresso:
        return False
    payload = montar_pix(ingresso["valor_numero"])
    esperado = pix_token(modalidade_id, payload, expira_s, ip)
    return hmac.compare_digest(assinatura, esperado)


def marcar_token_pix_usado(token, expira_s):
    TOKENS_PIX_USADOS[hash_token_pix(token)] = int(expira_s)


def normalizar_rota(path):
    path = urllib.parse.unquote(path.split("?", 1)[0])
    if ".." in path or "\\" in path or path.startswith("//"):
        return None
    path = posixpath.normpath(path)
    if not path.startswith("/"):
        path = "/" + path
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    return path


def dentro_da_raiz(caminho):
    try:
        return str(Path(caminho).resolve()).startswith(str(ROOT.resolve()))
    except Exception:
        return False


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; "
            "form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
        )
        super().end_headers()

    def _request_host(self):
        host = (self.headers.get("Host") or "").split(":")[0].strip().lower()
        extra = {h.strip().lower() for h in os.environ.get("ALLOWED_HOSTS", "").split(",") if h.strip()}
        if extra:
            return host if host in extra or host in HOSTS_LOCAIS else ""
        if host in HOSTS_LOCAIS or re.match(r"^[a-z0-9.-]+$", host or ""):
            return host
        return ""

    def _host_ok(self):
        return bool(self._request_host())

    def _origem_ok(self):
        host = self._request_host()
        if not host:
            return False
        origem = (self.headers.get("Origin") or "").strip()
        if origem:
            parsed = urllib.parse.urlparse(origem)
            return (parsed.hostname or "").lower() == host
        referer = (self.headers.get("Referer") or "").strip()
        if referer:
            parsed = urllib.parse.urlparse(referer)
            return (parsed.hostname or "").lower() == host
        return False

    def _rate(self, chave, limite, janela):
        agora = time.time()
        fila = RATE[chave]
        while fila and fila[0] < agora - janela:
            fila.popleft()
        if len(fila) >= limite:
            return False
        fila.append(agora)
        return True

    def _json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _texto(self, code, texto):
        body = texto.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _admin_ok(self):
        return sessao_valida(cookie_token(self.headers))

    def _ip(self):
        return self.client_address[0]

    def do_PATCH(self):
        self._texto(405, "Método não permitido")

    def do_DELETE(self):
        self._texto(405, "Método não permitido")

    def do_TRACE(self):
        self._texto(405, "Método não permitido")

    def translate_path(self, path):
        convertido = super().translate_path(path)
        if not dentro_da_raiz(convertido):
            return str(ROOT / "index.html")
        return convertido

    def _alias_admin(self):
        parsed = urllib.parse.urlparse(self.path)
        path = normalizar_rota(parsed.path)
        if not path:
            return
        qs = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        if path == "/api/admin-status":
            inscricao_id = (qs.get("id") or [""])[0]
            if not HEX_OK.match(inscricao_id):
                inscricao_id = "x"
            self.path = "/api/admin/inscricoes/%s/status" % inscricao_id
            return
        if path == "/api/admin-comprovante":
            inscricao_id = (qs.get("id") or [""])[0]
            if not HEX_OK.match(inscricao_id):
                inscricao_id = "x"
            self.path = "/api/admin/comprovante/%s" % inscricao_id
            return
        mapa = {
            "/api/admin-login": "/api/admin/login",
            "/api/admin-logout": "/api/admin/logout",
            "/api/admin-inscricoes": "/api/admin/inscricoes",
            "/api/admin-parceiros": "/api/admin/parceiros",
        }
        if path in mapa:
            self.path = mapa[path]

    def do_GET(self):
        self._alias_admin()
        if not self._host_ok():
            return self._texto(403, "Host inválido")
        parsed = urllib.parse.urlparse(self.path)
        path = normalizar_rota(parsed.path)
        if path is None:
            return self._texto(400, "Rota inválida")

        if path.startswith("/api/"):
            if path == "/api/ingressos":
                if not self._origem_ok():
                    return self._json(403, {"ok": False, "erro": "Origem inválida"})
                lista = [{"id": i["id"], "nome": i["nome"], "valor": i["valor"], "label": i["label"]} for i in INGRESSOS.values()]
                return self._json(200, {"ok": True, "ingressos": lista, "whatsapp": WHATSAPP_NUMERO, "chave_pix": CHAVE_PIX})

            if path == "/api/pix":
                if not self._origem_ok():
                    return self._json(403, {"ok": False, "erro": "Origem inválida"})
                qs = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
                if set(qs.keys()) - {"modalidade"}:
                    return self._json(400, {"ok": False, "erro": "Parâmetros inválidos"})
                modalidade_id = (qs.get("modalidade") or [""])[0]
                if not ID_OK.match(modalidade_id) or modalidade_id not in INGRESSOS:
                    return self._json(400, {"ok": False, "erro": "Modalidade inválida"})
                if not self._rate("pix:" + self._ip(), 30, 60):
                    return self._json(429, {"ok": False, "erro": "Muitas tentativas"})
                ingresso = INGRESSOS[modalidade_id]
                payload = montar_pix(ingresso["valor_numero"])
                if CHAVE_PIX not in payload or ("5405" + ingresso["valor_numero"] not in payload and "5406" + ingresso["valor_numero"] not in payload):
                    return self._json(500, {"ok": False, "erro": "Falha ao montar Pix"})
                expira = str(int(time.time()) + PIX_TOKEN_TTL)
                token = "%s.%s" % (expira, pix_token(modalidade_id, payload, expira, self._ip()))
                return self._json(200, {
                    "ok": True,
                    "modalidade_id": ingresso["id"],
                    "nome": ingresso["nome"],
                    "valor": ingresso["valor"],
                    "chave": CHAVE_PIX,
                    "payload": payload,
                    "token": token,
                    "whatsapp": WHATSAPP_NUMERO,
                })

            if path == "/api/admin/inscricoes":
                if not self._admin_ok():
                    return self._json(401, {"ok": False, "erro": "Não autorizado"})
                return self._json(200, {"ok": True, "inscricoes": list(reversed(ler_inscricoes()))})

            if path == "/api/admin/parceiros":
                if not self._admin_ok():
                    return self._json(401, {"ok": False, "erro": "Não autorizado"})
                return self._json(200, {"ok": True, "parceiros": lista_parceiros(ler_parceiros())})

            if path.startswith("/api/admin/comprovante/"):
                if not self._admin_ok():
                    return self._json(401, {"ok": False, "erro": "Não autorizado"})
                inscricao_id = path.rsplit("/", 1)[-1]
                if not HEX_OK.match(inscricao_id):
                    return self._json(400, {"ok": False, "erro": "Identificador inválido"})
                item = next((i for i in ler_inscricoes() if i.get("id") == inscricao_id), None)
                arquivo = (item or {}).get("comprovante_arquivo") or ""
                if not arquivo or "/" in arquivo or ".." in arquivo:
                    return self._texto(404, "Comprovante não encontrado")
                destino = (UPLOADS / arquivo).resolve()
                if not str(destino).startswith(str(UPLOADS.resolve())) or not destino.exists():
                    return self._texto(404, "Arquivo não encontrado")
                data = destino.read_bytes()
                ext = destino.suffix.lower()
                tipos = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf", ".heic": "image/heic", ".heif": "image/heif"}
                self.send_response(200)
                self.send_header("Content-Type", tipos.get(ext, "application/octet-stream"))
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Content-Disposition", "inline; filename=\"comprovante%s\"" % ext)
                self.end_headers()
                self.wfile.write(data)
                return

            return self._json(404, {"ok": False, "erro": "Rota não encontrada"})

        if path in ("/admin", "/admin/"):
            self.path = "/admin.html"
            return SimpleHTTPRequestHandler.do_GET(self)

        if path.startswith("/uploads") or path.startswith("/."):
            return self._texto(403, "Acesso negado")
        nome = os.path.basename(path.rstrip("/") or "index.html")
        ext = Path(nome).suffix.lower()
        if nome in ARQUIVOS_BLOQUEADOS or ext in EXT_BLOQUEADAS:
            return self._texto(403, "Acesso negado")
        destino = ROOT / path.lstrip("/")
        if path not in ("/", "/index.html") and not destino.is_file():
            if ext in {".js", ".css", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".ico", ".woff", ".woff2", ".map", ".txt"}:
                return self._texto(404, "Não encontrado")
            self.path = "/index.html"
            return SimpleHTTPRequestHandler.do_GET(self)
        self.path = path
        return SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        self._alias_admin()
        if not self._host_ok() or not self._origem_ok():
            return self._texto(403, "Origem inválida")
        parsed = urllib.parse.urlparse(self.path)
        path = normalizar_rota(parsed.path)
        if path is None:
            return self._texto(400, "Rota inválida")
        length = int(self.headers.get("Content-Length") or 0)
        if length < 0 or length > MAX_ARQUIVO + 64_000:
            return self._json(413, {"ok": False, "erro": "Requisição grande demais"})

        if path == "/api/admin/login":
            if not self._rate("login:" + self._ip(), 8, 60):
                return self._json(429, {"ok": False, "erro": "Muitas tentativas"})
            bruto = self.rfile.read(length)
            try:
                dados = json.loads(bruto.decode("utf-8"))
            except json.JSONDecodeError:
                return self._json(400, {"ok": False, "erro": "JSON inválido"})
            senha = str(dados.get("senha") or "")
            if len(senha) > 200 or not senha_admin_ok(senha):
                time.sleep(0.4)
                return self._json(401, {"ok": False, "erro": "Senha incorreta"})
            token = novo_token()
            cookie = SimpleCookie()
            cookie["admin_token"] = token
            cookie["admin_token"]["httponly"] = True
            cookie["admin_token"]["path"] = "/"
            cookie["admin_token"]["samesite"] = "Strict"
            cookie["admin_token"]["max-age"] = 60 * 60 * 12
            body = json.dumps({"ok": True}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Set-Cookie", cookie["admin_token"].OutputString())
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/api/admin/logout":
            token = cookie_token(self.headers)
            SESSOES.pop(token, None)
            cookie = SimpleCookie()
            cookie["admin_token"] = ""
            cookie["admin_token"]["path"] = "/"
            cookie["admin_token"]["max-age"] = 0
            body = json.dumps({"ok": True}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Set-Cookie", cookie["admin_token"].OutputString())
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        partes = path.split("/")
        if len(partes) == 6 and partes[1:4] == ["api", "admin", "inscricoes"] and partes[5] == "status":
            if not self._admin_ok():
                return self._json(401, {"ok": False, "erro": "Não autorizado"})
            inscricao_id = partes[4]
            if not HEX_OK.match(inscricao_id):
                return self._json(400, {"ok": False, "erro": "Identificador inválido"})
            bruto = self.rfile.read(length)
            try:
                dados = json.loads(bruto.decode("utf-8"))
            except json.JSONDecodeError:
                return self._json(400, {"ok": False, "erro": "JSON inválido"})
            status = dados.get("status")
            if status not in ("pendente", "confirmado"):
                return self._json(400, {"ok": False, "erro": "Status inválido"})
            with INSCRICOES_LOCK:
                lista = ler_inscricoes()
                achou = False
                for item in lista:
                    if item.get("id") == inscricao_id:
                        item["status"] = status
                        achou = True
                        break
                if not achou:
                    return self._json(404, {"ok": False, "erro": "Inscrição não encontrada"})
                gravar_inscricoes(lista)
            return self._json(200, {"ok": True})

        if path == "/api/admin/parceiros":
            if not self._admin_ok():
                return self._json(401, {"ok": False, "erro": "Não autorizado"})
            bruto = self.rfile.read(length)
            try:
                dados = json.loads(bruto.decode("utf-8"))
            except json.JSONDecodeError:
                return self._json(400, {"ok": False, "erro": "JSON inválido"})
            recebidos = dados.get("nomes")
            if not isinstance(recebidos, dict):
                return self._json(400, {"ok": False, "erro": "Nomes inválidos"})
            atual = ler_parceiros()
            for i in PARCEIRO_IDS:
                if i not in recebidos:
                    continue
                if not isinstance(recebidos[i], str):
                    return self._json(400, {"ok": False, "erro": "Nome inválido"})
                atual[i] = limpar_nome_parceiro(recebidos[i])
            gravar_parceiros(atual)
            return self._json(200, {"ok": True, "parceiros": lista_parceiros(atual)})

        if path == "/api/inscricoes":
            if not self._rate("insc:" + self._ip(), 20, 60):
                return self._json(429, {"ok": False, "erro": "Muitas tentativas"})
            ctype = (self.headers.get("Content-Type") or "")
            if "multipart/form-data" not in ctype.lower():
                return self._json(400, {"ok": False, "erro": "Envio inválido"})
            env = {
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": ctype,
                "CONTENT_LENGTH": str(length),
            }
            form = cgi.FieldStorage(fp=self.rfile, headers=self.headers, environ=env, keep_blank_values=True)

            def campo(nome):
                valor = form.getfirst(nome, "")
                return str(valor).strip() if valor is not None else ""

            nome = campo("nome")[:120]
            whatsapp = campo("whatsapp")[:20]
            indicacao = (campo("indicacao") or "Ninguém / não informado")[:80]
            modalidade_id = campo("modalidade_id")
            token = campo("pix_token")
            parceiro_id = campo("parceiro")
            if parceiro_id and parceiro_id not in PARCEIRO_IDS:
                return self._json(400, {"ok": False, "erro": "Parceiro inválido"})
            origem = campo("origem")
            if origem not in ("pix", "cartao"):
                origem = "pix"
            if campo("valor") or campo("chave") or campo("payload") or campo("modalidade"):
                return self._json(400, {"ok": False, "erro": "Campos não permitidos"})

            if not ID_OK.match(modalidade_id) or modalidade_id not in INGRESSOS:
                return self._json(400, {"ok": False, "erro": "Modalidade inválida"})
            if not pix_token_valido(modalidade_id, token, self._ip()):
                return self._json(403, {"ok": False, "erro": "Pix inválido ou expirado. Recarregue a página."})
            ingresso = INGRESSOS[modalidade_id]
            if len(nome) < 3:
                return self._json(400, {"ok": False, "erro": "Informe o nome completo"})
            digits = "".join(ch for ch in whatsapp if ch.isdigit())
            if len(digits) < 10 or len(digits) > 11:
                return self._json(400, {"ok": False, "erro": "Informe o WhatsApp com DDD"})

            inscricao_id = secrets.token_hex(8)
            comprovante_nome = ""
            nome_original = ""
            arquivo = form["comprovante"] if "comprovante" in form else None
            tem_arquivo = (
                arquivo is not None
                and not isinstance(arquivo, list)
                and getattr(arquivo, "file", None) is not None
                and (getattr(arquivo, "filename", None) or getattr(arquivo, "type", ""))
            )
            if tem_arquivo:
                conteudo = arquivo.file.read()
                if not conteudo:
                    return self._json(400, {"ok": False, "erro": "Não foi possível ler o comprovante. Tente outra foto."})
                if len(conteudo) > MAX_ARQUIVO:
                    return self._json(413, {"ok": False, "erro": "Comprovante acima de 5 MB"})
                ext, nome_original = extensao_comprovante(
                    getattr(arquivo, "filename", "") or "",
                    getattr(arquivo, "type", "") or "",
                    conteudo,
                )
                if not ext:
                    return self._json(400, {"ok": False, "erro": "Envie uma foto (JPG, PNG, WEBP ou HEIC) ou PDF"})
                UPLOADS.mkdir(exist_ok=True)
                comprovante_nome = "%s%s" % (inscricao_id, ext)
                (UPLOADS / comprovante_nome).write_bytes(conteudo)

            item = {
                "id": inscricao_id,
                "criado_em": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
                "nome": nome,
                "whatsapp": whatsapp,
                "indicacao": indicacao,
                "parceiro_id": parceiro_id,
                "modalidade_id": ingresso["id"],
                "modalidade": ingresso["nome"],
                "valor": ingresso["valor"],
                "origem": origem,
                "comprovante_arquivo": comprovante_nome,
                "comprovante_nome_original": nome_original,
                "status": "pendente",
            }
            with INSCRICOES_LOCK:
                lista = ler_inscricoes()
                lista.append(item)
                gravar_inscricoes(lista)
            marcar_token_pix_usado(token, token.split(".", 1)[0])
            return self._json(200, {"ok": True, "id": inscricao_id, "valor": ingresso["valor"], "comprovante": bool(comprovante_nome)})

        return self._json(404, {"ok": False, "erro": "Rota não encontrada"})


def main():
    UPLOADS.mkdir(exist_ok=True)
    secret()
    if not admin_senha():
        raise SystemExit("Defina ADMIN_SENHA ou crie o arquivo .admin_password")
    bind = os.environ.get("BIND", "127.0.0.1")
    porta = int(os.environ.get("PORT", PORTA))
    server = ThreadingHTTPServer((bind, porta), Handler)
    print("TikTok Experience Caldas Novas")
    print("Inscrição: http://%s:%s/" % (bind, porta))
    print("Admin:     http://%s:%s/admin" % (bind, porta))
    server.serve_forever()


if __name__ == "__main__":
    main()
