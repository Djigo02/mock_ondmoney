## Contrat d’Interface – Banques, Wallets et Transferts

## 1. Présentation générale

OND Money est un système qui permet de gérer de l’argent électronique :

- créer des **banques**
- créer des **portefeuilles (wallets)** pour les utilisateurs
- **ajouter**, **retirer** et **transférer** de l’argent
- suivre les **soldes** et les **opérations**

Le système fonctionne via des **adresses d’accès (endpoints)** et renvoie des **réponses claires en JSON**.

## 2. Accès au service

- Adresse du système :
  **npm install**
  **npm run start**
  [\*\*http://localhost:8080](http://localhost:8080/)\*\*
- Adresse en ligne
  https://mock-ondmoney.onrender.com
- Clé de sécurité obligatoire pour les opérations sensibles a ajouter dans les header :

```
X-Service-Api-Key : gateway

```

## 3. Service Banque

### 3.1 Créer une banque

Permet d’enregistrer une nouvelle banque.

**Adresse utilisée :**

```
POST /bank

```

**Données envoyées :**

```json
{
  "bankId": "BANK-001",
  "name": "OND Bank",
  "currency": "XOF",
  "solde": "10000000000"
}
```

**Réponse du système :**

```json
{
  "bankId": "BANK-001",
  "name": "OND Bank",
  "currency": "XOF",
  "solde": "10000000000",
  "status": "ACTIVE",
  "createdAt": "2025-12-26T10:00:00Z"
}
```

### 3.2 Consulter les banques

Permet de voir toutes les banques existantes.

**Adresse utilisée :**

```
GET /bank

```

**Réponse :**

```json
[
  {
    "bankId": "BANK-001",
    "name": "OND Bank",
    "currency": "XOF",
    "status": "ACTIVE"
  }
]
```

### 3.3 Supprimer une banque (restriction)

Une banque **ne peut pas être supprimée** si elle possède des wallets.

**Réponse possible :**

```json
{
  "status": 409,
  "error": "BANK_HAS_WALLETS",
  "message": "Impossible de supprimer : des wallets sont liés à cette banque"
}
```

## 4. Service Wallet (Portefeuille)

### 4.1 Créer un wallet

Permet de créer un portefeuille pour un utilisateur.

**Adresse utilisée :**

```
POST /wallet

```

**Données envoyées :**

```json
{
  "walletId": "WALLET-001",
  "bankId": "BANK-001",
  "ownerId": "USER-001",
  "ownerName": "Mamadou Diallo",
  "phoneNumber": "+221771234567"
}
```

**Réponse :**

```json
{
  "walletId": "WALLET-001",
  "ownerName": "Mamadou Diallo",
  "phoneNumber": "+221771234567",
  "balance": 0,
  "status": "ACTIVE"
}
```

### 4.2 Consulter le solde d’un wallet

Permet de connaître le solde actuel.

**Adresse utilisée :**

```
GET /wallet/balance/WALLET-001

```

**Réponse :**

```json
{
  "walletId": "WALLET-001",
  "balance": 1500,
  "status": "ACTIVE",
  "ownerName": "Mamadou Diallo"
}
```

### 4.3 Supprimer un wallet (restriction)

Un wallet **ne peut pas être supprimé** si son solde n’est pas nul.

**Réponse possible :**

```json
{
  "status": 409,
  "error": "WALLET_BALANCE_NOT_ZERO",
  "message": "Impossible de supprimer : le solde n'est pas égal à zéro"
}
```

## 5. Opérations financières

### 5.1 Créditer un wallet (ajouter de l’argent)

**Adresse utilisée :**

```
POST /wallet/WALLET-001/credit

```

**Données envoyées :**

```json
{
  "amount": 3000,
  "reference": "CREDIT-001"
}
```

**Réponse :**

```json
{
  "transactionId": "TXN-1001",
  "type": "CREDIT",
  "amount": 3000,
  "balanceBefore": 1500,
  "balanceAfter": 4500,
  "status": "SUCCESS"
}
```

### 5.2 Débiter un wallet (retirer de l’argent)

**Adresse utilisée :**

```
POST /wallet/WALLET-001/debit

```

**Données envoyées :**

```json
{
  "amount": 1000,
  "reference": "DEBIT-001"
}
```

**Réponse :**

```json
{
  "transactionId": "TXN-1002",
  "type": "DEBIT",
  "amount": 1000,
  "balanceBefore": 4500,
  "balanceAfter": 3500,
  "status": "SUCCESS"
}
```

### 5.3 Débit refusé (solde insuffisant)

**Réponse possible :**

```json
{
  "status": 400,
  "error": "INSUFFICIENT_FUNDS",
  "message": "Solde insuffisant. Solde actuel: 500"
}
```

## 6. Transfert d’argent entre deux wallets

### 6.1 Effectuer un transfert

Le transfert **retire de l’argent du premier wallet** et **ajoute au second automatiquement**.

**Adresse utilisée :**

```
POST /wallet/transfer

```

**Données envoyées :**

```json
{
  "sourceWalletId": "WALLET-001",
  "destinationWalletId": "WALLET-002",
  "amount": 2000,
  "reference": "TRF-001",
  "description": "Paiement facture"
}
```

### 6.2 Réponse du transfert

```json
{
  "transactionId": "TRF-2001",
  "status": "SUCCESS",
  "sourceWalletId": "WALLET-001",
  "destinationWalletId": "WALLET-002",
  "amount": 2000,
  "sourceBalanceAfter": 1500,
  "destinationBalanceAfter": 4000
}
```

👉 Le transfert est réussi **uniquement si les deux opérations (débit + crédit) passent**.

## 7. Sécurité expliquée simplement

- Une clé protège le système contre les accès non autorisés
- Sans la clé → le système refuse
- Avec la clé → les opérations sont autorisées

**Exemple de refus :**

```json
{
  "status": 401,
  "error": "UNAUTHORIZED",
  "message": "Clé de sécurité manquante ou invalide"
}
```

## 8. Supervision du système

### Vérifier si le système fonctionne

**Adresse utilisée :**

```
GET /management/health

```

**Réponse :**

```json
{
  "status": "UP",
  "components": {
    "db": { "status": "UP" },
    "kafka": { "status": "UP" }
  }
}
```

## AIRTIME db.json

```json
{
  "airtimeOperators": [
    {
      "id": "ORANGE",
      "name": "Orange",
      "country": "SN",
      "currency": "XOF"
    },
    {
      "id": "FREE",
      "name": "Free",
      "country": "SN",
      "currency": "XOF"
    }
  ],
  "airtimeTransactions": []
}
```

---

## Exemple d’appel API

### Achat de crédit téléphonique

```
POST /airtime/purchase

```

### Corps envoyé

```json
{
  "walletId": "WALLET-001",
  "phoneNumber": "771234567",
  "operatorId": "ORANGE",
  "amount": 1000,
  "reference": "AIRTIME-0001"
}
```

### Réponse

```json
{
  "message": "Achat de crédit téléphonique effectué avec succès",
  "transaction": {
    "id": "AIR-1737392929",
    "walletId": "WALLET-001",
    "phoneNumber": "771234567",
    "operatorId": "ORANGE",
    "amount": 1000,
    "reference": "AIRTIME-0001",
    "status": "SUCCESS",
    "createdAt": "2025-01-20T18:10:12.000Z"
  },
  "walletBalance": 9000
}
```

---

## Endpoints Airtime disponibles

| Action            | Endpoint                | Méthode |
| ----------------- | ----------------------- | ------- |
| Liste opérateurs  | `/airtime/operators`    | GET     |
| Achat crédit      | `/airtime/purchase`     | POST    |
| Historique achats | `/airtime/transactions` | GET     |
