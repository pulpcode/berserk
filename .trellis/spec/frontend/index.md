# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory contains guidelines for frontend development. Fill in each file with your project's specific conventions.

---

## Pre-Development and Quality Check

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
