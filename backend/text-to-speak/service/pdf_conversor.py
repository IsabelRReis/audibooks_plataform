import json
from models.audiobook import Audiobook, Track

def pdf_conversor(file_path):
    try:
        import pdfplumber
    except ImportError:
        raise ImportError("Dependência ausente: instale 'pdfplumber' (pip install pdfplumber)")
    # 1. Instancia a classe principal
    nome_livro = file_path.split("/")[-1].replace(".pdf", "")
    meu_audiobook = Audiobook(nome_livro)

    with pdfplumber.open(file_path) as pdf:
        for i, pagina in enumerate(pdf.pages):
            texto = pagina.extract_text()
            if texto:
                # 2. Cria o objeto da Track
                nova_faixa = Track(
                    nome=f"Faixa {i+1}",
                    conteudo=texto.replace('\n', ' ').strip()
                )
                # 3. Adiciona ao Audiobook (o contador atualiza sozinho!)
                meu_audiobook.adicionar_faixa(nova_faixa)

    # 4. Salva o JSON final usando o método to_dict()
    with open(f"{nome_livro}.json", "w", encoding="utf-8") as f:
        json.dump(meu_audiobook.to_dict(), f, indent=4, ensure_ascii=False)

    return meu_audiobook
