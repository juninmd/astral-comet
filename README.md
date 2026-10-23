# Leilão FIPE Helper 🚗💨

Extensão para Chrome/Brave/Edge e Firefox (Manifest V3) que consulta a **Tabela FIPE** nos lotes do **Freitas Leiloeiro** e calcula o **custo total e o lucro estimado** de cada veículo.

![Lista de lotes](docs/screenshots/01-lista-lotes.png)

## ✨ Funcionalidades

- **Consulta FIPE automática** em cada lote (lista e página de detalhes), com o modelo FIPE encontrado e o mês de referência.
- **Custos lidos da própria página** (comissão, despesas administrativas/operacionais, logística, "IPVA pago"); quando o lote não informa, usa os valores configurados no popup.
- **Cálculo de lucro**: lance + comissão + despesas adm/org/dep + logística + custos extras + ATPV-e + guincho + IPVA (se não pago). Verde = lucro, vermelho = prejuízo.
- **Lance máximo recomendado**: o maior lance que ainda não dá prejuízo contra a FIPE, já com comissão e todas as despesas (`(FIPE − custos fixos) / (1 + comissão)`, arredondado para baixo no centavo). Mostra a folga sobre o lance atual ou quanto ele já excede; "Inviável" quando os custos fixos superam a FIPE.
- **Visual moderno**: o lucro estimado em destaque (valor + %), cartões de *Valor FIPE* e *Custo Total*, e o **detalhamento dos custos recolhível** (o estado aberto/fechado é mantido quando o lance atualiza). Chave liga/desliga para a consulta automática, *skeleton* de carregamento, alertas amarelos para erros, modal com foco visível e respeito a `prefers-reduced-motion`. O popup tem tema claro/escuro automático.
- **Match inteligente**: normaliza acentos, entende abreviações do leilão (`VW`, `GM`, `M.BENZ`, `I/` de importado), mantém cilindrada (`1.0`) e testa as variantes mais parecidas até achar o ano do modelo (±1 ano como fallback). Procura em carros, motos e caminhões.
- **Modo manual / Selecionar veículo**: desligue a "Consulta automática" ou clique em **Selecionar veículo** para escolher o veículo direto na tabela FIPE: **categoria** (carros, motos, caminhões) → **marca** → **modelo** (busca com filtro por vários termos, sem acento e sem diferenciar maiúsculas; mostra até 50 resultados e informa o total) → **ano** (os anos reais daquele modelo). Já abre preenchido com o que foi detectado no lote, funciona só com o teclado (↑ ↓ Home End Enter Esc, foco preso no diálogo) e a consulta usa os códigos FIPE exatos. Também informa o IPVA.
- **Erros tratados**: "FIPE não encontrada" (mostra só os custos, sem lucro falso), limite da API excedido e falta de conexão, ambos com **Tentar novamente**.
- **Popup de configurações** com atualização imediata nas abas abertas.

**Detalhamento dos custos** (recolhível):

![Detalhamento dos custos](docs/screenshots/11-detalhamento-custos.png)

| FIPE não encontrada | Limite da API | Modo manual |
|---|---|---|
| ![](docs/screenshots/02-fipe-nao-encontrada.png) | ![](docs/screenshots/03-limite-api.png) | ![](docs/screenshots/05-modo-manual.png) |

| Selecionar veículo | Detalhe do lote | Configurações |
|---|---|---|
| ![](docs/screenshots/06-modal-selecionar-veiculo.png) | ![](docs/screenshots/07-detalhe-lote.png) | ![](docs/screenshots/08-popup-config.png) |

## 🚀 Instalação

```bash
pnpm install
pnpm build        # gera dist/
```

**Chrome / Brave / Edge:** `chrome://extensions` → ative o *Modo do desenvolvedor* → *Carregar sem compactação* → selecione a pasta do projeto.

**Firefox (140+):** `about:debugging#/runtime/this-firefox` → *Carregar extensão temporária…* → selecione `manifest.json`. Ou `pnpm dev` (web-ext).

## ⚙️ Configuração (popup)

| Campo | Padrão | Observação |
|---|---|---|
| Comissão (%) | 5 | Usada só se a página não informar a comissão |
| Despesas Adm/Org/Dep | R$ 1.900,00 | Idem |
| Despesas Logística | R$ 1.416,00 | Idem |
| Guincho | R$ 1.500,00 | Estimativa |
| Custos extras | R$ 0,00 | |
| Token API FIPE | — | Opcional: aumenta o limite da API FIPE v2 ([fipe.api.br](https://fipe.api.br)) |

ATPV-e é fixo em R$ 40,00. O IPVA é informado em **Selecionar veículo** e só entra quando a página não indica "IPVA ... PAGO".

## 🌐 APIs usadas

- **BrasilAPI** (`brasilapi.com.br/api/fipe`): marcas e modelos.
- **FIPE API v2** (`fipe.parallelum.com.br/api/v2`): anos e preço. Sem token o limite é baixo; o resultado é mantido em cache enquanto a aba estiver aberta.

## 🛠️ Desenvolvimento

| Comando | O que faz |
|---|---|
| `pnpm build` / `pnpm watch` | Compila com tsup para `dist/` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Testes unitários (vitest). `LIVE=1 pnpm test` também consulta as APIs reais |
| `pnpm test:e2e` | Build + Playwright: carrega a extensão num Chromium real e exercita lista, detalhe, popup, erros, seletor de veículo e lance máximo. `LIVE=1` inclui um teste com as APIs reais. Gera os prints em `docs/screenshots/` |
| `pnpm lint:ext` | `web-ext lint` do build |
| `pnpm dev` | Firefox com web-ext |

Estrutura: `src/content_script.ts` (UI nas páginas), `src/vehicle_picker.ts` + `src/combobox.ts` + `src/search.ts` (seletor de veículo), `src/fipe_service.ts` (consulta/match/catálogo), `src/lib.ts` (parse e cálculo), `src/settings.ts` (storage), `src/popup.*`, `e2e/` (fixtures e testes).

## ✅ Homologação

Última rodada (Chromium do Playwright, headless, com a extensão carregada): **57 testes unitários + 17 e2e passando** (+4 unitários e 1 e2e contra as APIs reais com `LIVE=1`). No Windows o e2e do popup falha só porque `e2e/fixtures.ts` deriva o ID da extensão como no Linux; use `CHROME_PATH` apontando para o Chromium do Playwright.

**Lotes reais** (leilão 8120, lotes 3, 4 e 8, página de detalhe, APIs FIPE reais, 3 execuções completas): 87 verificações, todas OK. Cobrem lance/comissão/despesas lidos da própria página, aritmética do detalhamento e do lance máximo recalculada de forma independente, ausência de deriva em 10 s, resultado idêntico em contexto novo, seletor (pré-preenchimento, busca, teclado, categoria, Esc) em 1280 px e 375 px. Dois defeitos só apareceram aí e estão cobertos por teste: "Despesas **operacionais**" (o site usa essa palavra em alguns leilões) e a extensão ler o próprio painel como lance quando o lote não tem lances ("Aguardando lances": vale o *Lance Inicial*). Firefox: `web-ext lint` com 0 erros.

---
Licença ISC.
