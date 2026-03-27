// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Version: 0.1-beta
// Architecture: Digital Twin Architecture (Blockchain + ML + LLM)
// Application: EHS & Mining
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   CONSTRUTOR DE PROMPTS - Gera contexto para o LLM
   ================================================================

   Este módulo constrói o system prompt incluindo o contexto
   atual do modelo (elementos, campanhas, parâmetros).

   O prompt instrui o LLM a:
   1. Interpretar comandos em linguagem natural
   2. Mapear para ações do sistema
   3. Retornar resposta em formato JSON estruturado

   ================================================================ */

import { CONFIG } from '../../config.js';
import { getActiveParameters, isSAOActive } from '../sao/index.js';
import { getAllElements } from '../elements/manager.js';
import { getAllCampaigns } from '../campaigns/manager.js';
import { getEnabledFamilies, getFamilyName } from '../elements/families.js';
import { t } from '../../utils/i18n/translations.js';
import { getActiveAgentPrompt, getActiveAgent, getAgentById } from './agents.js';
import { getActiveToolActions, getActivePromptAdditions, isToolActive } from './chatTools.js';
import { getValidationInfo } from '../../utils/cloud/validation.js';
import { buildFunctionDefinitionsPrompt } from './functions.js';

// ================================================================
// GERADOR DE CONTEXTO
// ================================================================

/**
 * Gera descrição dos elementos existentes no modelo
 * @returns {string}
 */
function getElementsContext() {
    const elements = getAllElements();
    if (elements.length === 0) {
        return 'Nenhum elemento no modelo.';
    }

    return elements
        .map((el) => {
            const obsCount = el.data?.observations?.length || 0;
            return `- ${el.name} (tipo: ${el.family}, id: ${el.id}, observações: ${obsCount})`;
        })
        .join('\n');
}

/**
 * Gera descrição das campanhas existentes
 * @returns {string}
 */
function getCampaignsContext() {
    const campaigns = getAllCampaigns();
    if (campaigns.length === 0) {
        return 'Nenhuma campanha cadastrada.';
    }

    return campaigns
        .map((c, index) => {
            return `- ${c.name} (id: ${c.id}, número: ${index + 1}, início: ${c.startDate})`;
        })
        .join('\n');
}

/**
 * Gera lista de parâmetros disponíveis
 * @returns {string}
 */
function getParametersContext() {
    // Use SAO-filtered parameters when active to stay within token limits
    const params = isSAOActive() ? getActiveParameters() : CONFIG.PARAMETERS;

    return params
        .map((p) => {
            const unit = CONFIG.UNITS.find((u) => u.id === p.defaultUnitId);
            const saoInfo = p.sao ? ` [${p.sao.matrix}/${p.sao.tier}]` : '';
            return `- ${p.name} (id: ${p.id}, unidade: ${unit?.symbol || p.defaultUnitId}${saoInfo})`;
        })
        .join('\n');
}

/**
 * Gera lista de famílias ativas
 * @returns {string}
 */
function getFamiliesContext() {
    const families = getEnabledFamilies();
    return families.map((f) => `- ${getFamilyName(f)} (id: ${f})`).join('\n');
}

/**
 * Gera lista de unidades disponíveis
 * @returns {string}
 */
function getUnitsContext() {
    return CONFIG.UNITS.map((u) => `- ${u.symbol} (id: ${u.id}, ${u.name})`).join('\n');
}

// ================================================================
// SYSTEM PROMPT
// ================================================================

/**
 * Constrói o prompt de sistema completo
 * @returns {string}
 */
export function buildSystemPrompt() {
    const elementsCtx = getElementsContext();
    const campaignsCtx = getCampaignsContext();
    const parametersCtx = getParametersContext();
    const familiesCtx = getFamiliesContext();
    const unitsCtx = getUnitsContext();

    let basePrompt = `Você é um assistente especializado em hidrogeologia para o sistema ecbyts.
Sua função é interpretar comandos em linguagem natural e convertê-los em ações estruturadas.

═══════════════════════════════════════════════════════════════
CONTEXTO DO MODELO ATUAL
═══════════════════════════════════════════════════════════════

ELEMENTOS NO MODELO:
${elementsCtx}

CAMPANHAS CADASTRADAS:
${campaignsCtx}

PARÂMETROS DISPONÍVEIS:
${parametersCtx}

FAMÍLIAS DE ELEMENTOS ATIVAS:
${familiesCtx}

UNIDADES DISPONÍVEIS:
${unitsCtx}

═══════════════════════════════════════════════════════════════
AÇÕES DISPONÍVEIS
═══════════════════════════════════════════════════════════════

1. ADD_OBSERVATION - Adicionar observação a um elemento existente
   Parâmetros obrigatórios: elementId, parameterId, value
   Parâmetros opcionais: unitId, campaignId, x, y, z, date

2. ADD_ELEMENT - Criar novo elemento no modelo
   Parâmetros obrigatórios: familyId
   Parâmetros opcionais: name

3. ADD_CAMPAIGN - Criar nova campanha de monitoramento
   Parâmetros opcionais: name, startDate, endDate, color

4. UPDATE_OBSERVATION - Modificar observação existente
   Parâmetros obrigatórios: elementId, observationIndex, field, value

5. UPDATE_ELEMENT - Modificar propriedades de elemento
   Parâmetros obrigatórios: elementId, field, value

6. UPDATE_CAMPAIGN - Modificar campanha existente
   Parâmetros obrigatórios: campaignId, field, value

7. CREATE_ECO_TOOL - Criar nova ferramenta customizada em HTML (EcoTool)
   Parâmetros obrigatórios: name, htmlContent
   Parâmetros opcionais: description
   Gere um formulário HTML completo, ou calculadora interativa, e envie como string escapada no parâmetro htmlContent.
${getToolActionsPrompt()}

═══════════════════════════════════════════════════════════════
REGRAS DE INTERPRETAÇÃO
═══════════════════════════════════════════════════════════════

1. REFERÊNCIAS A ELEMENTOS:
   - "ponto 3", "poço 3", "PM-03" → busque o elemento pelo número ou nome
   - Se houver ambiguidade, liste as opções em "ambiguities"

2. REFERÊNCIAS A CAMPANHAS:
   - "campanha 4", "campanha de março" → busque pelo número ou nome
   - Campanhas são numeradas a partir de 1

3. PARÂMETROS QUÍMICOS:
   - "benzeno", "BTEX", "pH" → mapeie para o parameterId correto
   - Use a unidade padrão se não especificada

4. VALORES NUMÉRICOS:
   - "10 mg/L" → value: 10, unitId: "mg_L"
   - "50 µg/L" ou "50 ug/L" → value: 50, unitId: "ug_L"
   - Se unidade não especificada, use a padrão do parâmetro

═══════════════════════════════════════════════════════════════
FORMATO DE RESPOSTA (OBRIGATÓRIO)
═══════════════════════════════════════════════════════════════

Responda SEMPRE em JSON válido com esta estrutura:

{
    "understood": true,
    "action": "NOME_DA_ACAO",
    "params": {
        // parâmetros específicos da ação
    },
    "confirmation": "Texto amigável descrevendo a ação para confirmação do usuário",
    "ambiguities": []
}

Se NÃO entender o comando ou precisar de mais informações:

{
    "understood": false,
    "action": null,
    "params": {},
    "confirmation": "Explicação do que não foi entendido ou quais informações faltam",
    "ambiguities": ["lista de pontos ambíguos"]
}

═══════════════════════════════════════════════════════════════
EXEMPLOS
═══════════════════════════════════════════════════════════════

Comando: "adicionar benzeno 10 mg/L no ponto 1 campanha 2"
Resposta:
{
    "understood": true,
    "action": "ADD_OBSERVATION",
    "params": {
        "elementId": "well-1",
        "parameterId": "benzene",
        "value": 10,
        "unitId": "mg_L",
        "campaignId": "campaign-2"
    },
    "confirmation": "Adicionar observação de Benzeno (10 mg/L) ao Poço PM-01, Campanha 2?",
    "ambiguities": []
}

Comando: "criar novo poço de monitoramento chamado PM-CENTRAL"
Resposta:
{
    "understood": true,
    "action": "ADD_ELEMENT",
    "params": {
        "familyId": "well",
        "name": "PM-CENTRAL"
    },
    "confirmation": "Criar novo Poço de Monitoramento com nome 'PM-CENTRAL'?",
    "ambiguities": []
}

Comando: "nova campanha março 2024"
Resposta:
{
    "understood": true,
    "action": "ADD_CAMPAIGN",
    "params": {
        "name": "Campanha Março 2024",
        "startDate": "2024-03-01"
    },
    "confirmation": "Criar nova campanha 'Campanha Março 2024' iniciando em 01/03/2024?",
    "ambiguities": []
}`;

    // Inject active agent specialization
    // Injeta a especializacao do agente ativo no prompt
    const agentPrompt = getActiveAgentPrompt();
    if (agentPrompt) {
        const agentId = getActiveAgent();
        const agent = getAgentById(agentId);
        const agentName = agent ? agent.name : agentId;

        basePrompt += `

═══════════════════════════════════════════════════════════════
AGENT SPECIALIZATION: ${agentName}
═══════════════════════════════════════════════════════════════

${agentPrompt}`;
    }

    // Inject behavioral tool prompt additions (e.g. Critical Review mode)
    // Injeta instrucoes de ferramentas comportamentais ativas
    const toolPromptAdditions = getActivePromptAdditions();
    if (toolPromptAdditions) {
        basePrompt += `

═══════════════════════════════════════════════════════════════
FERRAMENTAS DE COMPORTAMENTO ATIVAS
═══════════════════════════════════════════════════════════════

${toolPromptAdditions}`;
    }

    // Inject professional validation context
    // Injeta contexto de validacao profissional se presente
    const validationCtx = getProfessionalValidationContext();
    if (validationCtx) {
        basePrompt += `

═══════════════════════════════════════════════════════════════
VALIDAÇÃO PROFISSIONAL
═══════════════════════════════════════════════════════════════

${validationCtx}`;
    }

    return basePrompt;
}

// ================================================================
// LITE PROMPT — Para engines com contexto limitado (browser/local)
// ================================================================

/**
 * Build lightweight prompt for browser/local engines.
 * Modo conversacional — sem JSON, sem acoes estruturadas.
 * Target: ~500-800 tokens (vs ~5K-8K do prompt completo).
 *
 * @returns {string}
 */
export function buildLitePrompt() {
    const elements = getAllElements();
    const campaigns = getAllCampaigns();
    const families = getEnabledFamilies();

    const elemCount = elements.length;
    const campCount = campaigns.length;

    // Gera resumo compacto de tipos de elementos presentes
    const familySet = [...new Set(elements.map((e) => e.family))];
    const familySummary =
        familySet.length > 0 ? `\n  Tipos presentes: ${familySet.map((f) => getFamilyName(f)).join(', ')}` : '';

    let prompt = `Você é um assistente especializado em monitoramento ambiental para o sistema ecbyts.

CONTEXTO:
- Elementos no modelo: ${elemCount}${familySummary}
- Campanhas cadastradas: ${campCount}
- Famílias de elementos ativas: ${families.length}

INSTRUÇÕES:
1. Responda em linguagem natural, amigável e em português
2. Você pode discutir técnicas de monitoramento, parâmetros ambientais, regulamentação (CONAMA, CETESB, EPA) e boas práticas
3. Se o usuário pedir para executar ações no modelo (adicionar elementos, observações, campanhas), explique que essas ações requerem o modo Cloud — oriente a trocar nas configurações
4. Mantenha respostas concisas e práticas`;

    // Injeta especializacao de agente (versao compacta)
    const agentPrompt = getActiveAgentPrompt();
    if (agentPrompt) {
        const agentId = getActiveAgent();
        const agent = getAgentById(agentId);
        const agentName = agent ? agent.name : agentId;
        prompt += `\n\nESPECIALIZAÇÃO (${agentName}):\n${agentPrompt}`;
    }

    return prompt;
}

// ================================================================
// PROFESSIONAL VALIDATION CONTEXT
// ================================================================

/**
 * Build professional validation context for the system prompt.
 * Gera contexto de validacao profissional para o prompt.
 *
 * @returns {string|null} - Contexto ou null se nao aplicavel
 */
function getProfessionalValidationContext() {
    const validation = getValidationInfo();
    if (!validation) return null;

    const validatedElements = validation.elements || [];
    if (validatedElements.length === 0) return null;

    const dateStr = validation.validatedAt
        ? new Date(validation.validatedAt).toLocaleDateString('pt-BR')
        : 'desconhecida';

    return `Este modelo possui VALIDAÇÃO PROFISSIONAL.
Profissional responsável: ${validation.displayName} (${validation.councilId})
Data da validação: ${dateStr}
Assinatura ativa: ${validation.subscriptionActive ? 'Sim' : 'Não (expirada)'}

Elementos com selo profissional: ${validatedElements.join(', ')}

REGRAS ESPECIAIS PARA DADOS VALIDADOS:
1. Dados em elementos validados têm MAIOR CONFIABILIDADE — priorize-os em análises
2. Se houver conflito entre dados validados e não-validados, sinalize e dê preferência aos validados
3. Ao sugerir ações, indique quando um dado validado será afetado
4. Em análises de tendência, destaque que séries validadas têm respaldo técnico
5. Se a assinatura estiver expirada, informe que a validação pode estar desatualizada`;
}

// ================================================================
// HELPERS
// ================================================================

// ================================================================
// TOOL ACTIONS — Acoes condicionais baseadas em ferramentas ativas
// ================================================================

/**
 * Builds prompt section for tool-based actions.
 * Gera a secao do prompt com as acoes das ferramentas ativas.
 * Se nenhuma ferramenta estiver ativa, retorna string vazia.
 *
 * @returns {string}
 */
function getToolActionsPrompt() {
    const activeActions = getActiveToolActions();
    if (activeActions.length === 0) return '';

    const TOOL_ACTION_DEFS = {
        ANALYZE_TRENDS: `
7. ANALYZE_TRENDS - Analisar tendências temporais das observações
   Executa regressão linear, Mann-Kendall e Sen's Slope em todas as séries ou uma específica
   Parâmetros opcionais: elementId (para analisar apenas um elemento), parameterId
   Exemplos: "analisar tendências", "qual a tendência do benzeno no PM-01?"`,

        SUGGEST_SAMPLING: `
8. SUGGEST_SAMPLING - Sugerir pontos ótimos para nova campanha de amostragem
   Calcula cobertura espacial e identifica lacunas na malha de monitoramento
   Parâmetros opcionais: count (número de pontos, default 5)
   Exemplos: "onde devo instalar novos poços?", "sugerir pontos de amostragem"`,

        CLEAR_MARKERS: `
   CLEAR_MARKERS - Remover marcadores de recomendação da cena 3D
   Sem parâmetros. Exemplos: "limpar marcadores", "remover pontos sugeridos"`,

        RUN_AUDIT: `
9. RUN_AUDIT - Executar auditoria ESG anti-greenwashing
   Roda testes estatísticos (Benford), verifica qualidade da investigação e analisa alegações
   Parâmetros opcionais: reportText (texto do relatório para analisar alegações)
   Exemplos: "auditar os dados", "verificar qualidade dos dados", "rodar auditoria ESG"`,

        SITE_RESEARCH: `
10. SITE_RESEARCH - Pesquisar dados públicos de uma área para modelo conceitual
   Consulta Nominatim (geocodificação), IBGE (município) e Overpass (entorno)
   Parâmetros: address (endereço ou nome), lat, lon, radius (metros, default 1000)
   Exemplos: "pesquisar área na Rua Augusta 100, São Paulo", "buscar dados de -23.55, -46.63", "pesquisar entorno do posto Shell Ipiranga"`,

        POPULATE_FROM_RESEARCH: `
11. POPULATE_FROM_RESEARCH - Inserir dados da pesquisa no modelo
   Usa o resultado da última SITE_RESEARCH para popular o modelo automaticamente.
   Cria elementos (corpos d'água, indústrias, áreas sensíveis), preenche coordenadas e dados do projeto.
   Parâmetros opcionais: categories (array: "waterBodies", "industries", "sensitiveSites"), includeCoordinates (boolean), mode ("append" ou "replace")
   IMPORTANTE: mode default é "append" (adiciona sem apagar). Só use mode:"replace" se o usuário pedir explicitamente para substituir/limpar o modelo.
   Exemplos: "inserir dados no modelo", "popular modelo", "adicionar ao modelo", "usar esses dados"`,
    };

    let section = '\n═ FERRAMENTAS ATIVAS ═\n';
    for (const action of activeActions) {
        if (TOOL_ACTION_DEFS[action]) {
            section += TOOL_ACTION_DEFS[action];
        }
    }
    return section;
}

/**
 * Formata a mensagem do usuário para envio
 * @param {string} userInput - Texto digitado pelo usuário
 * @returns {string}
 */
export function formatUserMessage(userInput) {
    return `Comando do usuário: "${userInput}"

Analise o comando acima e retorne a resposta em formato JSON conforme instruído.`;
}

/**
 * Gera resumo do contexto atual (para debug)
 * @returns {Object}
 */
export function getContextSummary() {
    return {
        elements: getAllElements().length,
        campaigns: getAllCampaigns().length,
        parameters: CONFIG.PARAMETERS.length,
        families: getEnabledFamilies().length,
    };
}

// ================================================================
// AGENTIC PROMPT — Estende o prompt completo com function calling
// ================================================================

/**
 * Constroi prompt agentic com definicoes de funcoes.
 * Usado pelo agent loop para multi-turn reasoning.
 * Inclui funcoes QUERY_STATE, QUERY_COMPLIANCE, START_WORKFLOW.
 *
 * @returns {string}
 */
export function buildAgenticPrompt() {
    let prompt = buildSystemPrompt();

    // Adiciona secao de funcoes agenticas
    const functionsSection = buildFunctionDefinitionsPrompt();

    prompt += `

═══════════════════════════════════════════════════════════════
MODO AGENTIC — CONSULTAS E WORKFLOWS
═══════════════════════════════════════════════════════════════

Você pode consultar o estado do modelo ANTES de responder.
Consultas de estado (QUERY_*) são executadas automaticamente sem confirmação.
Retorne uma consulta como action normal em JSON — o resultado será fornecido para você continuar.

${functionsSection}`;

    return prompt;
}
