# Plataforma de Conversão de PDF em Audiobook

Aplicação web responsiva para converter PDFs em audiobooks com autenticação, controle de acesso por perfil e biblioteca protegida por permissão.

## Visão Geral

O sistema atende os perfis `Admin` e `Usuário` e cobre o fluxo completo de cadastro, login, upload de PDFs, conversão em faixas de áudio, distribuição de acesso, reprodução protegida e monitoramento de processamento.

## Principais Recursos

- Cadastro com e-mail único, senha com hash e perfil padrão de usuário
- Login com token JWT e redirecionamento por perfil
- Proteção de rotas no backend e no frontend
- Upload de um ou mais PDFs por administrador
- Processamento automático com geração de faixas por página ou por capítulos detectados
- Biblioteca do usuário com streaming protegido por autorização
- Concessão e revogação de acesso por usuário
- Status de processamento com logs e feedback visual
- OCR best-effort para PDFs escaneados quando as dependências do sistema estiverem instaladas

## Stack

- Backend: FastAPI, PyJWT, pdfplumber, MongoDB, Pillow, pytesseract, pdf2image
- Frontend: HTML, CSS e JavaScript
- Infra: Vercel para publicação estática e rota de API

## Estrutura do Projeto

- `backend/text-to-speak/`: API FastAPI, modelo de dados e pipeline de conversão
- `frontend/`: páginas HTML, CSS e JavaScript
- `api/`: camada de deploy para Vercel
- `.github/workflows/`: CI do repositório

## Requisitos

- Python 3.12+
- MongoDB
- Dependências de OCR em produção: `tesseract-ocr` e `poppler-utils`
- Git LFS (para arquivos grandes de modelo de voz)

## Configuração Inicial

1. Copie `backend/text-to-speak/.env.example` para `backend/text-to-speak/.env`.
2. Ajuste `MONGO_URI`, `JWT_SECRET`, `CORS_ORIGINS` e os parâmetros de processamento.
3. Inicialize o Git LFS no repositório.
4. Instale as dependências do backend.

```bash
git lfs install
git lfs pull
```

## Executar Localmente

Backend:

```bash
cd backend/text-to-speak
python -m pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Frontend:

```bash
cd frontend
python -m http.server 5500
```

Ambiente completo:

```bash
.\start-dev.ps1
```

Parar ambiente:

```bash
.\stop-dev.ps1
```

## Testes

```bash
cd backend/text-to-speak
python -m pytest tests -q
```

## OCR

O OCR é executado em modo best-effort. Se a página do PDF não contiver texto nativo, o backend tenta converter a página em imagem e extrair o conteúdo via Tesseract. Quando as dependências de sistema não estiverem disponíveis, o documento é marcado como `Necessita OCR`.

## Publicação no GitHub

O repositório já inclui:

- workflow de CI em [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
- testes automatizados em `backend/text-to-speak/tests/`
- documentação de backlog em [`backlog-produto.md`](backlog-produto.md)
- checklist de validação em [`checklist-backlog.md`](checklist-backlog.md)
- comandos mais relevantes em [`comandos-relevantes.txt`](comandos-relevantes.txt)

## Deploy

Consulte [`DEPLOY_VERCEL.md`](DEPLOY_VERCEL.md) para instruções de publicação.

## Status de Entrega

Todos os requisitos documentados no backlog foram implementados ou contemplados pela documentação, com validação automatizada de backend executada com sucesso.