# Checklist de Validação do Produto

Projeto: Plataforma de Conversão de PDF em Audiobook com Controle de Acesso

Status final: todos os itens abaixo foram validados no código e/ou documentados para a entrega do repositório no GitHub.

## Épico 1 - Autenticação e Controle de Acesso

### US-01 - Cadastro de Usuário
- [x] Validar e-mail único.
- [x] Exigir senha com no mínimo 8 caracteres.
- [x] Armazenar senha com hash criptográfico.
- [x] Definir perfil padrão como Usuário.
- [x] Redirecionar para login após cadastro.

### US-02 - Login
- [x] Permitir login com e-mail e senha.
- [x] Validar credenciais com segurança.
- [x] Criar sessão ou token seguro com expiração.
- [x] Redirecionar conforme o perfil.
- [x] Admin vai para o dashboard administrativo.
- [x] Usuário vai para a biblioteca.

### US-03 - Controle de Rotas por Perfil
- [x] Usuário não acessa rotas administrativas.
- [x] Admin acessa todas as áreas permitidas.
- [x] Rotas protegidas por middleware ou autorização equivalente.
- [x] Sessão expira após tempo configurado.

## Épico 2 - Upload e Gerenciamento de PDFs

### US-04 - Upload de PDF
- [x] Permitir upload de múltiplos arquivos.
- [x] Aceitar apenas arquivos .pdf.
- [x] Validar tamanho máximo configurável.
- [x] Exibir barra de progresso.
- [x] Salvar os arquivos na pasta uploads/.
- [x] Criar registro no banco com status Enviado.

### US-05 - Status de Processamento
- [x] Exibir status Enviado.
- [x] Exibir status Processando.
- [x] Exibir status Pronto.
- [x] Exibir status Falhou.
- [x] Exibir status Necessita OCR.
- [x] Atualizar status automaticamente.
- [x] Exibir badge visual de status.
- [x] Registrar log em caso de erro.

## Épico 3 - Conversão de PDF em Áudio

### US-06 - Extração de Texto
- [x] Detectar se o PDF contém texto nativo.
- [x] Marcar como Necessita OCR quando o PDF for escaneado.
- [x] Armazenar o texto extraído temporariamente.

### US-07 - Geração de Áudio por Faixa
- [x] Dividir por capítulos detectados ou por blocos de páginas configuráveis.
- [x] Gerar arquivos .mp3 ou .wav.
- [x] Salvar os áudios na pasta audios/.
- [x] Criar registro com nome da faixa.
- [x] Criar registro com ordem.
- [x] Criar registro com duração.
- [x] Atualizar o status para Pronto ao finalizar.

## Épico 4 - Gestão de Biblioteca

### US-08 - Biblioteca do Usuário
- [x] Exibir apenas audiobooks com permissão ativa.
- [x] Mostrar título.
- [x] Mostrar quantidade de faixas.
- [x] Mostrar duração total.
- [x] Usar interface responsiva com cards.

### US-09 - Player de Áudio
- [x] Play.
- [x] Pause.
- [x] Barra de progresso.
- [x] Controle de volume.
- [x] Retomar de onde parou.
- [x] Player fixo no rodapé em dispositivos móveis.

## Épico 5 - Controle de Permissões

### US-10 - Conceder Acesso a Usuários
- [x] Exibir tela com lista de usuários.
- [x] Permitir seleção múltipla.
- [x] Criar associação entre User e Audiobook.
- [x] Atualizar imediatamente a biblioteca do usuário.

### US-11 - Revogar Acesso
- [x] Exibir botão de revogação.
- [x] Remover associação do banco.
- [x] Impedir acesso imediato ao usuário revogado.

## Épico 6 - Modelagem de Banco de Dados

### US-12 - Estrutura de Dados
- [x] Users com id.
- [x] Users com name.
- [x] Users com email.
- [x] Users com password_hash.
- [x] Users com role admin/user.
- [x] Users com created_at.
- [x] Audiobooks com id.
- [x] Audiobooks com title.
- [x] Audiobooks com original_pdf.
- [x] Audiobooks com status.
- [x] Audiobooks com created_at.
- [x] Tracks com id.
- [x] Tracks com audiobook_id.
- [x] Tracks com title.
- [x] Tracks com file_path.
- [x] Tracks com duration.
- [x] Tracks com order.
- [x] Permissions com id.
- [x] Permissions com user_id.
- [x] Permissions com audiobook_id.
- [x] Permissions com granted_at.
- [x] Relacionamento N:N entre Users e Audiobooks.
- [x] Integridade referencial entre entidades.
- [x] Exclusão em cascata configurável.

## Épico 7 - Responsividade e UX

### US-13 - Layout Responsivo
- [x] Adotar abordagem mobile-first.
- [x] Menu colapsável.
- [x] Player adaptado ao mobile.
- [x] Testar em 360px.
- [x] Testar em 768px.
- [x] Testar em 1280px ou mais.

## Épico 8 - Segurança

### US-14 - Proteção de Arquivos
- [x] Não expor áudios publicamente.
- [x] Permitir download ou streaming apenas via endpoint autenticado.
- [x] Verificar permissão antes de liberar o streaming.

## Épico 9 - Logs e Monitoramento

### US-15 - Log de Processamento
- [x] Registrar erro técnico.
- [x] Registrar horário.
- [x] Exibir mensagem amigável no painel.

## Validação Geral

- [x] O fluxo de autenticação contempla Admin e Usuário.
- [x] O upload administrativo suporta múltiplos PDFs.
- [x] A biblioteca mostra apenas itens liberados para o usuário autenticado.
- [x] O player respeita a proteção de arquivos e acessa áudio apenas com autorização.
- [x] O banco mantém consistência entre usuários, audiobooks, faixas e permissões.