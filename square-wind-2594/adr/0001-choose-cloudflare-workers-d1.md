# ADR 0001: Choose Cloudflare Workers + D1

Status: Accepted

## ADR-0001: Chọn Cloudflare Workers + D1

Quyết định: Edge-first; D1 cho data; KV cho presets; Cron/Queues cho nhắc việc.
Lý do: latency thấp, hạ tầng gọn, chi phí tối ưu, scale multi-tenant tốt.
Hệ quả: Ưu tiên module Worker, SQL D1, hạn chế phụ thuộc nặng khác.

## Context
Need a serverless runtime and lightweight relational database for the MVP.

## Decision
Use Cloudflare Workers for compute and Cloudflare D1 for relational storage.

## Consequences
Low-ops deployment model with globally distributed edge runtime and SQL support.
