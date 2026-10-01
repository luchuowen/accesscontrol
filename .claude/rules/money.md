---
paths:
  - "packages/core/src/money/**"
  - "packages/core/src/period/**"
  - "apps/web/src/server/payments/**"
  - "apps/web/src/app/api/webhooks/**"
---
# Money & period reference
- Amounts: integer KES (`number` safe-int, validated). TaifaPay statuses: accept PENDING/pending, COMPLETED/complete.
- TaifaPay: sandbox `https://sandbox.merchants.taifapay.africa/v1`, live `https://merchants.taifapay.africa/v1`;
  `POST /auth/token`; STK `POST /transactions/m-pesa/c2b/initiate {phoneNumber, amount, accountReference,
  transactionDesc, externalId}`; `GET /transactions/{id}`; webhook `transaction.completed` → re-query before applying.
- Matching order and renewal anchor: docs/BLUEPRINT.md §6. Timezone: tenant tz (default Africa/Nairobi).
