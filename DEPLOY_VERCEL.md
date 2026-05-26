# Deploy de Produção no Vercel

## Visão geral

- Frontend estático servido pelo Vercel.
- Endpoint `/api/*` no Vercel encaminha para o backend real via função serverless.
- Backend (FastAPI + conversão de áudio) deve ficar em um host com suporte a processamento e armazenamento persistente.

## Arquivos já preparados

- `vercel.json`: roteamento do projeto no Vercel.
- `api/[...path].js`: proxy serverless de `/api/*` para seu backend.
- `frontend/config.js`: define URL da API automaticamente.
  - Local: `http://127.0.0.1:8000`
  - Produção: `/api`
- `backend/text-to-speak/.env.example`: template de variáveis do backend.

## Variáveis de ambiente no Vercel

Configure no projeto Vercel:

- `BACKEND_API_URL`
  - Exemplo: `https://api.seudominio.com`
  - Sem barra no final (o proxy já trata isso)

## Variáveis do backend em produção

Baseie-se em `backend/text-to-speak/.env.example` e configure:

- `JWT_SECRET`
- `MONGO_URI`
- `CORS_ORIGINS`
  - Exemplo: `https://seu-frontend.vercel.app,https://www.seudominio.com`

## Publicação

1. Suba o repositório para GitHub.
2. No Vercel, importe o repositório.
3. Defina a variável `BACKEND_API_URL`.
4. Faça deploy.

## Testes pós-deploy

1. Abra a URL do Vercel e valide login/cadastro.
2. Valide listagem da biblioteca.
3. Valide upload (usuário/admin) e status.
4. Valide streaming no player e retomada.
5. Valide permissões (conceder/revogar).

## Observação importante

Este projeto usa processamento pesado de áudio e escrita em disco local no backend. Em produção, mantenha o backend fora do ambiente serverless do Vercel para evitar limitações de tempo de execução e armazenamento efêmero.