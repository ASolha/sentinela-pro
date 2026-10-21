# Sentinela Pro — pacote da extensão

Esta branch (`main`) contém a extensão **já construída**, pronta para o Chrome carregar: é daqui que o
AS Sentinela Updater dos operadores baixa as atualizações (ele compara o `version` do `manifest.json`).

- Instalação manual: `chrome://extensions` → Modo do desenvolvedor → Carregar sem compactação → esta pasta.
- Depois de atualizar: a partir da 5.9.0 a extensão se recarrega sozinha em alguns minutos e as abas do Mercado
  Livre já abertas mostram um aviso para apertar F5. Vindo de uma versão anterior à 5.9.0: Recarregar ↻ em
  `chrome://extensions` e F5 nas abas do Mercado Livre.
- Versão anterior (4.3): tag `v4.3`.
