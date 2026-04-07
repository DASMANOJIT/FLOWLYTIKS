# Cashfree Payments Integration

## Required backend env vars

- `CASHFREE_CLIENT_ID` or `CASHFREE_APP_ID`
- `CASHFREE_CLIENT_SECRET` or `CASHFREE_SECRET_KEY`
- `CASHFREE_ENVIRONMENT=sandbox|production`
- `CASHFREE_RETURN_URL`
- `CASHFREE_WEBHOOK_SECRET` (optional override; defaults to the client secret for webhook signature verification)

## Routes added

- `POST /api/payments/cashfree/create-order`
- `GET /api/payments/cashfree/verify`
- `POST /api/payments/cashfree/verify`
- `POST /api/payments/cashfree/webhook`

## Sandbox setup

1. Set backend env vars with Cashfree sandbox credentials.
2. Set `CASHFREE_RETURN_URL` to your frontend payment result page, for example:
   - `http://localhost:3001/payment-success`
   - `https://your-frontend-domain/payment-success`
3. In the Cashfree dashboard, whitelist your frontend domain for checkout.
4. Configure the webhook URL in Cashfree:
   - `https://your-backend-domain/api/payments/cashfree/webhook`
5. Use the Cashfree sandbox test payment instruments from the Cashfree dashboard/docs.

## Runtime behavior

- Orders are created only from the backend.
- Frontend opens checkout using `payment_session_id`.
- A payment is marked paid only after backend verification/webhook confirmation.
- Duplicate create-order calls reuse a live open order where possible.
- Duplicate webhooks are deduped before processing.

## Manual test checklist

1. Student login works and student dashboard still shows unpaid months.
2. Click `Pay Now` on one unpaid month.
3. Confirm backend returns a `paymentSessionId` from `POST /api/payments/cashfree/create-order`.
4. Complete a sandbox payment through Cashfree checkout.
5. Confirm `GET /api/payments/cashfree/verify` returns `PAID`.
6. Refresh the payment result page and confirm it remains `PAID`.
7. Re-send the same webhook payload and confirm it is treated as a duplicate.
8. Try paying the same month again and confirm the backend blocks duplicate paid orders.

## Future marketplace / teacher settlement note

- `Admin` now has `cashfreeVendorId` and `cashfreeSettlementStatus` placeholders.
- `Payment` and `PaymentGatewayOrder` keep an optional `teacherAdminId` for future Easy Split / vendor routing.
- Full teacher-direct settlement still requires:
  - teacher/admin ownership mapping for each student
  - vendor onboarding
  - split instructions during order creation
  - settlement reconciliation
