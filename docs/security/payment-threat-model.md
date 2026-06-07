# Payment Authorization Lab Threat Model

## Scope

This threat model covers payment authorization planning and lab simulation only. It does not implement payment execution, does not register a real payment provider, and does not perform payment network requests.

The lab verifies payment descriptors using safe references for amount, currency, and payee. The references identify planning artifacts only; they are not card numbers, bank account numbers, payment tokens, provider handles, or reusable payment credentials.

## Non-Goals

- No real payment provider integration.
- No real card, bank account, wallet, payment token, or payment credential handling.
- No payment network request.
- No payment execution, settlement, capture, refund, subscription update, billing update, funds transfer, or provider-side mutation.
- No raw payment credential persistence in plans, audit views, run stores, reports, policy packs, packages, or regression artifacts.
- Natural language task text is rejected as authorization and cannot satisfy payment approval.

## Required Controls

Payment capability descriptors must stay blocked by default in production. The production runtime provider registry must not contain payment-capable executable providers, and payment runtime dispatch must stop before provider invocation.

Payment authorization planning requires all of the following structured descriptors:

- safe amount reference
- ISO currency code
- safe payee reference
- strong authorization requirement
- out-of-band approval requirement
- policy gate requirement

Out-of-band approval in the lab is a simulation signal. It may be recorded as observed in sanitized audit summaries, but it never grants execution and never enables a payment provider.

## Abuse Cases

### Natural Language Authorization

An instruction such as "I authorize this payment" in task text is not authorization. It must not satisfy strong authorization, out-of-band approval, policy gates, or runtime dispatch.

### Safe-Reference Bypass

Fields named as safe references must still reject payment raw material. A value that resembles card, bank, token, cookie, authorization, credential, secret, or payment credential material is rejected even if it appears in an amount, payee, approval, policy, or capability reference field.

### Provider Registration Drift

Production provider registries must remain free of payment executable providers. Regression tests must detect any change where a payment-blocked case begins invoking a provider.

### Audit Leakage

Payment audit summaries may include only safe references, classification, blocked reason, policy gate status, and redaction flags. They must not include raw card, bank, token, authorization, cookie, provider response, request body, or payment credential material.

### Package and Policy Drift

Capability packages must preserve payment classification with `runtimeCallable: false`, `executableByDefault: false`, and production payment provider registration prohibited. Policy pack simulation must continue to return `runtime.payment_execution_blocked` for payment requirements without invoking provider, browser, vault, or network surfaces.

## Acceptance Boundary

The payment lab is accepted only when threat model documentation, sanitized fixtures, payment planning validation, policy simulation, runtime blocking, audit summary redaction, package classification, query integration, and regression comparison all pass without introducing real payment execution or raw payment material persistence.
