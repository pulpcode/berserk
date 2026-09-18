# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

This directory contains guidelines for backend development. Fill in each file with your project's specific conventions.

---

## Pre-Development and Quality Check

Read [Harness Lab Contract](./harness-lab.md) for conversation, workspace, compaction and subagent implementation. Also read [File and Execution Contract](./files-execution.md) for W01-5 files, upload and sandbox work. Read [Web Interaction Contract](./hitl.md) for W01-6 AskUser, operation confirmation and Bash rules. Run the checks listed there. Existing placeholder documents below are not established conventions.

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Harness Lab Contract](./harness-lab.md) | Implemented conversation/workspace API, state, persistence and verification contracts | Implemented scope |
| [File and Execution Contract](./files-execution.md) | Seat files, upload/download, public Pi tools and request container boundaries | Implemented; physical acceptance tracked per task |
| [Web Interaction Contract](./hitl.md) | AskUser, operation gates, native history and Bash policy | Implemented scope |
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Database Guidelines](./database-guidelines.md) | ORM patterns, queries, migrations | To fill |
| [Error Handling](./error-handling.md) | Error types, handling strategies | To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Logging Guidelines](./logging-guidelines.md) | Structured logging, log levels | To fill |

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
