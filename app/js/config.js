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
   CONFIGURACOES DA APLICACAO
   ================================================================

   Este arquivo centraliza todas as configuracoes do ecbyts.
   Separar configuracoes facilita ajustes sem mexer na logica.

   ORGANIZACAO:
   1. CONFIG: Configuracoes gerais (versao, prefixos, cores)
   2. FAMILIES: Registro de tipos de elementos

   ================================================================ */

// ----------------------------------------------------------------
// APP VERSION — localStorage migration
// ----------------------------------------------------------------

/**
 * Versao de dados locais. Incrementar quando houver breaking changes
 * na estrutura de dados do localStorage (Category C: modelo, NN, voxel, etc.).
 * NÃO relacionada a CONFIG.VERSION (que é para chaves ECO1).
 */
export const APP_VERSION = '0.1.5';

// ----------------------------------------------------------------
// CONFIGURACOES GERAIS
// ----------------------------------------------------------------

/**
 * Objeto principal de configuracoes.
 * Contem valores que controlam o comportamento da aplicacao.
 */
export const CONFIG = {
    /**
     * Versao atual da aplicacao.
     * Usada na geracao de chaves de exportacao.
     */
    VERSION: '1.0.0',

    /**
     * Versao das chaves com blockchain.
     * ECO1 blockchain inclui hash-chain, assinatura digital e Merkle Tree.
     */
    VERSION_BLOCKCHAIN: '1.0.0',

    /**
     * Feature flags para rollout gradual de modulos em desenvolvimento.
     * Default: true para itens estaveis de roadmap, exceto IFC (condicional).
     */
    FEATURES: {
        VALIDATION_PROFILES: true,
        DOMAIN_VALIDATORS: true,
        SPATIAL_HIERARCHY: true,
        ISSUES_3D: true,
        GEOML_MAPS: true,
        BROADCAST_SYNC: true,
        ADVANCED_GEOREF_ENGINE: false,
        IFC_IMPORT: false,
        INVITE_ONLY: false,
    },

    /**
     * Habilita RBAC por tipo de acao (canDo/actionOverrides).
     * Quando false, apenas o papel de area e verificado (comportamento anterior).
     * Quando true, regras podem conter actionOverrides por acao (deny/grant).
     */
    ENABLE_ACTION_RBAC: true,

    /**
     * Emails de administradores da plataforma.
     * Usado para gate de acesso ao painel de convites (INV-5).
     * Migrar para coluna `is_platform_admin` em profiles quando houver >5 admins.
     */
    PLATFORM_ADMINS: [],

    /**
     * Prefixo das chaves de exportacao.
     * Todas as chaves comecam com "ECO" (ex: ECO1-PWM-...)
     */
    KEY_PREFIX: 'ECO',

    /**
     * Configuracoes do modulo Blockchain (opcional).
     * O usuario pode habilitar/desabilitar na exportacao.
     */
    BLOCKCHAIN: {
        /**
         * Se o modulo blockchain esta habilitado por padrao.
         * Quando false, exporta como ECO1 (simples).
         * Quando true, exporta como ECO1 blockchain (com verificacao).
         */
        ENABLED_BY_DEFAULT: false,

        /**
         * Algoritmo de chaves criptograficas.
         * ECDSA P-256 e padrao e seguro.
         */
        KEY_ALGORITHM: {
            name: 'ECDSA',
            namedCurve: 'P-256',
        },

        /**
         * Algoritmo de hash.
         */
        HASH_ALGORITHM: 'SHA-256',

        /**
         * Tamanhos dos campos na chave ECO1 blockchain.
         */
        FIELD_LENGTHS: {
            KEY_ID: 8, // ID da chave publica (hex)
            PREV_HASH: 12, // Hash da versao anterior (Base64URL)
            MERKLE_ROOT: 16, // Raiz Merkle (Base64URL)
            SIGNATURE: 64, // Assinatura ECDSA (Base64URL)
        },
    },

    /**
     * Paleta de cores para diferentes elementos 3D.
     * Valores em hexadecimal para uso com Three.js.
     */
    COLORS: {
        /**
         * Cores das plumas de contaminacao por profundidade.
         * Cores mais quentes (vermelho) = mais superficial
         * Cores mais frias (amarelo) = mais profundo
         */
        plume: {
            shallow: 0xff6b6b, // Vermelho - raso (0-15m)
            middle: 0xffa94d, // Laranja - medio (15-40m)
            deep: 0xffd43b, // Amarelo - profundo (40-80m)
        },

        /**
         * Cores para corpos d'agua.
         */
        water: {
            lake: 0x4a90d9, // Azul escuro - lagos
            river: 0x5fa8d3, // Azul claro - rios
        },

        /**
         * Cores das camadas geologicas.
         * Baseadas em cores realistas de cada tipo de solo/rocha.
         */
        geology: {
            topsoil: 0x8b4513, // Marrom - solo superficial
            sand: 0xf4a460, // Bege - areia/cascalho
            clay: 0x708090, // Cinza - argila
            sandstone: 0xdeb887, // Bege claro - arenito
            shale: 0x2f4f4f, // Cinza escuro - folhelho
            limestone: 0xd3d3d3, // Cinza claro - calcario
        },
    },

    /**
     * Definicao das camadas estratigraficas (geologicas).
     * Cada camada tem:
     * - id: identificador unico
     * - name: nome para exibicao
     * - top: profundidade do topo (negativo = abaixo do solo)
     * - bottom: profundidade da base
     * - color: cor em hexadecimal
     */
    STRATA: [
        {
            id: 'topsoil',
            name: 'Topsoil', // Solo superficial
            top: 0,
            bottom: -3,
            color: 0x8b4513,
        },
        {
            id: 'sand',
            name: 'Sand/Gravel', // Areia e cascalho (aquifero)
            top: -3,
            bottom: -15,
            color: 0xf4a460,
        },
        {
            id: 'clay',
            name: 'Clay', // Argila (aquitarde)
            top: -15,
            bottom: -19,
            color: 0x708090,
        },
        {
            id: 'sandstone',
            name: 'Sandstone', // Arenito (aquifero)
            top: -19,
            bottom: -40,
            color: 0xdeb887,
        },
        {
            id: 'shale',
            name: 'Shale', // Folhelho (aquitarde)
            top: -40,
            bottom: -45,
            color: 0x2f4f4f,
        },
        {
            id: 'limestone',
            name: 'Limestone', // Calcario (aquifero carstico)
            top: -45,
            bottom: -80,
            color: 0xd3d3d3,
        },
    ],

    /**
     * Catálogo de unidades disponíveis.
     * type: 'SI' para Sistema Internacional, 'custom' para personalizadas
     * dimension: categoria dimensional para conversão
     * toBase: multiplicador para converter para unidade base da dimensão
     * offset: offset para conversões (ex: temperatura)
     */
    UNITS: [
        // Concentração (base: mg/L)
        {
            id: 'mg_L',
            symbol: 'mg/L',
            name: 'Miligramas por litro',
            type: 'SI',
            dimension: 'concentration',
            toBase: 1,
            isBase: true,
        },
        {
            id: 'ug_L',
            symbol: 'µg/L',
            name: 'Microgramas por litro',
            type: 'SI',
            dimension: 'concentration',
            toBase: 0.001,
        },
        { id: 'g_L', symbol: 'g/L', name: 'Gramas por litro', type: 'SI', dimension: 'concentration', toBase: 1000 },
        {
            id: 'mg_kg',
            symbol: 'mg/kg',
            name: 'Miligramas por quilograma',
            type: 'SI',
            dimension: 'mass_concentration',
            toBase: 1,
            isBase: true,
        },
        {
            id: 'ug_kg',
            symbol: 'µg/kg',
            name: 'Microgramas por quilograma',
            type: 'SI',
            dimension: 'mass_concentration',
            toBase: 0.001,
        },
        {
            id: 'ppm',
            symbol: 'ppm',
            name: 'Partes por milhão',
            type: 'SI',
            dimension: 'ratio_ppm',
            toBase: 1,
            isBase: true,
        },
        { id: 'ppb', symbol: 'ppb', name: 'Partes por bilhão', type: 'SI', dimension: 'ratio_ppm', toBase: 0.001 },
        // Comprimento (base: m)
        { id: 'm', symbol: 'm', name: 'Metros', type: 'SI', dimension: 'length', toBase: 1, isBase: true },
        { id: 'cm', symbol: 'cm', name: 'Centímetros', type: 'SI', dimension: 'length', toBase: 0.01 },
        { id: 'mm', symbol: 'mm', name: 'Milímetros', type: 'SI', dimension: 'length', toBase: 0.001 },
        { id: 'km', symbol: 'km', name: 'Quilômetros', type: 'SI', dimension: 'length', toBase: 1000 },
        // Temperatura (base: celsius, usa offset para kelvin)
        {
            id: 'celsius',
            symbol: '°C',
            name: 'Celsius',
            type: 'SI',
            dimension: 'temperature',
            toBase: 1,
            offset: 0,
            isBase: true,
        },
        { id: 'kelvin', symbol: 'K', name: 'Kelvin', type: 'SI', dimension: 'temperature', toBase: 1, offset: -273.15 },
        {
            id: 'fahrenheit',
            symbol: '°F',
            name: 'Fahrenheit',
            type: 'custom',
            dimension: 'temperature',
            toBase: 5 / 9,
            offset: -32,
            formula: '(value - 32) * 5/9',
        },
        // Percentual
        { id: 'percent', symbol: '%', name: 'Percentual', type: 'SI', dimension: 'ratio', toBase: 1, isBase: true },
        { id: 'decimal', symbol: 'dec', name: 'Decimal (0-1)', type: 'SI', dimension: 'ratio', toBase: 100 },
        // Adimensional (sem conversão)
        {
            id: 'pH',
            symbol: 'pH',
            name: 'Potencial Hidrogeniônico',
            type: 'SI',
            dimension: 'pH',
            toBase: 1,
            isBase: true,
        },
        // Condutividade (base: µS/cm)
        {
            id: 'uS_cm',
            symbol: 'µS/cm',
            name: 'Microsiemens por centímetro',
            type: 'SI',
            dimension: 'conductivity',
            toBase: 1,
            isBase: true,
        },
        {
            id: 'mS_cm',
            symbol: 'mS/cm',
            name: 'Milisiemens por centímetro',
            type: 'SI',
            dimension: 'conductivity',
            toBase: 1000,
        },
        // Potencial (base: mV)
        { id: 'mV', symbol: 'mV', name: 'Milivolts', type: 'SI', dimension: 'potential', toBase: 1, isBase: true },
        { id: 'V', symbol: 'V', name: 'Volts', type: 'SI', dimension: 'potential', toBase: 1000 },
        // Vazão (base: L/s)
        {
            id: 'L_s',
            symbol: 'L/s',
            name: 'Litros por segundo',
            type: 'SI',
            dimension: 'flow',
            toBase: 1,
            isBase: true,
        },
        { id: 'm3_h', symbol: 'm³/h', name: 'Metros cúbicos por hora', type: 'SI', dimension: 'flow', toBase: 0.27778 },
        { id: 'm3_s', symbol: 'm³/s', name: 'Metros cúbicos por segundo', type: 'SI', dimension: 'flow', toBase: 1000 },
        { id: 'L_min', symbol: 'L/min', name: 'Litros por minuto', type: 'SI', dimension: 'flow', toBase: 1 / 60 },
        // Sem unidade
        { id: 'none', symbol: '-', name: 'Sem unidade', type: 'SI', dimension: 'none', toBase: 1, isBase: true },

        // ================================================================
        // UNIDADES ESTENDIDAS ESG & H&S
        // ================================================================

        // Massa
        { id: 't', symbol: 't', name: 'Toneladas', type: 'SI', dimension: 'mass', toBase: 1000 },
        { id: 'kg', symbol: 'kg', name: 'Quilogramas', type: 'SI', dimension: 'mass', toBase: 1, isBase: true },
        { id: 'g', symbol: 'g', name: 'Gramas', type: 'SI', dimension: 'mass', toBase: 0.001 },

        // Volume estendido
        { id: 'm3', symbol: 'm³', name: 'Metros cúbicos', type: 'SI', dimension: 'volume', toBase: 1000 },

        // Concentração atmosférica
        {
            id: 'mg_m3',
            symbol: 'mg/m³',
            name: 'Miligramas por metro cúbico',
            type: 'SI',
            dimension: 'air_concentration',
            toBase: 1,
            isBase: true,
        },
        {
            id: 'ug_m3',
            symbol: 'µg/m³',
            name: 'Microgramas por metro cúbico',
            type: 'SI',
            dimension: 'air_concentration',
            toBase: 0.001,
        },
        {
            id: 'mg_Nm3',
            symbol: 'mg/Nm³',
            name: 'Miligramas por Nm³ (CNTP)',
            type: 'SI',
            dimension: 'air_concentration_norm',
            toBase: 1,
            isBase: true,
        },

        // Emissões GEE
        {
            id: 'tCO2e',
            symbol: 'tCO2e',
            name: 'Toneladas de CO2 equivalente',
            type: 'SI',
            dimension: 'emission',
            toBase: 1,
            isBase: true,
        },
        {
            id: 'kgCO2e',
            symbol: 'kgCO2e',
            name: 'Quilogramas de CO2 equivalente',
            type: 'SI',
            dimension: 'emission',
            toBase: 0.001,
        },

        // Intensidade
        {
            id: 'tCO2e_unit',
            symbol: 'tCO2e/un',
            name: 'tCO2e por unidade',
            type: 'SI',
            dimension: 'intensity_emission',
            toBase: 1,
            isBase: true,
        },
        {
            id: 'm3_unit',
            symbol: 'm³/un',
            name: 'm³ por unidade produzida',
            type: 'SI',
            dimension: 'intensity_water',
            toBase: 1,
            isBase: true,
        },

        // Área
        { id: 'ha', symbol: 'ha', name: 'Hectares', type: 'SI', dimension: 'area', toBase: 10000 },
        { id: 'm2', symbol: 'm²', name: 'Metros quadrados', type: 'SI', dimension: 'area', toBase: 1, isBase: true },

        // Taxas H&S
        {
            id: 'per_1M_hh',
            symbol: '/1M hh',
            name: 'Por milhão de horas-homem',
            type: 'SI',
            dimension: 'rate_hs',
            toBase: 1,
            isBase: true,
        },
        {
            id: 'per_200k_hh',
            symbol: '/200k hh',
            name: 'Por 200 mil horas (OSHA)',
            type: 'SI',
            dimension: 'rate_hs',
            toBase: 0.2,
        },
        {
            id: 'days_per_1M',
            symbol: 'dias/1M hh',
            name: 'Dias perdidos por milhão hh',
            type: 'SI',
            dimension: 'severity',
            toBase: 1,
            isBase: true,
        },

        // Energia
        { id: 'MWh', symbol: 'MWh', name: 'Megawatt-hora', type: 'SI', dimension: 'energy', toBase: 1000 },
        { id: 'kWh', symbol: 'kWh', name: 'Quilowatt-hora', type: 'SI', dimension: 'energy', toBase: 1, isBase: true },
        { id: 'GJ', symbol: 'GJ', name: 'Gigajoules', type: 'SI', dimension: 'energy', toBase: 277.78 },

        // Ruído
        {
            id: 'dBA',
            symbol: 'dB(A)',
            name: 'Decibéis ponderados A',
            type: 'SI',
            dimension: 'noise',
            toBase: 1,
            isBase: true,
        },

        // Contagem
        { id: 'count', symbol: 'un', name: 'Unidades', type: 'SI', dimension: 'count', toBase: 1, isBase: true },

        // Score/Índice
        { id: 'score', symbol: 'pts', name: 'Pontuação', type: 'SI', dimension: 'score', toBase: 1, isBase: true },
    ],

    /**
     * Catálogo de parâmetros de medição.
     * Cada parâmetro tem uma unidade padrão e campos customizados associados.
     */
    PARAMETERS: [
        {
            id: 'pH',
            name: 'pH',
            names: { en: 'pH', es: 'pH' },
            defaultUnitId: 'pH',
            type: 'SI',
            category: 'chemical',
            allowedCustomFields: ['temperature', 'sample_depth'],
        },
        {
            id: 'conductivity',
            name: 'Condutividade Elétrica',
            names: { en: 'Electrical Conductivity', es: 'Conductividad Eléctrica' },
            defaultUnitId: 'uS_cm',
            type: 'SI',
            category: 'physical',
            allowedCustomFields: ['temperature', 'sample_depth'],
        },
        {
            id: 'temperature',
            name: 'Temperatura',
            names: { en: 'Temperature', es: 'Temperatura' },
            defaultUnitId: 'celsius',
            type: 'SI',
            category: 'physical',
            allowedCustomFields: ['sample_depth'],
        },
        {
            id: 'redox',
            name: 'Potencial Redox (ORP)',
            names: { en: 'Redox Potential (ORP)', es: 'Potencial Redox (ORP)' },
            defaultUnitId: 'mV',
            type: 'SI',
            category: 'chemical',
            allowedCustomFields: ['temperature', 'sample_depth'],
        },
        {
            id: 'btex',
            name: 'BTEX',
            names: { en: 'BTEX', es: 'BTEX' },
            casNumber: null,
            defaultUnitId: 'ug_L',
            type: 'SI',
            category: 'contaminant',
            allowedCustomFields: ['sample_depth', 'detection_limit'],
        },
        {
            id: 'tph',
            name: 'TPH (Hidrocarbonetos Totais)',
            names: { en: 'TPH (Total Petroleum Hydrocarbons)', es: 'TPH (Hidrocarburos Totales de Petróleo)' },
            casNumber: null,
            defaultUnitId: 'mg_L',
            type: 'SI',
            category: 'contaminant',
            allowedCustomFields: ['sample_depth', 'detection_limit', 'fraction'],
        },
        {
            id: 'voc',
            name: 'VOC (Compostos Orgânicos Voláteis)',
            names: { en: 'VOC (Volatile Organic Compounds)', es: 'COV (Compuestos Orgánicos Volátiles)' },
            casNumber: null,
            defaultUnitId: 'ug_L',
            type: 'SI',
            category: 'contaminant',
            allowedCustomFields: ['sample_depth', 'detection_limit'],
        },
        {
            id: 'benzene',
            name: 'Benzeno',
            names: { en: 'Benzene', es: 'Benceno' },
            casNumber: '71-43-2',
            defaultUnitId: 'ug_L',
            type: 'SI',
            category: 'contaminant',
            allowedCustomFields: ['sample_depth', 'detection_limit'],
        },
        {
            id: 'toluene',
            name: 'Tolueno',
            names: { en: 'Toluene', es: 'Tolueno' },
            casNumber: '108-88-3',
            defaultUnitId: 'ug_L',
            type: 'SI',
            category: 'contaminant',
            allowedCustomFields: ['sample_depth', 'detection_limit'],
        },
        {
            id: 'ethylbenzene',
            name: 'Etilbenzeno',
            names: { en: 'Ethylbenzene', es: 'Etilbenceno' },
            casNumber: '100-41-4',
            defaultUnitId: 'ug_L',
            type: 'SI',
            category: 'contaminant',
            allowedCustomFields: ['sample_depth', 'detection_limit'],
        },
        {
            id: 'xylenes',
            name: 'Xilenos',
            names: { en: 'Xylenes', es: 'Xilenos' },
            casNumber: '1330-20-7',
            defaultUnitId: 'ug_L',
            type: 'SI',
            category: 'contaminant',
            allowedCustomFields: ['sample_depth', 'detection_limit'],
        },
        {
            id: 'naphthalene',
            name: 'Naftaleno',
            names: { en: 'Naphthalene', es: 'Naftaleno' },
            casNumber: '91-20-3',
            defaultUnitId: 'ug_L',
            type: 'SI',
            category: 'contaminant',
            allowedCustomFields: ['sample_depth', 'detection_limit'],
        },
        {
            id: 'water_level',
            name: "Nível d'água",
            names: { en: 'Water Level', es: 'Nivel del Agua' },
            defaultUnitId: 'm',
            type: 'SI',
            category: 'hydrogeology',
            allowedCustomFields: ['reference_elevation', 'measurement_method'],
        },
        {
            id: 'flow_rate',
            name: 'Vazão',
            names: { en: 'Flow Rate', es: 'Caudal' },
            defaultUnitId: 'L_s',
            type: 'SI',
            category: 'hydrogeology',
            allowedCustomFields: ['measurement_method'],
        },

        // ================================================================
        // PARAMETROS ESG & H&S
        // Variaveis ambientais, seguranca e biodiversidade
        // ================================================================

        // --- Emissões ---
        {
            id: 'ghg_scope1',
            name: 'GHG Scope 1',
            names: { en: 'GHG Scope 1', es: 'GEI Alcance 1' },
            defaultUnitId: 'tCO2e',
            type: 'SI',
            category: 'emission',
            allowedCustomFields: [],
        },
        {
            id: 'ghg_scope2',
            name: 'GHG Scope 2',
            names: { en: 'GHG Scope 2', es: 'GEI Alcance 2' },
            defaultUnitId: 'tCO2e',
            type: 'SI',
            category: 'emission',
            allowedCustomFields: [],
        },

        // --- Qualidade do Ar ---
        {
            id: 'pm25',
            name: 'PM2.5',
            names: { en: 'PM2.5', es: 'PM2.5' },
            defaultUnitId: 'ug_m3',
            type: 'SI',
            category: 'air_quality',
            allowedCustomFields: [],
        },
        {
            id: 'pm10',
            name: 'PM10',
            names: { en: 'PM10', es: 'PM10' },
            defaultUnitId: 'ug_m3',
            type: 'SI',
            category: 'air_quality',
            allowedCustomFields: [],
        },
        {
            id: 'nox',
            name: 'NOx',
            names: { en: 'NOx', es: 'NOx' },
            defaultUnitId: 'mg_Nm3',
            type: 'SI',
            category: 'air_quality',
            allowedCustomFields: [],
        },
        {
            id: 'sox',
            name: 'SOx',
            names: { en: 'SOx', es: 'SOx' },
            defaultUnitId: 'mg_Nm3',
            type: 'SI',
            category: 'air_quality',
            allowedCustomFields: [],
        },

        // --- Resíduos ---
        {
            id: 'waste_total',
            name: 'Resíduos Totais',
            names: { en: 'Total Waste', es: 'Residuos Totales' },
            defaultUnitId: 't',
            type: 'SI',
            category: 'waste',
            allowedCustomFields: [],
        },
        {
            id: 'waste_hazardous',
            name: 'Resíduos Perigosos',
            names: { en: 'Hazardous Waste', es: 'Residuos Peligrosos' },
            defaultUnitId: 't',
            type: 'SI',
            category: 'waste',
            allowedCustomFields: [],
        },
        {
            id: 'waste_recycled_pct',
            name: 'Taxa de Reciclagem',
            names: { en: 'Recycling Rate', es: 'Tasa de Reciclaje' },
            defaultUnitId: 'percent',
            type: 'SI',
            category: 'waste',
            allowedCustomFields: [],
        },

        // --- Efluentes ---
        {
            id: 'effluent_flow',
            name: 'Vazão de Efluente',
            names: { en: 'Effluent Flow', es: 'Caudal de Efluente' },
            defaultUnitId: 'm3',
            type: 'SI',
            category: 'effluent',
            allowedCustomFields: [],
        },
        {
            id: 'bod',
            name: 'DBO (Demanda Bioquímica de Oxigênio)',
            names: { en: 'BOD (Biochemical Oxygen Demand)', es: 'DBO (Demanda Bioquímica de Oxígeno)' },
            defaultUnitId: 'mg_L',
            type: 'SI',
            category: 'effluent',
            allowedCustomFields: [],
        },
        {
            id: 'cod',
            name: 'DQO (Demanda Química de Oxigênio)',
            names: { en: 'COD (Chemical Oxygen Demand)', es: 'DQO (Demanda Química de Oxígeno)' },
            defaultUnitId: 'mg_L',
            type: 'SI',
            category: 'effluent',
            allowedCustomFields: [],
        },
        {
            id: 'tss',
            name: 'SST (Sólidos Suspensos Totais)',
            names: { en: 'TSS (Total Suspended Solids)', es: 'SST (Sólidos Suspendidos Totales)' },
            defaultUnitId: 'mg_L',
            type: 'SI',
            category: 'effluent',
            allowedCustomFields: [],
        },

        // --- Segurança do Trabalho ---
        {
            id: 'frequency_rate',
            name: 'Taxa de Frequência',
            names: { en: 'Frequency Rate', es: 'Tasa de Frecuencia' },
            defaultUnitId: 'per_1M_hh',
            type: 'SI',
            category: 'safety',
            allowedCustomFields: [],
        },
        {
            id: 'severity_rate',
            name: 'Taxa de Gravidade',
            names: { en: 'Severity Rate', es: 'Tasa de Gravedad' },
            defaultUnitId: 'days_per_1M',
            type: 'SI',
            category: 'safety',
            allowedCustomFields: [],
        },
        {
            id: 'ltir',
            name: 'LTIR (Lost Time Injury Rate)',
            names: { en: 'LTIR (Lost Time Injury Rate)', es: 'LTIR (Tasa de Lesiones con Tiempo Perdido)' },
            defaultUnitId: 'per_200k_hh',
            type: 'SI',
            category: 'safety',
            allowedCustomFields: [],
        },
        {
            id: 'near_miss',
            name: 'Quase-Acidentes',
            names: { en: 'Near Misses', es: 'Cuasi-Accidentes' },
            defaultUnitId: 'count',
            type: 'SI',
            category: 'safety',
            allowedCustomFields: [],
        },
        {
            id: 'noise_exposure',
            name: 'Exposição ao Ruído',
            names: { en: 'Noise Exposure', es: 'Exposición al Ruido' },
            defaultUnitId: 'dBA',
            type: 'SI',
            category: 'safety',
            allowedCustomFields: [],
        },

        // --- Biodiversidade ---
        {
            id: 'species_count',
            name: 'Contagem de Espécies',
            names: { en: 'Species Count', es: 'Conteo de Especies' },
            defaultUnitId: 'count',
            type: 'SI',
            category: 'biodiversity',
            allowedCustomFields: [],
        },
        {
            id: 'protected_area',
            name: 'Área Protegida',
            names: { en: 'Protected Area', es: 'Área Protegida' },
            defaultUnitId: 'ha',
            type: 'SI',
            category: 'biodiversity',
            allowedCustomFields: [],
        },
        {
            id: 'biodiversity_index',
            name: 'Índice de Biodiversidade',
            names: { en: 'Biodiversity Index', es: 'Índice de Biodiversidad' },
            defaultUnitId: 'score',
            type: 'SI',
            category: 'biodiversity',
            allowedCustomFields: [],
        },
    ],

    /**
     * Campos customizados que podem ser associados a parâmetros.
     * Aparecem dinamicamente baseado no parâmetro selecionado.
     */
    CUSTOM_FIELDS: [
        {
            id: 'cas_number',
            name: 'Número CAS',
            type: 'text',
            placeholder: 'Ex: 71-43-2',
            validForParameters: ['btex', 'tph', 'voc', 'benzene'],
        },
        {
            id: 'sample_depth',
            name: 'Profundidade da Amostra',
            type: 'number',
            unitId: 'm',
            placeholder: 'Ex: 5.5',
            validForParameters: ['pH', 'conductivity', 'temperature', 'redox', 'btex', 'tph', 'voc', 'benzene'],
        },
        {
            id: 'temperature',
            name: 'Temperatura da Amostra',
            type: 'number',
            unitId: 'celsius',
            placeholder: 'Ex: 22.5',
            validForParameters: ['pH', 'conductivity', 'redox'],
        },
        {
            id: 'detection_limit',
            name: 'Limite de Detecção',
            type: 'number',
            placeholder: 'Ex: 0.001',
            validForParameters: ['btex', 'tph', 'voc', 'benzene'],
        },
        {
            id: 'fraction',
            name: 'Fração',
            type: 'select',
            options: ['DRO', 'GRO', 'ORO', 'Total'],
            validForParameters: ['tph'],
        },
        {
            id: 'reference_elevation',
            name: 'Cota de Referência',
            type: 'number',
            unitId: 'm',
            placeholder: 'Ex: 100.5',
            validForParameters: ['water_level'],
        },
        {
            id: 'measurement_method',
            name: 'Método de Medição',
            type: 'select',
            options: ['Medidor eletrônico', 'Fita métrica', 'Transdutor', 'Molinete'],
            validForParameters: ['water_level', 'flow_rate'],
        },
    ],

    /**
     * Observation variables — metadata about the sample/measurement context.
     * Variaveis de observacao descrevem contexto da amostra (matriz, fracao, etc.).
     * Usuarios podem adicionar variaveis customizadas alem das predefinidas.
     *
     * type: 'boolean' (0/1 checkbox), 'select' (dropdown), 'text' (free input)
     * group: agrupamento visual (matrix, sampling)
     */
    OBSERVATION_VARIABLES: [
        // --- Matrix flags (boolean 0/1, adimensional) ---
        // Indica qual compartimento ambiental foi amostrado
        {
            id: 'is_matrix_water',
            name: 'Matriz: Água',
            type: 'boolean',
            defaultValue: 0,
            unitId: 'none',
            group: 'matrix',
        },
        {
            id: 'is_matrix_soil',
            name: 'Matriz: Solo',
            type: 'boolean',
            defaultValue: 0,
            unitId: 'none',
            group: 'matrix',
        },
        { id: 'is_matrix_air', name: 'Matriz: Ar', type: 'boolean', defaultValue: 0, unitId: 'none', group: 'matrix' },
        {
            id: 'is_matrix_biota',
            name: 'Matriz: Biota',
            type: 'boolean',
            defaultValue: 0,
            unitId: 'none',
            group: 'matrix',
        },
        {
            id: 'is_matrix_human',
            name: 'Matriz: Humana',
            type: 'boolean',
            defaultValue: 0,
            unitId: 'none',
            group: 'matrix',
        },
        {
            id: 'is_matrix_geotechnical',
            name: 'Matriz: Geotécnico',
            type: 'boolean',
            defaultValue: 0,
            unitId: 'none',
            group: 'matrix',
        },
        {
            id: 'is_matrix_remote_sensing',
            name: 'Matriz: Sens. Remoto',
            type: 'boolean',
            defaultValue: 0,
            unitId: 'none',
            group: 'matrix',
        },
        {
            id: 'is_matrix_climatology',
            name: 'Matriz: Climatologia',
            type: 'boolean',
            defaultValue: 0,
            unitId: 'none',
            group: 'matrix',
        },
        {
            id: 'is_matrix_resilience',
            name: 'Matriz: Resiliência',
            type: 'boolean',
            defaultValue: 0,
            unitId: 'none',
            group: 'matrix',
        },

        // --- Categorical sampling variables ---
        // Fracao da amostra: total (sem filtragem) ou dissolvida (filtrada 0.45um)
        {
            id: 'fraction',
            name: 'Fração',
            type: 'select',
            options: ['total', 'dissolved', 'suspended', 'volatile', 'extractable'],
            defaultValue: 'total',
            unitId: 'none',
            group: 'sampling',
        },
        // Tipo de coleta: pontual, composta, continua ou passiva
        {
            id: 'sample_type',
            name: 'Tipo de Amostra',
            type: 'select',
            options: ['grab', 'composite', 'continuous', 'passive'],
            defaultValue: 'grab',
            unitId: 'none',
            group: 'sampling',
        },
        // Preservacao da amostra antes da analise
        {
            id: 'preservation',
            name: 'Preservação',
            type: 'select',
            options: ['none', 'refrigerated', 'acidified', 'frozen', 'chemical'],
            defaultValue: 'none',
            unitId: 'none',
            group: 'sampling',
        },

        // --- OHS (Occupational Health & Safety) variables ---
        // Via de exposicao ocupacional: inalacao, dermica, ingestao, ruido, radiacao
        {
            id: 'exposure_route',
            name: 'Via de Exposição',
            type: 'select',
            options: ['inhalation', 'dermal', 'ingestion', 'noise', 'radiation', 'vibration'],
            defaultValue: null,
            unitId: 'none',
            group: 'ohs',
        },
        // Tipo de amostra OHS: pessoal, area, biologica, exame medico
        {
            id: 'sample_type_ohs',
            name: 'Tipo Amostra OHS',
            type: 'select',
            options: ['personal', 'area', 'biological', 'medical'],
            defaultValue: null,
            unitId: 'none',
            group: 'ohs',
        },
        // Matriz biologica para biomonitoramento
        {
            id: 'biological_matrix',
            name: 'Matriz Biológica',
            type: 'select',
            options: ['blood', 'urine', 'hair', 'saliva', 'exhaled_air'],
            defaultValue: null,
            unitId: 'none',
            group: 'ohs',
        },
        // Referencia ao GHE (Grupo Homogeneo de Exposicao) — ID do grupo
        { id: 'ghe_id', name: 'GHE', type: 'text', defaultValue: null, unitId: 'none', group: 'ohs' },
        // Referencia ao trabalhador — ID do element individual
        { id: 'worker_id', name: 'Trabalhador ID', type: 'text', defaultValue: null, unitId: 'none', group: 'ohs' },
        // Status de uso de EPI durante a medicao
        {
            id: 'ppe_status',
            name: 'Status EPI',
            type: 'select',
            options: ['none', 'partial', 'full'],
            defaultValue: null,
            unitId: 'none',
            group: 'ohs',
        },
        // Duracao da exposicao em horas
        { id: 'duration_hours', name: 'Duração (h)', type: 'text', defaultValue: null, unitId: 'h', group: 'ohs' },
        // TWA-8h calculado ou fornecido
        { id: 'twa_8h', name: 'TWA-8h', type: 'text', defaultValue: null, unitId: 'none', group: 'ohs' },
        // Valor do OEL usado como referencia
        { id: 'oel_reference', name: 'OEL Referência', type: 'text', defaultValue: null, unitId: 'none', group: 'ohs' },
        // Fonte do limite ocupacional
        {
            id: 'oel_source',
            name: 'Fonte OEL',
            type: 'select',
            options: ['ACGIH', 'NR-15', 'NIOSH', 'OSHA', 'custom'],
            defaultValue: null,
            unitId: 'none',
            group: 'ohs',
        },
    ],
};

// ----------------------------------------------------------------
// REGISTRO DE FAMILIAS DE ELEMENTOS
// ----------------------------------------------------------------

/**
 * Categorias de constantes definidas pelo usuario.
 * Cada entrada tem um id (interno) e uma labelKey (chave i18n).
 */
export const CONSTANT_CATEGORIES = [
    { id: 'emission', labelKey: 'emissionFactor' },
    { id: 'uncertainty', labelKey: 'uncertaintyFactor' },
    { id: 'equipment', labelKey: 'equipmentPrecision' },
    { id: 'conversion', labelKey: 'conversionFactor' },
    { id: 'custom', labelKey: 'customConstant' },
];

// Injeta no CONFIG para acesso via window
CONFIG.CONSTANT_CATEGORIES = CONSTANT_CATEGORIES;

/**
 * Familias sao categorias de elementos que podem ser adicionados ao modelo.
 * Cada familia define um tipo de objeto (poco, pluma, lago, etc).
 *
 * Propriedades de cada familia:
 * - id: identificador unico (usado internamente)
 * - nameKey: chave de traducao (para i18n)
 * - name: nome direto (para familias personalizadas)
 * - icon: nome do icone SVG (ex: 'well', 'plume')
 * - code: letra para o codigo da chave de exportacao
 * - enabled: se a familia esta ativa
 * - custom: se foi criada pelo usuario
 */
export const DEFAULT_FAMILIES = {
    // Containers espaciais (PDPL-U hierarchy)
    site_project: {
        id: 'site_project',
        name: 'Projeto (Site)',
        icon: 'folder',
        code: 'Q',
        enabled: true,
        isContainer: true,
        allowedChildren: null,
    },
    site_area: {
        id: 'site_area',
        name: 'Area de Investigacao',
        icon: 'map',
        code: 'U',
        enabled: true,
        isContainer: true,
        allowedChildren: null,
    },
    site_zone: {
        id: 'site_zone',
        name: 'Zona',
        icon: 'square',
        code: 'N',
        enabled: true,
        isContainer: true,
        allowedChildren: null,
    },

    /**
     * Pluma de contaminacao - representa area contaminada no subsolo.
     * Elemento principal para modelagem de areas impactadas.
     */
    plume: {
        id: 'plume',
        nameKey: 'contaminationPlume',
        icon: 'plume',
        code: 'P',
        enabled: true,
        isContainer: false,
    },

    /**
     * Poco de monitoramento - usado para coletar amostras de agua.
     * Essencial para acompanhamento da qualidade da agua subterranea.
     */
    well: {
        id: 'well',
        nameKey: 'monitoringWell',
        icon: 'well',
        code: 'W',
        enabled: true,
        isContainer: false,
    },

    /**
     * Lago - corpo d'agua superficial.
     * Pode interagir com o aquifero (recarga ou descarga).
     */
    lake: {
        id: 'lake',
        nameKey: 'lake',
        icon: 'droplet',
        code: 'L',
        enabled: true,
        isContainer: false,
    },

    /**
     * Rio - curso d'agua.
     * Importante para entender fluxo de agua na regiao.
     */
    river: {
        id: 'river',
        nameKey: 'river',
        icon: 'river',
        code: 'R',
        enabled: true,
        isContainer: false,
    },

    /**
     * Edificacao - construcoes na area.
     * Contexto para entender uso do solo.
     */
    building: {
        id: 'building',
        nameKey: 'building',
        icon: 'building',
        code: 'B',
        enabled: true,
        isContainer: false,
    },

    /**
     * Tanque de armazenamento - possivel fonte de contaminacao.
     * Tanques subterraneos podem vazar e contaminar o solo.
     */
    tank: {
        id: 'tank',
        nameKey: 'storageTank',
        icon: 'cylinder',
        code: 'T',
        enabled: true,
        isContainer: false,
    },

    /**
     * Marcador - ponto de referencia generico.
     * Pode indicar qualquer local de interesse.
     */
    marker: {
        id: 'marker',
        nameKey: 'marker',
        icon: 'map-pin',
        code: 'M',
        enabled: true,
        isContainer: false,
    },

    /**
     * Limite - contorno da area de estudo.
     * Define os limites geograficos do modelo.
     */
    boundary: {
        id: 'boundary',
        nameKey: 'boundary',
        icon: 'square-dashed',
        code: 'Y',
        enabled: true,
        isContainer: false,
    },

    /**
     * Camada geologica - estrato do subsolo.
     * Representa diferentes tipos de solo/rocha.
     */
    stratum: {
        id: 'stratum',
        nameKey: 'geologicalLayer',
        icon: 'layers',
        code: 'G',
        enabled: true,
        isContainer: false,
    },

    /**
     * Nascente - ponto onde a agua subterranea emerge.
     * Indica areas de descarga do aquifero.
     */
    spring: {
        id: 'spring',
        nameKey: 'spring',
        icon: 'spring',
        code: 'S',
        enabled: true,
        isContainer: false,
    },

    /**
     * Ponto de amostragem - local de coleta de amostras.
     * Pode ser solo, agua superficial, etc.
     */
    sample: {
        id: 'sample',
        nameKey: 'samplePoint',
        icon: 'flask',
        code: 'X',
        enabled: true,
        isContainer: false,
    },

    // ================================================================
    // NOVAS FAMÍLIAS ESG & H&S
    // ================================================================

    /**
     * Área organizacional - setor ou zona da planta.
     * Usado para métricas de H&S e alocação de recursos.
     */
    area: {
        id: 'area',
        nameKey: 'organizationalArea',
        icon: 'factory',
        code: 'A',
        enabled: true,
        isContainer: false,
    },

    /**
     * Indivíduo - pessoa, animal ou árvore rastreável.
     * Para H&S (colaboradores) e biodiversidade (fauna/flora).
     */
    individual: {
        id: 'individual',
        nameKey: 'individual',
        icon: 'user',
        code: 'H',
        enabled: true,
        isContainer: false,
    },

    /**
     * Incidente - ocorrência de H&S.
     * Acidentes, quase-acidentes, primeiros socorros.
     */
    incident: {
        id: 'incident',
        nameKey: 'incident',
        icon: 'alert-triangle',
        code: 'I',
        enabled: true,
        isContainer: false,
    },

    /**
     * Fonte de emissão - chaminé, vent, fugitiva.
     * Para inventário de emissões atmosféricas.
     */
    emission_source: {
        id: 'emission_source',
        nameKey: 'emissionSource',
        icon: 'wind',
        code: 'E',
        enabled: true,
        isContainer: false,
    },

    /**
     * Fluxo de resíduo - corrente de resíduo sólido.
     * Para gestão de resíduos e reciclagem.
     */
    waste_stream: {
        id: 'waste_stream',
        nameKey: 'wasteStream',
        icon: 'refresh-cw',
        code: 'Z',
        enabled: true,
        isContainer: false,
    },

    /**
     * Ponto de efluente - descarga de efluentes líquidos.
     * Para monitoramento de qualidade de efluentes.
     */
    effluent_point: {
        id: 'effluent_point',
        nameKey: 'effluentPoint',
        icon: 'droplet',
        code: 'F',
        enabled: true,
        isContainer: false,
    },

    /**
     * Habitat - área de biodiversidade.
     * Ecossistemas, áreas protegidas, zonas de restauração.
     */
    habitat: {
        id: 'habitat',
        nameKey: 'habitat',
        icon: 'tree',
        code: 'D',
        enabled: true,
    },

    /**
     * Sensor — dispositivo de monitoramento remoto (IoT).
     * Coleta dados ambientais em tempo real via protocolo de busca externo.
     * Estado preenchido dinamicamente via getAppData().
     */
    sensor: {
        id: 'sensor',
        nameKey: 'sensor',
        icon: 'radio',
        code: 'N',
        enabled: true,
    },

    // ================================================================
    // FAMILIAS INTANGIVEIS
    // ================================================================

    /**
     * Ativo intangivel — contratos, software, creditos de carbono,
     * certificados de energia verde, licencas ambientais.
     * Representado como sprite flutuante (billboard) na cena 3D.
     */
    intangible: {
        id: 'intangible',
        nameKey: 'intangibleAsset',
        icon: 'sparkles',
        code: 'J',
        enabled: true,
    },

    /**
     * Generico — tipo coringa para elementos que nao se encaixam
     * em nenhuma outra familia. Flexivel para usos diversos.
     */
    generic: {
        id: 'generic',
        nameKey: 'genericElement',
        icon: 'cube',
        code: 'K',
        enabled: true,
    },

    // ================================================================
    // FAMILIAS ESPACIAIS / GIS
    // ================================================================

    /**
     * Blueprint espacial — planta CAD/GIS importada (DXF).
     * Footprint poligonal com camadas, area metrica, compliance ambiental.
     * Pipeline: DXF -> Polygonize -> UTM -> Simplify -> WGS84 -> GeoJSON.
     */
    blueprint: {
        id: 'blueprint',
        nameKey: 'spatialBlueprint',
        icon: 'map',
        code: 'U',
        enabled: true,
    },
};
