import subprocess

def text_conversor(nome, conteudo, voz):
    print("Iniciando a conversão...")

    try:
        processo = subprocess.Popen(
            ["piper", "--model", voz, "--output_file", f"./{nome}.wav"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        stdout, stderr = processo.communicate(input=conteudo)

        if processo.returncode != 0:
            print("Erro durante a conversão:")
            print(stderr)
            return

        print(f"Conversão realizada com sucesso! Arquivo gerado em ./{nome}.wav")

    except FileNotFoundError:
        print("Erro: o executável 'piper' não foi encontrado no sistema.")
    except Exception as e:
        print(f"Erro inesperado: {e}")


def main():
    nome = "audio"
    conteudo = (
        "O amor é uma fumaça feita com a fumaça dos suspiros. "
        "Sendo purgado, um fogo brilhando nos olhos dos amantes; "
        "sendo vex’d um mar nutrido com lágrimas de amantes."
    )
    voz = "../pt_BR-faber-medium.onnx"

    text_conversor(nome, conteudo, voz)


if __name__ == "__main__":
    main()