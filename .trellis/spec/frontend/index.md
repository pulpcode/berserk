# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory contains guidelines for frontend development. Fill in each file with your project's specific conventions.

---

## Target Platform

This product targets desktop browsers only (user decision, 2026-10-13). Do not add mobile-specific design, code, refactors or acceptance work unless explicitly requested. Desktop window resizing, split panes and narrow map panels remain in scope. This decision supersedes earlier phone-specific requirements in specs and generic UI skills; do not opportunistically remove existing compatibility code.

## Pre-Development and Quality Check

Read [Professional Map Symbols](./map-symbols.md) for controlled fire/rescue glyphs, single-map on-demand tools, retained draw buffers and source refresh isolation.

Read [Foreground Spatial Analysis](../backend/spatial-analysis.md) for bounded calculations, native result evidence, exact-result saves and independent analysis map layers.

Read [Conversation Map Annotations](../backend/map-annotations.md) for annotation layer groups, independent editing, fixed version references and save-conflict behavior.

Read [Situation Map and Mock Controls](../backend/situation-map.md) for shared map entries, evidence links, object drafts, tile failures and simulation permissions.

Read [Unified Workbench and Work Overview](../backend/workbench.md) for explicit inbox handling, cross-seat summary authorization, migrations and navigation.

Read [Seat Responsibilities and Supplementary Delivery](../backend/seat-delivery.md) for integrated schema v7/v8, central duties, fixed delivery, overall-seat review and supplementary receipts.

Read [Information-to-Task Contract](../backend/task-information.md) for task information views, retained conflict drafts, suggestion creation receipts and fixed task/event/job continuation.

Read [Multi-source Context Queries](../backend/context-analysis.md) for the implemented capability-validation contracts, task context, query evidence and fixed scope checks.

Read [Information Processing and Seat Delivery](../backend/background-execution.md) for source authentication, durable queue, per-source grants, inbox and information center boundaries.

Read [Task and Seat Access](../backend/task-access.md) for formal login, task scope, authentication-aware clients and provisioning.

Read [Harness Lab Contract](./harness-lab.md) for W01-1 / W01-2 / W01-3 implementation. Run the checks listed there. Existing placeholder documents below are not established conventions.

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Harness Lab Contract](./harness-lab.md) | Implemented conversation/workspace API, state, persistence and verification contracts | Implemented scope |
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | To fill |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | To fill |
| [State Management](./state-management.md) | Local state, global state, server state | To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Type Safety](./type-safety.md) | Type patterns, validation | To fill |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
