# R3 local scanner toolchain

Install the official PyPI packages in an isolated Python >=3.11 environment using requirements.txt. The default launcher is semgrep-sandbox.py and requires the separately built `berserk-skill-scanner:r3-semgrep-1.182.0` image. It mounts only the current scan snapshot and deployment rules read-only, disables network, runs nonroot with CPU/memory/PID limits and an internal deadline. LAB_SKILL_SCANNER_COMMAND may explicitly select an operator-owned executable for development; direct local CLI verification is recorded separately from container isolation. The adapter uses the deployment-owned fixture rule bundle; it never loads uploaded configuration or downloads rules during a scan.

Semgrep CE1.182.0 is pinned for both Intel macOS development and Linux validation.1.185.0 was first evaluated but has no Intel macOS semgrep-core binary. skills-ref0.1.1 exposes its reference CLI as `agentskills validate`, not `skills-ref`. Package versions and the actual development transitive environment are retained in task research.

Rules, their upstream commit, original paths, SHA256, licence pointer and executable combined bundle digest are under fixtures/skill-scanning. The interfile code-string-concat rule is retained only as an upstream source snapshot and excluded from CE executable rules. Rule coverage is intentionally finite and is not a malware/security certification.

A missing or failed scanner is shown as failed evidence and does not block an otherwise valid Skill publication. Platform scanner functionality still requires real-tool verification before R3 delivery.

Operator limits can only tighten the following byte/file ceilings with positive integers: LAB_SKILL_MAX_ARCHIVE_BYTES=20971520, LAB_SKILL_MAX_EXPANDED_BYTES=104857600, LAB_SKILL_MAX_FILES=256, LAB_SKILL_MAX_RESOURCE_BYTES=20971520, LAB_SKILL_MAX_METHOD_BYTES=65536, LAB_SKILL_MAX_TEXT_BYTES=2097152. Invalid or above-ceiling values fail startup. These are Axon resource constraints, not Agent Skills format requirements.
