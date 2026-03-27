# ADR-020: EnviroTech Integrity Score (EIS) — Motor de Governança de Dados

**Status**: Accepted
**Date**: 2026-02-25
**Atualizado:** 2026-03-26
**Author**: Calvin Stefan Iost
**Project**: ECBT — Environmental & Occupational Core Byte Tools

---

## Context

Plataformas de dados ambientais enfrentam o "Paradoxo da Compensação": um dado
formatado corretamente, entregue rapidamente e bem categorizado pode ter nota
máxima em 5 dos 6 eixos de qualidade — mas sem evidência de origem (transparência
baixa), o dado é inutilizável para auditoria e pode configurar greenwashing.

Uma média aritmética permitiria que os eixos de alta pontuação compensassem a
falha de transparência. Isso é matematicamente conveniente mas epistemologicamente
incorreto para compliance ambiental.

O EIS resolve isso com **não-compensação matemática** e um sistema de credenciais
que reflete a força da evidência de origem com base no nível acadêmico/profissional
do autor dos dados.

---

## Decision

### 1. Framework TCCCA+T — 6 Eixos de Qualidade

| Sigla | Eixo                        | Peso (Gold Standard) |
| ----- | --------------------------- | -------------------- |
| T     | Transparência / Evidência   | 3                    |
| A     | Acurácia / Saúde do Sensor  | 3                    |
| Cp    | Completude / Uptime         | 2                    |
| Ty    | Tempestividade / Latência   | 2                    |
| Cs    | Consistência / Unidades SI  | 1                    |
| Cm    | Comparabilidade / Taxonomia | 1                    |

Pesos customizáveis por tenant. T e A têm peso máximo porque ausência de
evidência ou sensor defeituoso invalidam o dado inteiro, independente do resto.

### 2. Algoritmo Não-Compensatório: Média Geométrica Ponderada

```
EIS = ∏ (Nota_i)^(Peso_i / SomaPesos)     para i ∈ {T, A, Cp, Ty, Cs, Cm}
```

**Por que geométrica e não aritmética?**

- Na média aritmética: (1 + 5 + 5 + 5 + 5 + 5) / 6 = 4.33 → 🟡 Management Ready
- Na média geométrica (pesos iguais): (1×5×5×5×5×5)^(1/6) = 5^(5/6) ≈ 3.34 → 🔴 Critical Data

A diferença aumenta com os pesos: T=1 com peso 3 afunda o score para 3.34 mesmo
com todos os outros eixos em 5. Não há compensação possível.

### 3. Modo 'veto' — Kill-Switch para Auditorias Externas

Para cenários de auditoria extrema (relatórios regulatórios, due diligence):

```
EIS = 0.0   se (T_original ≤ 2) ou (A_original ≤ 2)
EIS = EIS_geometrico   caso contrário
```

O kill-switch avalia as notas ORIGINAIS (sem multiplicador de credencial).
Um PhD com T=1 retorna EIS=0.0 no modo veto — a regra é sobre a evidência
bruta, não sobre a confiança concedida ao autor.

### 4. Sistema de Credenciais — Multiplicador do Eixo T

Dados inseridos por usuários credenciados têm evidência de origem mais forte.
O multiplicador é aplicado ao eixo T antes do cálculo geométrico, com cap em 5.0:

```
T_ajustado = min(T_original × multiplicador, 5.0)
```

| Nível        | Multiplicador | Justificativa                                   |
| ------------ | ------------- | ----------------------------------------------- |
| common       | 1.0×          | Sem validação de identidade profissional        |
| professional | 1.2×          | Registro em conselho profissional (CREA/CRC)    |
| pos_graduado | 1.4×          | Especialização acadêmica comprovada             |
| mestre       | 1.6×          | Pesquisa acadêmica formal, metodologia validada |
| doutor       | 2.0×          | Máxima rigorosidade metodológica comprovada     |

**Interpretação**: Um PhD com T=3 → T_ajustado = min(6.0, 5.0) = 5.0.
A credencial "eleva" dados de evidência fraca, mas dados sem qualquer
evidência (T=1) com PhD ficam em T_ajustado=2.0 — ainda na zona de risco.

### 5. Classificação do Veredito

| Score       | Veredito            | Uso                          |
| ----------- | ------------------- | ---------------------------- |
| 4.50 – 5.00 | 🟢 Audit Ready      | Auditoria externa, regulador |
| 3.50 – 4.49 | 🟡 Management Ready | Decisões internas            |
| 0.00 – 3.49 | 🔴 Critical Data    | Risco de compliance          |

---

## Scientific Rationale

A média geométrica é o agregador correto para indicadores de qualidade
**multiplicativos por natureza**: dados de monitoramento ambiental são
utilizáveis somente quando TODOS os eixos atingem um patamar mínimo.
A falha em qualquer eixo essencial não é "compensável" por excelência em outros —
ela degrada o dado na forma como degradações reais acontecem no campo.

Referências:

- ISO 14031:2021 — Environmental Performance Evaluation
- ASTM D5979 — Guide for Conceptual Site Models
- EU Taxonomy Regulation (2020/852) — Art. 17 "Do No Significant Harm"

---

## Consequences

**Habilita:**

- Score de qualidade rastreável por observação e por modelo
- Diferenciação de credibilidade de dados por nível acadêmico do autor
- Exportação de metadados de integridade no formato ECO1
- Radar Chart de 6 eixos no frontend (próxima sprint)

**Custo:**

- Usuários sem credencial que inserem dados de baixa transparência
  ficam em 🔴 mesmo com outros eixos perfeitos — impacto na adoção
- Multiplicadores de credencial requerem validação de diplomas via IA

**Não faz:**

- Não substitui auditoria humana — é um indicador de triagem
- Não avalia conteúdo científico dos dados — apenas qualidade de processo
- Não integra com EDD/XLSX diretamente (requer camada de mapeamento)

### 6. Credencial por Leitura (v0.1.6)

**Mudança**: Multiplicador de credencial migrado de seletor global (dropdown no
dashboard) para carimbo por observação.

**Antes**: Usuário selecionava nível de credencial no dashboard. Multiplicador
aplicado como simulação global ao eixo T.

**Depois**: Cada observação armazena `credentialLevel` e `createdBy` no momento
da inserção. O calculador EIS computa o multiplicador agregado como a **média
aritmética** dos multiplicadores individuais de todas as leituras do modelo.

```
aggregateMultiplier = (1/N) × Σ EIS_CREDENTIAL_MULTIPLIERS[obs_i.credentialLevel]
```

Se N = 0, multiplier = 1.0 (common).

**Justificativa**:

- Simulação global não reflete proveniência real dos dados
- Carimbo por leitura habilita rastreabilidade de autoria
- Média aritmética pondera corretamente a contribuição de cada leitura
- Dados importados (CSV/EDD) recebem `credentialLevel: 'common'`

### 7. Completude Automática via Campanhas (v0.1.7)

**Mudança**: Eixo Cp (Completude) migrado de slider manual para cálculo automático
baseado nas campanhas de monitoramento com leituras planejadas.

**Antes**: Usuário ajustava Cp manualmente no slider do dashboard (1-5).

**Depois**: Cada campanha pode definir `plannedReadings` — array de pares
`{elementId, parameterId}` representando leituras esperadas. O eixo Cp é computado
automaticamente como a razão de leituras executadas vs planejadas, mapeada para 1-5:

```
ratio = totalExecutadas / totalPlanejadas  (agregado de todas as campanhas)

Cp = 5  se ratio >= 0.95
Cp = 4  se ratio >= 0.80
Cp = 3  se ratio >= 0.60
Cp = 2  se ratio >= 0.30
Cp = 1  se ratio <  0.30
```

Se nenhuma campanha tem `plannedReadings`, Cp retorna ao slider manual (fallback).

**Justificativa**:

- Slider manual é subjetivo — dados de campanha são mensuráveis
- Completude real = cobertura temporal de amostragem (standard em GRI)
- Engenheiro ambiental planeja e depois executa — comparação é a métrica natural
- Quick-fill na UI de campanha reduz atrito no preenchimento de observações

**Limitações**:

- Não considera qualidade dos dados coletados — apenas presença/ausência
- Leituras planejadas são definidas manualmente (não inferidas do plano de monitoramento)
- Se elementos são deletados, leituras planejadas órfãs contam como não-executadas

---

## Related ADRs

- ADR-005: Analytics (Mann-Kendall, Sen's slope) — dados com EIS 🔴 devem ser excluídos
- ADR-009: Cryptography — blockchain integra hash-chain com EIS score por observação
- ADR-004: Validation (CONAMA/CETESB) — conformidade regulatória afeta eixo Cs
