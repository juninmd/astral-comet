# Leilão FIPE Helper 🚗💨

Extensão para Chrome e Firefox que consulta automaticamente a Tabela FIPE no site **Freitas Leiloeiro** e calcula o lucro estimado com base nas taxas oficiais.

## ✨ Funcionalidades

- **Consulta FIPE Automática**: Busca o valor de mercado (Tabela FIPE) usando a BrasilAPI.
- **Cálculo de Lucro Real**:
    - **5% de Comissão** do leiloeiro.
    - **R$ 1.900,00** de Despesas Administrativas (Organização/Depósito).
    - **R$ 40,00** de Taxa ATPV-e.
    - **R$ 1.500,00** de Estimativa de Guincho (configurável no código).
- **Match Inteligente**: Algoritmo de busca robusto que normaliza nomes e encontra o modelo correto mesmo com variações de texto.
- **Interface Premium**: Injeção de card com visual moderno e indicadores de lucro/prejuízo (verde/vermelho).
- **Cross-Browser**: Compatível com Google Chrome, Brave, Edge e Mozilla Firefox.

## 🚀 Como Instalar

### No Google Chrome / Brave / Edge:
1. Faça o download ou clone este repositório.
2. Acesse `chrome://extensions/`.
3. Ative o **"Modo do desenvolvedor"** (canto superior direito).
4. Clique em **"Carregar sem compactação"** e selecione a pasta do projeto (`astral-comet`).

### No Mozilla Firefox:
1. Acesse `about:debugging#/runtime/this-firefox`.
2. Clique em **"Instalar extensão temporária..."**.
3. Selecione o arquivo `manifest.json` na raiz do projeto.

## 🛠️ Desenvolvimento

O projeto foi desenvolvido em **TypeScript** utilizando o bundler **tsup**.

### Scripts Disponíveis:
- `pnpm install`: Instala as dependências.
- `pnpm build`: Compila o código TypeScript para a pasta `dist/`.
- `pnpm dev`: Inicia o modo de desenvolvimento com `web-ext`.

---
Desenvolvido com ❤️ para dominar o mercado de leilões! 🚀
