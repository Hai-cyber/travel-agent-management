> **RUNTIME NOTE:**
> Some decisions recorded here may refer to future modules. Check 01_CURRENT_STATE.md to see what is actually live in the rescue repo.

Add a short "RUNTIME NOTE" near the top:

- Clarify that decisions recorded here may refer to future modules.
- Tell readers to check 01_CURRENT_STATE.md to see what is actually live in the rescue repo.

Do not change existing decision entries.

# Decision Log

Record major technical and product decisions.


# Decision Log

- 2026-03-20: Chọn Cloudflare Workers + D1 + KV + Cron/Queues; block-based UI 3 tab; 5 nhóm dịch vụ chuẩn; thread theo item.

---

## 2026-04-15 — Revenue model for Stripe review

**Decision:** Revenue model cần mô tả rõ với Stripe như sau:

> "Monthly SaaS subscription. End-of-month commission invoice is a separate B2B invoice, not processed through Stripe."

**Rationale:**

1. **Stripe chỉ xử lý subscription** — €4.98/tháng (Starter) hoặc €9.98/tháng (Tour Operator Pro). Đây là Stripe Payments / Stripe Billing thông thường.
2. **Commission (0–2% threshold) được thu qua invoice B2B riêng** — cuối tháng, Tours Market LLC gửi invoice cho operator dựa trên tổng doanh thu được ghi nhận trong hệ thống. Khoản này *không* đi qua Stripe. Không cần khai báo với Stripe.
3. **Nếu sau này muốn Stripe xử lý cả commission invoice** → cần bật **Stripe Invoicing** (khác với Stripe Payments). Đây là quyết định tương lai, chưa thực hiện.

**Stripe review note:** Khi Stripe hỏi về revenue model (trong onboarding hoặc risk review), trả lời bằng đúng câu trên. Không cần giải thích commission invoicing trừ khi được hỏi thêm.

**Traffic at launch:** Stripe không yêu cầu có live customer trước khi duyệt tài khoản. Không có traffic lúc mở account là bình thường.

---