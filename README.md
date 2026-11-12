# Setup.sh: Porque configurar tudo de novo cansa!

Uma vez que você passa pela dor de configurar o ambiente toda vez do zero, você aprende. E escreve um instalador. E depois versiona. E coloca no GitHub.

Esse é o resultado: um instalador de terminal, feito com [TermUI](https://www.termui.io/), que configura atalhos, instala ferramentas e deixa tudo como manda o figurino (ou a minha teimosia).

No terminal (escolhe os grupos com espaço e confirma com enter):

```
sudo ./script.sh
```

Sem TTY, o mesmo one-liner instala tudo e respeita `SKIP_GUI=1`, `SKIP_FLATPAK=1` e `SKIP_NOMAD=1`:

```
curl -fsSL https://raw.githubusercontent.com/paulovisam/setup/main/script.sh | sudo bash
```

O `script.sh` só prepara o Bun e abre o app. A instalação em si está em `src/`.
