# ADR-DATA-OWNER: Data Ownership Layer for ECO1

**Project:** ecbyts / ECBT (Environmental & Occupational Core Byte Tools)
**Author:** Calvin Stefan Iost, 2026
**Status:** Draft (spec-only — 0 JS files implementados; feature prevista para fase pós-registro)
**Date:** 2026-03-10
**Atualizado:** 2026-03-26
**Depends on:** ADR 8 (Client-Side Blockchain Cryptography)

---

## 1. Context

A chave ECO1 hoje estabelece **autoria** (quem criou e assinou o modelo) via ECDSA P-256 + hash chain. Autoria é imutável por design — é um fato histórico.

**Ownership** é um papel distinto e transferível: quem detém o direito de uso, licenciamento e divulgação do modelo em determinado momento. Um modelo pode ter autora permanente (engenheira que criou) e owner variável (empresa contratante, órgão ambiental, novo titular após cessão de direitos).

O recurso é **opt-in** — modelos sem ownership continuam funcionando exatamente como hoje.

---

## 2. Papéis e Distinções

| Papel          | Natureza                    | Mutável | Implementação atual         |
| -------------- | --------------------------- | ------- | --------------------------- |
| Author         | Quem criou e assinou o ECO1 | Não     | ECDSA P-256 (keyManager.js) |
| **Data Owner** | Quem detém o modelo agora   | **Sim** | **A implementar**           |

### 2.1 Tipos de Owner

**PF (Pessoa Física)**

- Identificada por endereço de carteira Ethereum (EOA — Externally Owned Account)
- 1 chave privada → 1 assinatura
- Exemplo: engenheiro autônomo, consultor ambiental

**PJ (Pessoa Jurídica)**

- Identificada por contrato Safe (Gnosis Safe Multisig)
- N chaves, M assinaturas requeridas (ex: 2-de-3)
- Permite exigir aprovação de múltiplos signatários para transferência
- Exemplo: consultoria, empresa mineradora, órgão ambiental

---

## 3. Decisão

Implementar o **Data Owner** como uma camada opcional sobre o ECO1 existente, com dois modos de registro:

### Modo A — Público (on-chain)

- Mint de NFT na rede Base (L2 Ethereum, Coinbase)
- Hash do ECO1 + metadados de ownership armazenados on-chain
- Payload do modelo permanece off-chain (privado ou IPFS)
- Transferência de ownership = transferência do NFT
- Histórico de custódia imutável e público

### Modo B — Privado (off-chain)

- Registro assinado armazenado no Supabase (já existente no projeto)
- Owner assina declaração de posse com chave da carteira Ethereum
- Visível apenas para o owner e partes explicitamente autorizadas
- Transferência via reassinatura no Supabase
- Adequado para modelos confidenciais (passivos ambientais, dados sensíveis)

---

## 4. Estrutura de Dados

### 4.1 Ownership Record

```json
{
    "version": "1.0.0",
    "eco1Hash": "sha256-base64url-do-eco1-completo",
    "owner": {
        "type": "PF",
        "address": "0x...",
        "name": "Razão Social ou Nome",
        "documentHash": "sha256-base64url-do-cpf-ou-cnpj",
        "safe": {
            "address": "0x...",
            "threshold": 2,
            "owners": ["0x...", "0x...", "0x..."]
        }
    },
    "mode": "public",
    "registeredAt": "ISO-8601",
    "expiresAt": null,
    "transferHistory": [
        {
            "from": "0x...",
            "to": "0x...",
            "at": "ISO-8601",
            "txHash": "0x..."
        }
    ],
    "ownerSignature": "0x...",
    "authorEco1Signature": "base64url-truncada-64chars"
}
```

**Campos obrigatórios:** `version`, `eco1Hash`, `owner.type`, `owner.address`, `mode`, `registeredAt`, `ownerSignature`

**`documentHash`:** CPF/CNPJ nunca trafegam em claro. Apenas hash SHA-256 armazenado. Verificação ocorre localmente no browser.

**`authorEco1Signature`:** Referência à assinatura do autor original (do ECO1 blockchain). Liga ownership à autoria.

### 4.2 ECO1 com Ownership (extensão do encoder)

O campo `ownershipRef` é adicionado opcionalmente ao payload do ECO1:

```json
{
    "ecbyts": "2.0.0",
    "project": {},
    "elements": [],
    "ownershipRef": {
        "mode": "public",
        "registryId": "uuid-supabase | tokenId-NFT",
        "ownerAddress": "0x...",
        "registeredAt": "ISO-8601"
    }
}
```

O `ownershipRef` não quebra compatibilidade retroativa — decoders anteriores ignoram campos desconhecidos.

---

## 5. Arquitetura de Módulos

```
app/js/core/ownership/
├── index.js              ← re-export público
├── ownershipManager.js   ← orquestrador principal
├── walletConnector.js    ← conexão MetaMask / Coinbase Wallet
├── ethSigner.js          ← assinar com chave secp256k1 (Ethereum)
├── safeAdapter.js        ← integração Gnosis Safe (PJ)
├── onchainRegistry.js    ← mint NFT na Base L2
├── offchainRegistry.js   ← registro Supabase (privado)
└── ADR.md                ← este documento
```

### 5.1 `walletConnector.js`

```javascript
/**
 * Detecta provedores disponíveis.
 * @returns {Array<{id, name, icon}>}
 */
export function detectWallets()

/**
 * Conecta carteira e retorna endereço.
 * @param {'metamask'|'coinbase'|'walletconnect'} provider
 * @returns {Promise<{address: string, chainId: number}>}
 */
export async function connectWallet(provider)

/**
 * Desconecta carteira ativa.
 */
export async function disconnectWallet()

/**
 * Retorna endereço conectado ou null.
 * @returns {string|null}
 */
export function getConnectedAddress()

/**
 * Solicita troca de rede para Base (chainId 8453).
 * @returns {Promise<void>}
 */
export async function switchToBase()
```

**Dependências:** `@coinbase/wallet-sdk`, `ethers.js` v6 (via CDN com `importCDN()`)

### 5.2 `ethSigner.js`

```javascript
/**
 * Assina ownership record com carteira Ethereum.
 * Usa eth_signTypedData_v4 (EIP-712) para assinatura legível e auditável.
 *
 * @param {Object} ownershipRecord - Registro sem o campo ownerSignature
 * @param {string} address - Endereço da carteira conectada
 * @returns {Promise<string>} - Assinatura hex (0x...)
 */
export async function signOwnershipRecord(ownershipRecord, address)

/**
 * Verifica assinatura de ownership.
 * @param {Object} ownershipRecord - Registro completo com ownerSignature
 * @returns {Promise<boolean>}
 */
export async function verifyOwnershipSignature(ownershipRecord)

/**
 * Reconstrói os dados assinados deterministicamente.
 * @param {Object} ownershipRecord
 * @returns {Object} - EIP-712 typed data
 */
export function buildSignableOwnership(ownershipRecord)
```

**Nota EIP-712:** Typed data permite que a MetaMask exiba os campos legíveis ao usuário antes de assinar — owner vê exatamente o que está assinando (eco1Hash, nome, data).

### 5.3 `safeAdapter.js`

```javascript
/**
 * Verifica se endereço é um contrato Safe válido na Base.
 * @param {string} address
 * @returns {Promise<{isSafe: boolean, threshold: number, owners: string[]}>}
 */
export async function inspectSafe(address)

/**
 * Propõe uma transação de ownership no Safe.
 * @param {string} safeAddress
 * @param {Object} ownershipRecord
 * @returns {Promise<{safeTxHash: string}>}
 */
export async function proposeSafeOwnership(safeAddress, ownershipRecord)

/**
 * Verifica se uma Safe tx de ownership atingiu threshold.
 * @param {string} safeTxHash
 * @returns {Promise<{executed: boolean, confirmations: number, required: number}>}
 */
export async function checkSafeOwnershipStatus(safeTxHash)
```

### 5.4 `onchainRegistry.js`

```javascript
/**
 * Minta NFT de ownership na Base L2.
 * @param {Object} ownershipRecord - Registro assinado
 * @param {string} ownerAddress
 * @returns {Promise<{tokenId: string, txHash: string, contractAddress: string}>}
 */
export async function mintOwnershipNFT(ownershipRecord, ownerAddress)

/**
 * Transfere ownership NFT para novo owner.
 * @param {string} tokenId
 * @param {string} toAddress
 * @returns {Promise<{txHash: string}>}
 */
export async function transferOwnership(tokenId, toAddress)

/**
 * Consulta owner atual de um NFT.
 * @param {string} tokenId
 * @returns {Promise<string>}
 */
export async function getTokenOwner(tokenId)

/**
 * Verifica se eco1Hash já tem NFT registrado.
 * @param {string} eco1Hash
 * @returns {Promise<{exists: boolean, tokenId: string|null}>}
 */
export async function findTokenByEco1Hash(eco1Hash)
```

**Contrato NFT:** ERC-721 mínimo, deployado na Base Mainnet (chainId 8453). Endereço em `config.js → CONFIG.OWNERSHIP.CONTRACT_ADDRESS`.

**Gas estimado por mint:** ~US$0,01–0,05 na Base.

### 5.5 `offchainRegistry.js`

```javascript
/**
 * Registra ownership privado no Supabase.
 * @param {Object} ownershipRecord
 * @returns {Promise<{id: string, createdAt: string}>}
 */
export async function registerPrivateOwnership(ownershipRecord)

/**
 * Busca registro de ownership pelo eco1Hash.
 * @param {string} eco1Hash
 * @returns {Promise<Object|null>}
 */
export async function getPrivateOwnership(eco1Hash)

/**
 * Transfere ownership privado para novo endereço.
 * @param {string} registryId
 * @param {string} newOwnerAddress
 * @param {string} transferSignature
 * @returns {Promise<void>}
 */
export async function transferPrivateOwnership(registryId, newOwnerAddress, transferSignature)

/**
 * Lista todos os modelos onde o endereço conectado é owner.
 * @returns {Promise<Array>}
 */
export async function listOwnedModels()
```

**Schema Supabase — tabela `ownership_records`:**

```sql
CREATE TABLE ownership_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  eco1_hash     TEXT NOT NULL UNIQUE,
  owner_address TEXT NOT NULL,
  owner_type    TEXT NOT NULL CHECK (owner_type IN ('PF', 'PJ')),
  owner_name    TEXT,
  document_hash TEXT,
  record_data   JSONB NOT NULL,
  mode          TEXT NOT NULL DEFAULT 'private',
  created_at    TIMESTAMPTZ DEFAULT now(),
  expires_at    TIMESTAMPTZ,
  transferred_to TEXT,
  transferred_at TIMESTAMPTZ
);

ALTER TABLE ownership_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_access" ON ownership_records
  FOR ALL USING (
    owner_address = current_setting('app.wallet_address', true)
  );
```

### 5.6 `ownershipManager.js`

```javascript
/**
 * Ponto de entrada principal para registrar ownership.
 *
 * @param {Object} params
 * @param {string} params.eco1Key
 * @param {'PF'|'PJ'} params.ownerType
 * @param {string} params.ownerAddress
 * @param {string} params.ownerName
 * @param {string} params.documentHash
 * @param {'public'|'private'} params.mode
 * @param {string|null} params.expiresAt
 * @returns {Promise<OwnershipResult>}
 */
export async function registerOwnership(params)

/**
 * Transfere ownership para novo endereço.
 * @param {string} eco1Hash
 * @param {string} toAddress
 * @param {'public'|'private'} mode
 * @returns {Promise<void>}
 */
export async function transferOwnership(eco1Hash, toAddress, mode)

/**
 * Verifica ownership de um ECO1.
 * @param {string} eco1Key
 * @returns {Promise<OwnershipVerificationResult>}
 */
export async function verifyOwnership(eco1Key)

/**
 * Retorna ownership record de um modelo.
 * @param {string} eco1Hash
 * @returns {Promise<Object|null>}
 */
export async function getOwnership(eco1Hash)
```

---

## 6. Fluxo de Usuário

```
Exportar modelo (fluxo existente)
│
└── [Ativar Data Owner?] toggle off por padrão
    │
    ├── OFF → ECO1 padrão (sem mudança)
    │
    └── ON
        ├── Conectar carteira (MetaMask / Coinbase Wallet / WalletConnect)
        ├── Tipo: PF (endereço EOA) ou PJ (endereço Safe)
        ├── Visibilidade: Público (on-chain Base) ou Privado (Supabase)
        ├── Validade (opcional)
        ├── [Revisar e assinar] — modal EIP-712 na carteira
        └── Confirmar
            ├── Público  → aguardar tx Base (~5–15s) → tokenId retornado
            └── Privado  → registro Supabase imediato → UUID retornado
```

---

## 7. Integração com ECO1 Existente

### 7.1 encoder.js — adição mínima

```javascript
// Em buildBlockchainKey() e buildSimpleKey(), após montar o model object:
if (ownershipOptions?.enabled && ownershipOptions?.ref) {
    model.ownershipRef = {
        mode: ownershipOptions.ref.mode,
        registryId: ownershipOptions.ref.registryId,
        ownerAddress: ownershipOptions.ref.ownerAddress,
        registeredAt: ownershipOptions.ref.registeredAt,
    };
}
```

### 7.2 decoder.js — adição mínima

```javascript
// Após decodificação do model JSON:
if (model.ownershipRef) {
    result.ownership = model.ownershipRef;
}
```

### 7.3 config.js — novas entradas

```javascript
OWNERSHIP: {
  ENABLED: true,
  BASE_CHAIN_ID: 8453,
  BASE_RPC_URL: 'https://mainnet.base.org',
  CONTRACT_ADDRESS: '0x...', // após deploy
  SUPABASE_TABLE: 'ownership_records',
  SUPPORTED_WALLETS: ['metamask', 'coinbase', 'walletconnect'],
  EIP712_DOMAIN: {
    name: 'ecbyts Data Ownership',
    version: '1',
    chainId: 8453
  }
}
```

---

## 8. Contrato NFT (Solidity)

```solidity
// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ECBTOwnership
 * @notice Registro de ownership de modelos ECBT/ecbyts.
 * @dev ERC-721 mínimo. Um eco1Hash só pode ter um tokenId (unicidade forçada).
 */
contract ECBTOwnership is ERC721, Ownable {

    uint256 private _tokenIdCounter;

    mapping(bytes32 => uint256) public eco1HashToToken;
    mapping(uint256 => bytes32) public tokenToEco1Hash;
    mapping(uint256 => string) private _tokenURIs;

    event OwnershipRegistered(
        uint256 indexed tokenId,
        bytes32 indexed eco1Hash,
        address indexed owner
    );

    constructor() ERC721("ECBT Data Ownership", "ECBT-OWN") Ownable(msg.sender) {}

    function mint(
        bytes32 eco1Hash,
        address to,
        string calldata tokenURI_
    ) external returns (uint256) {
        require(eco1HashToToken[eco1Hash] == 0, "ECO1 already registered");
        require(to != address(0), "Invalid owner address");

        _tokenIdCounter++;
        uint256 tokenId = _tokenIdCounter;

        _safeMint(to, tokenId);
        _tokenURIs[tokenId] = tokenURI_;
        eco1HashToToken[eco1Hash] = tokenId;
        tokenToEco1Hash[tokenId] = eco1Hash;

        emit OwnershipRegistered(tokenId, eco1Hash, to);
        return tokenId;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _tokenURIs[tokenId];
    }

    function isRegistered(bytes32 eco1Hash) external view returns (bool) {
        return eco1HashToToken[eco1Hash] != 0;
    }

    function ownerOfEco1(bytes32 eco1Hash) external view returns (address) {
        uint256 tokenId = eco1HashToToken[eco1Hash];
        require(tokenId != 0, "Not registered");
        return ownerOf(tokenId);
    }
}
```

**Deploy:** Hardhat ou Foundry na Base Testnet primeiro, depois Mainnet. Endereço em `config.js`.

---

## 9. Dependências Externas

| Biblioteca             | Versão | Uso                                       |
| ---------------------- | ------ | ----------------------------------------- |
| ethers.js              | v6     | Ethereum provider, EIP-712, tx            |
| @coinbase/wallet-sdk   | v4     | Coinbase Wallet connector                 |
| @safe-global/api-kit   | latest | Consulta Safe on-chain (somente fluxo PJ) |
| OpenZeppelin Contracts | v5     | Base do contrato NFT (deploy-time apenas) |

Todas importadas via CDN usando `importCDN()` de `utils/helpers/cdnLoader.js`.

---

## 10. Segurança e Privacidade

- **CPF/CNPJ nunca em claro:** Apenas `documentHash = SHA-256(document + salt)` armazenado.
- **Chave privada do autor:** Não muda. `keyManager.js` existente (P-256, IndexedDB) permanece intacto.
- **Modelo privado permanece privado:** No modo público, apenas o `eco1Hash` vai on-chain.
- **Expiração de ownership:** Campo `expiresAt` opcional. Off-chain o Supabase pode revogar. On-chain é informativo.
- **Risco de perda de chave:** Recomendação explícita ao usuário: usar carteira com seed phrase custodiada.

---

## 11. Roadmap de Implementação

### Fase 1 — Off-chain apenas (MVP) — 3–4 semanas

- `walletConnector.js` (MetaMask + Coinbase)
- `ethSigner.js` (EIP-712)
- `offchainRegistry.js` (Supabase)
- `ownershipManager.js` (apenas modo privado)
- UI: modal opt-in no fluxo de exportação
- Schema Supabase + RLS

### Fase 2 — On-chain público — 2–3 semanas adicionais

- Deploy contrato `ECBTOwnership` na Base Testnet
- `onchainRegistry.js`
- Testes on-chain
- Deploy Base Mainnet
- UI: toggle público/privado + feedback de tx

### Fase 3 — PJ e Safe — 2 semanas adicionais

- `safeAdapter.js`
- Fluxo multisig na UI

### Fase 4 — Transferência e Verificação — 1–2 semanas adicionais

- UI de transferência de ownership
- Verificador público (dado eco1Hash → quem é o owner)
- `verifyOwnership()` no decoder (validação automática na importação)

---

## 12. Consequências

**Positivas:**

- Habilita uso comercial e regulatório (cessão de dados, licenciamento)
- PJ com Safe → governança formal de ownership, auditável
- On-chain → prova de custódia sem depender do ecbyts como autoridade central
- Retrocompatível — modelos sem ownership funcionam sem mudança

**Negativas / Riscos:**

- Dependência de rede externa (Base L2) para modo público
- Custo de gas (pequeno, mas existente)
- Complexidade de UX — onboarding de carteira pode ser barreira para usuário não-crypto
- Chave privada da carteira = responsabilidade do owner (sem recuperação)

---

## 13. Alternativas Rejeitadas

**Registro centralizado no Supabase com chave P-256 existente**
Rejeitado: não é uma carteira formal. Não portável. Depende do ecbyts como autoridade — elimina o valor de trustless ownership.

**Ethereum Mainnet em vez de Base**
Rejeitado: custo de gas 10–100x maior. Base é L2 oficial Coinbase, alinhada com Coinbase Wallet SDK.

**IPFS para armazenamento do modelo completo**
Adiado para Fase 2+: IPFS não garante disponibilidade sem pinning pago.

---

_Documento gerado em 2026-03-10. Atualizar após deploy do contrato com endereço real._
