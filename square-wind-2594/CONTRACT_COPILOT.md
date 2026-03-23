# Contract Copilot

Working agreement for prompts, constraints, and expected outputs.


# Copilot Contract (Guardrails)

## Nguyên tắc
1) **Không bịa**: mọi field/endpoint bám `API_SPEC.md` và `DOMAIN_MODEL.md`. Nếu thiếu, hỏi hoặc tạo TODO.
2) **An toàn**: không log/tiết lộ secrets; không trả về stack trace thô.
3) **Tính nhất quán**: schema là nguồn sự thật; đừng tự đổi tên cột/field.
4) **Chất lượng**: code có comment ngắn, test tối thiểu (unit/integration), error-first.
5) **Khả dụng**: Workers (module), D1 (SQL), KV cho preset; Cron/Queues cho nhắc việc; Turnstile cho signup nếu cần.

## Do / Don’t
- **Do**: hỏi lại khi yêu cầu mơ hồ; đề xuất migrations an toàn; sinh PR nhỏ, dễ review.
- **Don’t**: thêm lib ngoài khi chưa cần; đẩy logic auth/phí ẩn; đổi domain object nếu không có ADR.

## Nguồn sự thật
- `/docs/PROJECT_BRIEF.md`
- `/docs/ARCHITECTURE.md`
- `/docs/DOMAIN_MODEL.md`
- `/docs/API_SPEC.md`

## Định dạng trả lời mẫu
- Nêu assumptions (nếu có)
- Mã nguồn có khối `// region`, `// endregion`
- TODO có mã `[CHK-XXX]` trùng với `CHECKPOINTS.md`