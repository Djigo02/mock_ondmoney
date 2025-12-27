const jsonServer = require("json-server");

const server = jsonServer.create();
const router = jsonServer.router("db.json");
const middlewares = jsonServer.defaults();
const db = router.db;

server.use(middlewares);
server.use(jsonServer.bodyParser);

/* =========================
   Helpers
========================= */
function nowISO() {
  return new Date().toISOString();
}

function badRequest(res, error, message) {
  return res
    .status(400)
    .json({ timestamp: nowISO(), status: 400, error, message });
}

function notFound(res, error, message) {
  return res
    .status(404)
    .json({ timestamp: nowISO(), status: 404, error, message });
}

function conflict(res, error, message) {
  return res
    .status(409)
    .json({ timestamp: nowISO(), status: 409, error, message });
}

function unauthorized(res) {
  return res.status(401).json({
    timestamp: nowISO(),
    status: 401,
    error: "UNAUTHORIZED",
    message: "X-Service-Api-Key manquant ou invalide",
  });
}

function isPositiveNumber(x) {
  return typeof x === "number" && Number.isFinite(x) && x > 0;
}

function findBankByBankId(bankId) {
  return db.get("banks").find({ bankId }).value();
}

function findWalletByWalletId(walletId) {
  return db.get("wallets").find({ walletId }).value();
}

function walletExistsByPhone(phoneNumber) {
  return !!db.get("wallets").find({ phoneNumber }).value();
}

function makeTxnBase() {
  return {
    createdAt: nowISO(),
    processedAt: nowISO(),
  };
}

function pushEvent(topic, payload) {
  db.get("events")
    .push({
      id: Date.now(),
      topic,
      payload,
      createdAt: nowISO(),
    })
    .write();
}

/* =========================
   Zero-Trust API Key
   - public: /management/*, /api-key/*
   - private: everything else
========================= */
server.use((req, res, next) => {
  if (req.path.startsWith("/management") || req.path.startsWith("/api-key")) {
    return next();
  }

  const key = req.headers["x-service-api-key"];
  const valid = key && db.get("apiKeys").find({ plain: key }).value();

  if (!valid) return unauthorized(res);
  next();
});

/* =========================
   Public endpoints
========================= */
server.get("/management/health", (req, res) => {
  res.json({
    status: "UP",
    components: {
      db: { status: "UP" },
      kafka: { status: "UP" },
    },
  });
});

server.get("/management/info", (req, res) => {
  res.json({
    app: {
      name: "ond-money-mock",
      description: "Mock multi-services (Bank + Wallet + Transfer)",
      version: "1.0.0",
    },
  });
});

server.get("/api-key/default", (req, res) => {
  res.json({
    keys: {
      gateway_plain: "gateway",
      bank_plain: "bank",
      transfertsolde_plain: "transfertsolde",
    },
  });
});

/* =========================
   BANK CRUD (par bankId)
   Routes:
   - POST   /bank              (create)
   - GET    /bank              (list)
   - GET    /bank/:bankId      (read)
   - PUT    /bank/:bankId      (update full)
   - PATCH  /bank/:bankId      (update partial)
   - DELETE /bank/:bankId      (delete) => refuse if wallets linked
========================= */

// Create bank
server.post("/bank", (req, res) => {
  const { bankId, name, currency } = req.body || {};

  if (!bankId || !name || !currency) {
    return badRequest(
      res,
      "INVALID_REQUEST",
      "bankId, name, currency sont requis"
    );
  }
  if (findBankByBankId(bankId)) {
    return conflict(
      res,
      "BANK_ALREADY_EXISTS",
      `La banque ${bankId} existe déjà`
    );
  }

  const bank = {
    id: Date.now(),
    bankId,
    name,
    currency,
    status: "ACTIVE",
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };

  db.get("banks").push(bank).write();
  res.status(201).json(bank);
});

// List banks
server.get("/bank", (req, res) => {
  res.json(db.get("banks").value());
});

// Read bank
server.get("/bank/:bankId", (req, res) => {
  const bank = findBankByBankId(req.params.bankId);
  if (!bank) return notFound(res, "BANK_NOT_FOUND", "Banque introuvable");
  res.json(bank);
});

// Update bank (full)
server.put("/bank/:bankId", (req, res) => {
  const bankId = req.params.bankId;
  const bank = findBankByBankId(bankId);
  if (!bank) return notFound(res, "BANK_NOT_FOUND", "Banque introuvable");

  const { name, currency, status } = req.body || {};
  if (!name || !currency) {
    return badRequest(
      res,
      "INVALID_REQUEST",
      "name et currency sont requis (PUT)"
    );
  }

  const updated = {
    ...bank,
    name,
    currency,
    status: status || bank.status,
    updatedAt: nowISO(),
  };
  db.get("banks").find({ bankId }).assign(updated).write();
  res.json(updated);
});

// Update bank (partial)
server.patch("/bank/:bankId", (req, res) => {
  const bankId = req.params.bankId;
  const bank = findBankByBankId(bankId);
  if (!bank) return notFound(res, "BANK_NOT_FOUND", "Banque introuvable");

  const patch = req.body || {};
  const updated = { ...bank, ...patch, bankId, updatedAt: nowISO() };

  db.get("banks").find({ bankId }).assign(updated).write();
  res.json(updated);
});

// Delete bank (refuse if wallets linked)
server.delete("/bank/:bankId", (req, res) => {
  const bankId = req.params.bankId;
  const bank = findBankByBankId(bankId);
  if (!bank) return notFound(res, "BANK_NOT_FOUND", "Banque introuvable");

  const hasWallets = db.get("wallets").some({ bankId }).value();
  if (hasWallets) {
    return conflict(
      res,
      "BANK_HAS_WALLETS",
      "Impossible de supprimer: des wallets sont liés à cette banque"
    );
  }

  db.get("banks").remove({ bankId }).write();
  res.status(204).send();
});

/* =========================
   WALLET CRUD (par walletId)
   Routes:
   - POST   /wallet
   - GET    /wallet
   - GET    /wallet/:walletId
   - PUT    /wallet/:walletId
   - PATCH  /wallet/:walletId
   - DELETE /wallet/:walletId     => refuse if balance != 0
   + extra:
   - GET    /bank/:bankId/wallets => wallets of bank
========================= */

server.post("/wallet", (req, res) => {
  const { walletId, bankId, ownerId, ownerName, phoneNumber } = req.body || {};

  if (!walletId || !bankId || !ownerId || !ownerName || !phoneNumber) {
    return badRequest(
      res,
      "INVALID_REQUEST",
      "walletId, bankId, ownerId, ownerName, phoneNumber sont requis"
    );
  }
  if (!findBankByBankId(bankId)) {
    return notFound(res, "BANK_NOT_FOUND", `Banque ${bankId} introuvable`);
  }
  if (findWalletByWalletId(walletId)) {
    return conflict(
      res,
      "WALLET_ALREADY_EXISTS",
      `Le wallet ${walletId} existe déjà`
    );
  }
  if (walletExistsByPhone(phoneNumber)) {
    return conflict(
      res,
      "WALLET_PHONE_ALREADY_EXISTS",
      `Un wallet existe déjà pour ${phoneNumber}`
    );
  }

  const wallet = {
    id: Date.now(),
    walletId,
    bankId,
    ownerId,
    ownerName,
    phoneNumber,
    balance: 0.0,
    status: "ACTIVE",
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };

  db.get("wallets").push(wallet).write();
  pushEvent("wallet.created", {
    walletId: wallet.walletId,
    phoneNumber: wallet.phoneNumber,
    ownerId: wallet.ownerId,
    ownerName: wallet.ownerName,
    initialBalance: 0.0,
    status: wallet.status,
    createdAt: wallet.createdAt,
  });

  res.status(201).json(wallet);
});

server.get("/wallet", (req, res) => {
  res.json(db.get("wallets").value());
});

server.get("/wallet/:walletId", (req, res) => {
  const wallet = findWalletByWalletId(req.params.walletId);
  if (!wallet) return notFound(res, "WALLET_NOT_FOUND", "Wallet introuvable");
  res.json(wallet);
});

server.put("/wallet/:walletId", (req, res) => {
  const walletId = req.params.walletId;
  const wallet = findWalletByWalletId(walletId);
  if (!wallet) return notFound(res, "WALLET_NOT_FOUND", "Wallet introuvable");

  const { bankId, ownerId, ownerName, phoneNumber, status, balance } =
    req.body || {};
  if (!bankId || !ownerId || !ownerName || !phoneNumber || !status) {
    return badRequest(
      res,
      "INVALID_REQUEST",
      "bankId, ownerId, ownerName, phoneNumber, status requis (PUT)"
    );
  }
  if (!findBankByBankId(bankId))
    return notFound(res, "BANK_NOT_FOUND", `Banque ${bankId} introuvable`);

  // phone uniqueness if changed
  if (phoneNumber !== wallet.phoneNumber && walletExistsByPhone(phoneNumber)) {
    return conflict(
      res,
      "WALLET_PHONE_ALREADY_EXISTS",
      `Un wallet existe déjà pour ${phoneNumber}`
    );
  }

  const updated = {
    ...wallet,
    bankId,
    ownerId,
    ownerName,
    phoneNumber,
    status,
    balance: typeof balance === "number" ? balance : wallet.balance,
    updatedAt: nowISO(),
  };

  db.get("wallets").find({ walletId }).assign(updated).write();
  res.json(updated);
});

server.patch("/wallet/:walletId", (req, res) => {
  const walletId = req.params.walletId;
  const wallet = findWalletByWalletId(walletId);
  if (!wallet) return notFound(res, "WALLET_NOT_FOUND", "Wallet introuvable");

  const patch = req.body || {};

  if (patch.bankId && !findBankByBankId(patch.bankId)) {
    return notFound(
      res,
      "BANK_NOT_FOUND",
      `Banque ${patch.bankId} introuvable`
    );
  }

  if (
    patch.phoneNumber &&
    patch.phoneNumber !== wallet.phoneNumber &&
    walletExistsByPhone(patch.phoneNumber)
  ) {
    return conflict(
      res,
      "WALLET_PHONE_ALREADY_EXISTS",
      `Un wallet existe déjà pour ${patch.phoneNumber}`
    );
  }

  const updated = { ...wallet, ...patch, walletId, updatedAt: nowISO() };
  db.get("wallets").find({ walletId }).assign(updated).write();
  res.json(updated);
});

// Delete wallet (refuse if balance != 0)
server.delete("/wallet/:walletId", (req, res) => {
  const walletId = req.params.walletId;
  const wallet = findWalletByWalletId(walletId);
  if (!wallet) return notFound(res, "WALLET_NOT_FOUND", "Wallet introuvable");

  if (wallet.balance !== 0) {
    return conflict(
      res,
      "WALLET_BALANCE_NOT_ZERO",
      "Impossible de supprimer: le solde du wallet n'est pas zéro"
    );
  }

  // remove wallet + related transactions
  db.get("transactions").remove({ walletId }).write();
  db.get("wallets").remove({ walletId }).write();
  res.status(204).send();
});

// Wallets of a bank
server.get("/bank/:bankId/wallets", (req, res) => {
  const bankId = req.params.bankId;
  const bank = findBankByBankId(bankId);
  if (!bank) return notFound(res, "BANK_NOT_FOUND", "Banque introuvable");

  const wallets = db.get("wallets").filter({ bankId }).value();
  res.json(wallets);
});

/* =========================
   BANK Ledger + linkage
   - GET /bank/:bankId/transactions
   - GET /transactions?walletId=WALLET-001 (json-server can do, but we keep explicit too)
========================= */
server.get("/bank/:bankId/transactions", (req, res) => {
  const bankId = req.params.bankId;
  const bank = findBankByBankId(bankId);
  if (!bank) return notFound(res, "BANK_NOT_FOUND", "Banque introuvable");

  const walletIds = db
    .get("wallets")
    .filter({ bankId })
    .map("walletId")
    .value();
  const txns = db
    .get("transactions")
    .filter((t) => walletIds.includes(t.walletId))
    .value();
  res.json(txns);
});

/* =========================
   OPERATIONS:
   - GET /wallet/balance/:walletId
   - POST /wallet/:walletId/credit
   - POST /wallet/:walletId/debit
   - POST /wallet/transfer (DEBIT source + CREDIT dest)
   + Idempotency for transfer (optional):
     header X-Idempotency-Key
========================= */

// Balance
server.get("/wallet/balance/:walletId", (req, res) => {
  const walletId = req.params.walletId;
  const wallet = findWalletByWalletId(walletId);
  if (!wallet) return notFound(res, "WALLET_NOT_FOUND", "Wallet inexistant");

  res.json({
    walletId: wallet.walletId,
    balance: wallet.balance,
    status: wallet.status,
    phoneNumber: wallet.phoneNumber,
    ownerName: wallet.ownerName,
    updatedAt: wallet.updatedAt || nowISO(),
  });
});

// Credit
server.post("/wallet/:walletId/credit", (req, res) => {
  const walletId = req.params.walletId;
  const { amount, reference } = req.body || {};
  const wallet = findWalletByWalletId(walletId);

  if (!wallet) return notFound(res, "WALLET_NOT_FOUND", "Wallet inexistant");
  if (!isPositiveNumber(amount))
    return badRequest(res, "INVALID_AMOUNT", "amount doit être > 0");
  if (!reference)
    return badRequest(res, "INVALID_REQUEST", "reference est requis");

  const before = wallet.balance;
  const after = Number((before + amount).toFixed(2));

  db.get("wallets")
    .find({ walletId })
    .assign({ balance: after, updatedAt: nowISO() })
    .write();

  const txn = {
    id: Date.now(),
    ...makeTxnBase(),
    transactionId: `TXN-${Date.now()}`,
    walletId,
    type: "CREDIT",
    status: "SUCCESS",
    amount,
    balanceBefore: before,
    balanceAfter: after,
    reference,
    timestamp: nowISO(),
  };

  db.get("transactions").push(txn).write();

  pushEvent("wallet.credited", {
    transactionId: txn.transactionId,
    walletId: txn.walletId,
    amount: txn.amount,
    balanceBefore: txn.balanceBefore,
    balanceAfter: txn.balanceAfter,
    reference: txn.reference,
    status: txn.status,
    timestamp: txn.timestamp,
  });

  res.json({
    transactionId: txn.transactionId,
    walletId: txn.walletId,
    type: txn.type,
    status: txn.status,
    amount: txn.amount,
    balanceBefore: txn.balanceBefore,
    balanceAfter: txn.balanceAfter,
    reference: txn.reference,
    timestamp: txn.timestamp,
  });
});

// Debit
server.post("/wallet/:walletId/debit", (req, res) => {
  const walletId = req.params.walletId;
  const { amount, reference } = req.body || {};
  const wallet = findWalletByWalletId(walletId);

  if (!wallet) return notFound(res, "WALLET_NOT_FOUND", "Wallet inexistant");
  if (!isPositiveNumber(amount))
    return badRequest(res, "INVALID_AMOUNT", "amount doit être > 0");
  if (!reference)
    return badRequest(res, "INVALID_REQUEST", "reference est requis");

  if (wallet.balance < amount) {
    return badRequest(
      res,
      "INSUFFICIENT_FUNDS",
      `Solde insuffisant. Solde actuel: ${wallet.balance.toFixed(
        2
      )}, Montant demandé: ${amount.toFixed(2)}`
    );
  }

  const before = wallet.balance;
  const after = Number((before - amount).toFixed(2));

  db.get("wallets")
    .find({ walletId })
    .assign({ balance: after, updatedAt: nowISO() })
    .write();

  const txn = {
    id: Date.now(),
    ...makeTxnBase(),
    transactionId: `TXN-${Date.now()}`,
    walletId,
    type: "DEBIT",
    status: "SUCCESS",
    amount,
    balanceBefore: before,
    balanceAfter: after,
    reference,
    timestamp: nowISO(),
  };

  db.get("transactions").push(txn).write();

  pushEvent("wallet.debited", {
    transactionId: txn.transactionId,
    walletId: txn.walletId,
    amount: txn.amount,
    balanceBefore: txn.balanceBefore,
    balanceAfter: txn.balanceAfter,
    reference: txn.reference,
    status: txn.status,
    timestamp: txn.timestamp,
  });

  res.json({
    transactionId: txn.transactionId,
    walletId: txn.walletId,
    type: txn.type,
    status: txn.status,
    amount: txn.amount,
    balanceBefore: txn.balanceBefore,
    balanceAfter: txn.balanceAfter,
    reference: txn.reference,
    timestamp: txn.timestamp,
  });
});

// Transfer (DEBIT source + CREDIT destination) with optional idempotency
server.post("/wallet/transfer", (req, res) => {
  const {
    sourceWalletId,
    destinationWalletId,
    amount,
    reference,
    description,
  } = req.body || {};

  if (
    !sourceWalletId ||
    !destinationWalletId ||
    !isPositiveNumber(amount) ||
    !reference
  ) {
    return badRequest(
      res,
      "INVALID_REQUEST",
      "sourceWalletId, destinationWalletId, amount>0, reference requis"
    );
  }
  if (sourceWalletId === destinationWalletId) {
    return badRequest(
      res,
      "INVALID_TRANSFER",
      "Source et destination identiques"
    );
  }

  const src = findWalletByWalletId(sourceWalletId);
  const dst = findWalletByWalletId(destinationWalletId);

  if (!src)
    return notFound(
      res,
      "WALLET_NOT_FOUND",
      `Wallet source inexistant: ${sourceWalletId}`
    );
  if (!dst)
    return notFound(
      res,
      "WALLET_NOT_FOUND",
      `Wallet destination inexistant: ${destinationWalletId}`
    );

  // Idempotency (optional)
  const idemKey = req.headers["x-idempotency-key"];
  if (idemKey) {
    const cached = db.get("idempotency").find({ key: idemKey }).value();
    if (cached) {
      // return exact cached response
      return res.json(cached.response);
    }
  }

  if (src.balance < amount) {
    return badRequest(
      res,
      "INSUFFICIENT_FUNDS",
      `Solde insuffisant. Solde actuel: ${src.balance.toFixed(
        2
      )}, Montant demandé: ${amount.toFixed(2)}`
    );
  }

  const srcBefore = src.balance;
  const dstBefore = dst.balance;

  const srcAfter = Number((srcBefore - amount).toFixed(2));
  const dstAfter = Number((dstBefore + amount).toFixed(2));

  // Update balances (simulated atomic)
  db.get("wallets")
    .find({ walletId: sourceWalletId })
    .assign({ balance: srcAfter, updatedAt: nowISO() })
    .write();
  db.get("wallets")
    .find({ walletId: destinationWalletId })
    .assign({ balance: dstAfter, updatedAt: nowISO() })
    .write();

  // Create 2 transactions
  const debitTxn = {
    id: Date.now(),
    ...makeTxnBase(),
    transactionId: `TXN-${Date.now()}-D`,
    walletId: sourceWalletId,
    type: "DEBIT",
    status: "SUCCESS",
    amount,
    balanceBefore: srcBefore,
    balanceAfter: srcAfter,
    reference,
    description: description || null,
    timestamp: nowISO(),
  };

  const creditTxn = {
    id: Date.now() + 1,
    ...makeTxnBase(),
    transactionId: `TXN-${Date.now()}-C`,
    walletId: destinationWalletId,
    type: "CREDIT",
    status: "SUCCESS",
    amount,
    balanceBefore: dstBefore,
    balanceAfter: dstAfter,
    reference,
    description: description || null,
    timestamp: nowISO(),
  };

  db.get("transactions").push(debitTxn).write();
  db.get("transactions").push(creditTxn).write();

  const response = {
    transactionId: `TRF-${Date.now()}`,
    sourceWalletId,
    destinationWalletId,
    amount,
    status: "SUCCESS",
    sourceBalanceBefore: srcBefore,
    sourceBalanceAfter: srcAfter,
    destinationBalanceBefore: dstBefore,
    destinationBalanceAfter: dstAfter,
    reference,
    description: description || null,
    timestamp: nowISO(),
  };

  pushEvent("wallet.transfer.completed", response);

  // cache idempotency result
  if (idemKey) {
    db.get("idempotency")
      .push({
        id: Date.now(),
        key: idemKey,
        response,
        createdAt: nowISO(),
      })
      .write();
  }

  res.json(response);
});

/* =========================
   Expose the default json-server router
   for raw CRUD on collections if needed:
   - GET/POST/PATCH/DELETE on /banks /wallets /transactions /events
   (useful for debug)
========================= */
server.use(router);

/* =========================
   Start the server
========================= */
// PORT = 8080;
const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log("✔ OND Money mock running on http://localhost:8080");
  console.log("  - Bank CRUD:   /bank, /bank/:bankId");
  console.log("  - Wallet CRUD: /wallet, /wallet/:walletId");
  console.log(
    "  - Ops:         /wallet/:walletId/credit | /debit | /wallet/transfer | /wallet/balance/:walletId"
  );
});
