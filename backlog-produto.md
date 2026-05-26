# Backlog do Produto

Projeto: Plataforma de Conversão de PDF em Audiobook com Controle de Acesso
Tipo: Aplicação Web Responsiva
Perfis: Admin e Usuário

## Objetivo

Entregar uma plataforma web responsiva para cadastro, autenticação, upload de PDFs, conversão em áudio, controle de acesso por usuário, biblioteca pessoal, player de áudio, administração de permissões, monitoramento de processamento e proteção de arquivos.

## Épico 1 - Autenticação e Controle de Acesso

### US-01 - Cadastro de Usuário
Como visitante
Quero me cadastrar no sistema
Para acessar minha biblioteca de áudios

Critérios de aceite:
- Validar e-mail único.
- Exigir senha com no mínimo 8 caracteres.
- Armazenar senha com hash criptográfico.
- Definir perfil padrão como Usuário.
- Após cadastro, redirecionar para a tela de login.

### US-02 - Login
Como usuário ou administrador
Quero fazer login
Para acessar o sistema conforme meu perfil

Critérios de aceite:
- Permitir login com e-mail e senha.
- Validar credenciais com segurança.
- Criar sessão ou token seguro com expiração.
- Redirecionar conforme o perfil.
- Admin deve ir para o dashboard administrativo.
- Usuário deve ir para a biblioteca.

### US-03 - Controle de Rotas por Perfil
Como sistema
Quero restringir acesso por perfil
Para impedir acesso indevido

Critérios de aceite:
- Usuário não pode acessar rotas administrativas.
- Admin pode acessar todas as áreas permitidas.
- Rotas protegidas por middleware ou mecanismo equivalente de autorização.
- Sessão expira após tempo configurado.

## Épico 2 - Upload e Gerenciamento de PDFs

### US-04 - Upload de PDF
Como administrador
Quero fazer upload de um ou mais PDFs
Para convertê-los em áudio

Critérios de aceite:
- Permitir upload de múltiplos arquivos.
- Aceitar apenas arquivos .pdf.
- Validar tamanho máximo configurável.
- Exibir barra de progresso.
- Salvar os arquivos na pasta uploads/.
- Criar registro no banco com status Enviado.

### US-05 - Status de Processamento
Como administrador
Quero visualizar o status de cada PDF
Para acompanhar a conversão

Critérios de aceite:
- Exibir os status Enviado, Processando, Pronto, Falhou e Necessita OCR.
- Atualizar status automaticamente.
- Exibir badge visual de status na interface.
- Registrar log em caso de erro.

## Épico 3 - Conversão de PDF em Áudio

### US-06 - Extração de Texto
Como sistema
Quero extrair texto do PDF
Para convertê-lo em áudio

Critérios de aceite:
- Detectar se o PDF contém texto nativo.
- Se o PDF for escaneado, marcar como Necessita OCR.
- Armazenar o texto extraído temporariamente.

### US-07 - Geração de Áudio por Faixa
Como administrador
Quero que o sistema gere áudio dividido por faixas
Para organizar o conteúdo

Critérios de aceite:
- Dividir por capítulos detectados ou por blocos de páginas configuráveis.
- Gerar arquivos .mp3 ou .wav.
- Salvar os áudios na pasta audios/.
- Criar registro com nome da faixa, ordem e duração.
- Atualizar o status para Pronto ao finalizar.

## Épico 4 - Gestão de Biblioteca

### US-08 - Biblioteca do Usuário
Como usuário
Quero visualizar meus audiobooks liberados
Para ouvir meus áudios

Critérios de aceite:
- Exibir apenas audiobooks com permissão ativa.
- Mostrar título, quantidade de faixas e duração total.
- Usar interface responsiva com cards.

### US-09 - Player de Áudio
Como usuário
Quero ouvir as faixas
Para consumir o conteúdo

Critérios de aceite:
- Play e pause.
- Barra de progresso.
- Controle de volume.
- Retomar de onde parou.
- Player fixo no rodapé em dispositivos móveis.

## Épico 5 - Controle de Permissões

### US-10 - Conceder Acesso a Usuários
Como administrador
Quero liberar um audiobook para um ou vários usuários
Para controlar quem pode ouvir

Critérios de aceite:
- Exibir tela com lista de usuários.
- Permitir seleção múltipla.
- Criar associação entre User e Audiobook.
- Atualizar imediatamente a biblioteca do usuário.

### US-11 - Revogar Acesso
Como administrador
Quero remover o acesso de um usuário
Para controlar permissões

Critérios de aceite:
- Exibir botão de revogação.
- Remover associação do banco.
- O usuário perde o acesso imediatamente.

## Épico 6 - Modelagem de Banco de Dados

### US-12 - Estrutura de Dados
Tabelas necessárias:

Users
- id
- name
- email
- password_hash
- role (admin/user)
- created_at

Audiobooks
- id
- title
- original_pdf
- status
- created_at

Tracks
- id
- audiobook_id (FK)
- title
- file_path
- duration
- order

Permissions
- id
- user_id (FK)
- audiobook_id (FK)
- granted_at

Critérios de aceite:
- Relacionamento N:N entre Users e Audiobooks.
- Integridade referencial entre as entidades.
- Exclusão em cascata configurável.

## Épico 7 - Responsividade e UX

### US-13 - Layout Responsivo
Como usuário
Quero usar o sistema no celular
Para acessar em qualquer dispositivo

Critérios de aceite:
- Adotar abordagem mobile-first.
- Menu colapsável.
- Player adaptado ao mobile.
- Testar em 360px, 768px e 1280px ou mais.

## Épico 8 - Segurança

### US-14 - Proteção de Arquivos
Como sistema
Quero impedir acesso direto aos áudios via URL
Para evitar downloads não autorizados

Critérios de aceite:
- Não expor áudios publicamente.
- Permitir download ou streaming apenas via endpoint autenticado.
- Verificar permissão antes de liberar o streaming.

## Épico 9 - Logs e Monitoramento

### US-15 - Log de Processamento
Como administrador
Quero visualizar falhas de conversão
Para diagnosticar problemas

Critérios de aceite:
- Registrar erro técnico.
- Registrar horário.
- Exibir mensagem amigável no painel.

## Observações de Escopo

- O fluxo de autenticação deve contemplar perfis Admin e Usuário, com redirecionamento adequado.
- O upload administrativo deve suportar múltiplos PDFs; o fluxo de usuário pode permanecer restrito ao uso previsto pela interface.
- A biblioteca deve mostrar apenas itens liberados para o usuário autenticado.
- O player precisa respeitar a proteção de arquivos e só acessar áudio via autorização.
- O banco de dados deve manter consistência entre usuários, audiobooks, faixas e permissões.

## Status de Entrega

Implementação validada no repositório, com cobertura automatizada para autenticação, upload, OCR best-effort e fluxo básico de publicação em GitHub Actions.