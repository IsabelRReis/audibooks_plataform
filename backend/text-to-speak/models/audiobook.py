from datetime import datetime


class Track:
    def __init__(self, nome, conteudo, duracao=0, status="pendente"):
        self.nome = nome
        self.conteudo = conteudo
        self.duracao = duracao
        self.status = status
        self.data = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def to_dict(self):
        return {
            "nome": self.nome,
            "conteudo": self.conteudo,
            "duracao": self.duracao,
            "status": self.status,
            "data": self.data,
        }


class Audiobook:
    def __init__(self, nome):
        self.nome = nome
        self.faixas = []
        self.data_criacao = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.duracao_total = 0
        self.numero_faixas = 0

    def adicionar_faixa(self, track_obj):
        """Adiciona uma faixa ao audiobook e atualiza contadores."""
        self.faixas.append(track_obj)
        self.numero_faixas = len(self.faixas)
        self.duracao_total = sum(getattr(f, "duracao", 0) for f in self.faixas)

    def atualizar_metadados(self):
        """Recalcula `numero_faixas` e `duracao_total`."""
        self.numero_faixas = len(self.faixas)
        self.duracao_total = sum(getattr(f, "duracao", 0) for f in self.faixas)

    def to_dict(self):
        return {
            "nome": self.nome,
            "numero_faixas": self.numero_faixas,
            "duracao_total": self.duracao_total,
            "data_criacao": self.data_criacao,
            "faixas": [f.to_dict() for f in self.faixas],
        }