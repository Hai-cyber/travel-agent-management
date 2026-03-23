# README Copilot

Guidance for AI-assisted development in this repository.


# Hướng dẫn Copilot (VS Code)

## Mục tiêu
- Copilot bám các file **source-of-truth** khi sinh code và tài liệu:
  - `/docs/PROJECT_BRIEF.md`, `/docs/ARCHITECTURE.md`, `/docs/DOMAIN_MODEL.md`, `/docs/API_SPEC.md`

## Quy tắc tương tác (khi chat):
- Luôn đọc lại 4 file trên trước khi trả lời kỹ thuật.
- Nếu thiếu dữ liệu (ví dụ payload/field), **hỏi lại** hoặc gợi ý placeholder rõ ràng.
- Không bịa (no synthetic data) trừ khi prompt có yêu cầu và phải đánh dấu `// SYNTHETIC`.
- Ưu tiên TypeScript, module Worker (Cloudflare), D1 (SQL), KV cho preset.

## Mẹo giữ context:
- Mỗi module có header `=== COPILOT FOCUS START/END ===` trong file tương ứng.
- Khi code, **mở song song** file kiến trúc & domain model.
- Dùng thẻ checkpoint (ví dụ `[CHK-001]`) trong commit/PR/tiêu đề task để Copilot gợi ý chính xác.

## Ví dụ prompt ngắn
> “Bám `API_SPEC.md` → tạo route Workers cho POST `/api/tour/:id/destination`, validate nights>0, ghi D1, và update `arrival/departure` các điểm sau.”
