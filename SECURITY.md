# Security Policy

## Supported Versions

Reqcore is under active development on the `main` branch.

- `main`: Supported
- Tagged releases: Security support windows are defined per release once stable releases begin.

## Reporting a Vulnerability

Please do **not** report security vulnerabilities through public GitHub issues.

Report privately by email: security@reqcore.com

Include as much detail as possible:

- Affected area (API route, auth flow, storage, etc.)
- Reproduction steps or proof of concept
- Impact assessment (data exposure, privilege escalation, tenant isolation risk, etc.)
- Suggested mitigation (optional)

## Response Expectations

- Initial acknowledgment: within 3 business days
- Triage and severity assessment: as quickly as possible
- Fix timeline: depends on severity and exploitability
- Coordinated disclosure: after a fix is available and affected users are notified when needed

## Scope Priorities

Given Reqcore's architecture, the highest-priority findings include:

- Multi-tenant data isolation bypass (`organizationId` scope issues)
- Authentication or authorization bypass
- Sensitive document access bypass
- Secret leakage or insecure default configuration
- Injection vulnerabilities in API or DB access paths

## Deployment Hardening

The application enforces an 8 MB chatbot-file ceiling while streaming the
request and revalidates custom AI endpoint DNS before every outbound request.
Production deployments should also enforce these controls outside the Node
process:

- Set the reverse proxy request-body limit for `/api/chatbot/upload` to no more
  than 8.1 MB (the small margin is for multipart headers).
- Deny application-container egress to loopback, link-local, RFC1918,
  carrier-grade NAT, cloud metadata, and other internal network ranges. Permit
  HTTPS egress only to approved AI providers where an allowlist is practical.
- Keep redirect following disabled in any outbound proxy used for custom AI
  endpoints.

## Safe Harbor

If you act in good faith, avoid privacy violations and service disruption, and give us reasonable time to resolve findings before disclosure, we will treat your research as authorized and welcomed.
