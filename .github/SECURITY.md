# Security Policy

Thanks for helping keep DVinyl and its users safe. 🛡️

## Supported versions

DVinyl is an evolving self-hosted project, and security fixes land on the latest release. Please
make sure you are running the most recent version before reporting an issue.

| Version | Supported |
| :------ | :-------- |
| 3.x     | Yes       |
| < 3.0   | No        |

## Reporting a vulnerability

Please do not report security vulnerabilities through public GitHub issues, discussions or pull
requests, as that would expose the problem before a fix is available.

Instead, report privately in one of these ways:

- **GitHub (preferred):** open a private report through
  [Security advisories](https://github.com/Kyonew/DVinyl/security/advisories/new).
- **Email:** send the details to **contact@kyonew.me**.

To help me understand and fix the problem quickly, please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce it, or a small proof of concept.
- The DVinyl version and how you are running it (Docker, manual, and so on).

## What to expect

- I will try to acknowledge your report within a few days.
- I will keep you posted on the progress toward a fix.
- Once the issue is resolved, I am happy to credit you for the discovery if you would like.

Since DVinyl is self hosted, you are always in control of your own instance. Keeping it updated,
using strong secrets for `PASSJWT` and `SESSION_SECRET`, and serving it over HTTPS in production are
the best ways to stay safe.

Thank you for reporting responsibly. 🩵
