# ADR-ELEMENTS: PDPL-U Element System — Family Registry, Mesh Factory & Modules

**Project:** ecbyts / ECBT (Environmental & Occupational Core Byte Tools)
**Author:** Calvin Stefan Iost, 2026
**Status:** Accepted
**Date:** 2026-02-22
**Atualizado:** 2026-03-26
**Depends on:** ADR 8 (Client-Side Blockchain Cryptography), ADR core (root)

---

## 1. Context

O sistema de elementos é o núcleo do Digital Twin ambiental. Cada ponto monitorável,
estrutura ou área de estudo no ambiente é representado por um **elemento** — uma entidade
3D georreferenciada com observações temporais, metadados e famílias de geometria.

A classificação taxonômica dos elementos segue o modelo **PDPL-U** (Poluição, Disposição,
Proteção, Limite — Universal), derivado da prática de investigação e remediação ambiental
brasileira (CONAMA 420, GRI). Cada família define o comportamento visual, os parâmetros
padrão e as regras de compliance aplicáveis.

---

## 2. Decisão

O módulo `elements/` é estruturado em quatro camadas:

### 2.1 Manager (`manager.js`)

CRUD central de elementos. Mantém estado em closure de módulo (sem store global).
Expõe funções síncronas e assíncronas consumidas pelos handlers e pelo encoder ECO1.

### 2.2 Mesh Factory (`meshFactory.js`)

Fábrica de geometrias Three.js por família. Cada família tem um creator registrado
que recebe parâmetros normalizados e retorna `THREE.Mesh | THREE.Group`. Separado do
manager para isolamento de dependências (utils não importa Three.js diretamente).

Creators registrados (18 famílias):
`plume`, `well`, `lake`, `river`, `spring`, `building`, `tank`, `waste`,
`boundary`, `blueprint`, `sensor`, `intangible`, `generic`, `satellite`,
`terrain`, `potentiometric`, `interpolation`, `voxel`

### 2.3 Family Module Registry (`familyModuleRegistry.js` + `families.js`)

Sistema plugável de módulos de família (lazy-loaded). Cada família pode ter um
`FamilyModule` opcional em `families/<id>/index.js` que estende o comportamento
base (ex: `well/` com perfil construtivo SVG e litologia).

Base class: `families/_base/FamilyModule.js`

### 2.4 Módulos Auxiliares

- `complianceOverlay.js` — sobreposição visual de status de compliance (VR/VP/VI/CMA)
- `meshHelpers.js` — funções utilitárias de geometria
- `meshESG.js` — geometrias específicas para assets ESG (PV, eólica, reflorestamento)
- `spriteFactory.js` — sprites 2D para labels e marcadores
- `randomHelpers.js` + `randomModel.js` — geração de modelo demo para onboarding

---

## 3. Modelo PDPL-U — Famílias Ativas

| ID           | Nome                | Descrição                                          |
| ------------ | ------------------- | -------------------------------------------------- |
| `plume`      | Contamination Plume | Volume 3D de contaminação em solo/água subterrânea |
| `well`       | Monitoring Well     | Furo de sondagem para amostragem                   |
| `lake`       | Lake                | Corpo hídrico superficial lêntico                  |
| `river`      | River               | Corpo hídrico superficial lótico                   |
| `spring`     | Spring              | Descarga natural de água subterrânea               |
| `building`   | Building            | Infraestrutura                                     |
| `tank`       | Storage Tank        | Armazenamento de produtos químicos ou combustíveis |
| `waste`      | Waste               | Depósito de resíduos ou aterro                     |
| `boundary`   | Boundary            | Limite de propriedade ou área de estudo            |
| `blueprint`  | Spatial Blueprint   | Planta CAD/GIS importada (DXF)                     |
| `sensor`     | IoT Sensor          | Ponto de monitoramento IoT contínuo                |
| `intangible` | Intangible Asset    | Ativo ESG/ambiental imaterial                      |
| `generic`    | Generic             | Elemento genérico sem família específica           |

Famílias especializadas (mesh gerado dinamicamente pelo sistema):
`satellite`, `terrain`, `potentiometric`, `interpolation`, `voxel`

---

## 4. Alternativas Consideradas

### 4.1 Subclasses vs Registry

**Rejeitado:** Subclasses `WellElement extends BaseElement` — acoplamento rígido,
difícil extensão sem modificar o módulo core.

**Escolhido:** Registry pattern + FamilyModule plugável — adicionar nova família
requer apenas: (1) entry em `config.js DEFAULT_FAMILIES`, (2) creator em `meshFactory.js`,
(3) FamilyModule opcional em `families/<id>/`.

### 4.2 Three.js no Manager

**Rejeitado:** Importar Three.js diretamente em `manager.js` — polui o manager com
dependências gráficas desnecessárias.

**Escolhido:** `meshFactory.js` como boundary de dependência gráfica. Manager trabalha
com IDs e dados puros; a cena 3D é responsabilidade dos handlers via `setSceneGroup()`.

### 4.3 Eager vs Lazy Loading de FamilyModules

**Escolhido:** Lazy-loading — módulos de família são importados sob demanda via
`import('./families/<id>/index.js')` apenas quando o painel da família é aberto.
Reduz bundle inicial e permite expansão sem afetar performance de carregamento.

---

## 5. Consequências

**Positivas:**

- Adicionar nova família não requer modificar arquivos existentes (aberto/fechado)
- meshFactory.js é substituível (ex: para WebGPU renderer no futuro)
- FamilyModules podem incluir UI específica (painéis de detalhe, validação customizada)

**Negativas:**

- Registry precisa ser mantido consistente entre `config.js`, `meshFactory.js` e `families.js`
- Lazy loading introduz latência no primeiro acesso a famílias com FamilyModule

---

## 6. Referências

- `app/js/config.js` — `DEFAULT_FAMILIES` e parâmetros por família
- `app/js/core/elements/meshFactory.js` — creators de geometria Three.js
- `app/js/core/elements/families/_base/FamilyModule.js` — base class plugável
- `app/js/core/io/ADR.md` — formato ECO1 e serialização de elementos
- CONAMA Resolução 420/2009 — classificação de áreas contaminadas (VR/VP/VI)
- NBR 15495-1 e ABNT NBR 15492 — construção e monitoramento de poços
