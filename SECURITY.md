# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in AgentGate, please report it responsibly.

**Do not open a public issue.** Instead, email security concerns to the maintainers directly or use GitHub's private vulnerability reporting feature on this repository.

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

### Response timeline

- **Acknowledgment:** within 48 hours
- **Initial assessment:** within 1 week
- **Fix or mitigation:** as soon as practical, targeting 30 days for critical issues

## Supported Versions

| Version | Supported |
| --- | --- |
| 0.1.x (latest) | Yes |
| < 0.1.0 | No |

## Scope

The following are in scope for security reports:

- Policy evaluation bypass (tool calls allowed when they should be denied)
- Rate limit or budget enforcement bypass
- Audit log tampering or omission
- Injection through policy YAML parsing
- Dependency vulnerabilities in published packages

The following are out of scope:

- Issues in example code or documentation
- Denial of service through valid but high-volume usage
- Issues requiring physical access to the host machine

## Disclosure

We follow coordinated disclosure. We will credit reporters in the release notes unless they prefer to remain anonymous.
