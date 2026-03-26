#!/bin/bash
# test_booking_orders.sh
# Kiểm chứng 3 "đòn hiểm" của hệ thống Bank Transfer Order (CHK-R18)
#
# Yêu cầu:
#   - npx wrangler dev đang chạy trên port 8787
#   - Migration 0016 đã được apply: npx wrangler d1 migrations apply travel_agent_db --local
#   - Seed data pricing: npx wrangler d1 execute travel_agent_db --local --file=db/seed_test.sql
#
# Chạy: bash test/test_booking_orders.sh

set -u
# Note: no -e or pipefail — grep exits 1 on no-match which would kill the script.
# Errors are handled explicitly with pass()/fail() instead.

API="http://127.0.0.1:8787"
TENANT="ten-demo-001"

# ── Terminal colours ──────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS=0
FAIL=0

pass()  { echo -e "${GREEN}  [PASS]${NC} $1"; PASS=$((PASS+1)); }
fail()  { echo -e "${RED}  [FAIL]${NC} $1"; FAIL=$((FAIL+1)); }
info()  { echo -e "${YELLOW}  [INFO]${NC} $1"; }
title() { echo -e "\n${CYAN}══════════════════════════════════════════════════════${NC}"; \
          echo -e "${CYAN} $1${NC}"; \
          echo -e "${CYAN}══════════════════════════════════════════════════════${NC}"; }

# ── Helper: extract JSON string value ────────────────────────────────────────
# Usage: json_str '..json..' key  →  value  (returns empty string on no-match)
json_str() { echo "$1" | grep -o "\"$2\":\"[^\"]*\"" | head -1 | cut -d'"' -f4 || echo ""; }
json_num() { echo "$1" | grep -o "\"$2\":[0-9.]*"   | head -1 | cut -d':' -f2 || echo ""; }
json_bool(){ echo "$1" | grep -o "\"$2\":[a-z]*"    | head -1 | cut -d':' -f2 || echo ""; }

# ─────────────────────────────────────────────────────────────────────────────
# SETUP: Đảm bảo tenant ACTIVE + migration 0016 + pricing data
# ─────────────────────────────────────────────────────────────────────────────
title "SETUP: Chuẩn bị dữ liệu test"

info "Apply migration 0016 (booking_orders)..."
npx wrangler d1 migrations apply travel_agent_db --local --silent 2>/dev/null || \
  npx wrangler d1 migrations apply travel_agent_db --local 2>&1 | tail -3

info "Seed pricing data (seed_test.sql)..."
npx wrangler d1 execute travel_agent_db --local --file=db/seed_test.sql 2>/dev/null || true

info "Kích hoạt subscription cho tenant '$TENANT'..."
npx wrangler d1 execute travel_agent_db --local \
  --command="UPDATE tenants SET subscription_status='ACTIVE' WHERE id='ten-demo-001';" \
  2>/dev/null || true

info "Setup xong."

# ─────────────────────────────────────────────────────────────────────────────
# TEST 1 — Identity Lock
# Tạo đơn hàng → GET lại → thông tin khách phải bị ẩn
# ─────────────────────────────────────────────────────────────────────────────
title "TEST 1: Identity Lock"
echo "  Mong đợi: 'guest' object ẩn, field 'identity_note' xuất hiện"
echo ""

ORDER_RES=$(curl -s -X POST "$API/api/bookings/order" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: $TENANT" \
  -d '{
    "tour_id":     "tour-001",
    "travel_date": "2026-07-10",
    "segment_id":  "segment-standard",
    "pax": {
      "adult_shared_room_count": 2,
      "adult_count": 2
    },
    "guest": {
      "name":  "Nguyen Van An",
      "email": "anvan@example.com",
      "phone": "0901234567"
    }
  }')

info "POST /api/bookings/order → $ORDER_RES"

ORDER_ID=$(json_str "$ORDER_RES" "order_id")
ORDER_STATUS=$(json_str "$ORDER_RES" "status")
GRAND_TOTAL=$(json_num "$ORDER_RES" "grand_total_usd")

if [ -z "$ORDER_ID" ]; then
  fail "Không tạo được đơn hàng. Kiểm tra: tenant ACTIVE? pricing data seeded? wrangler dev đang chạy?"
  echo ""
  echo "  Hint — chạy thủ công để xem lỗi:"
  echo "    npx wrangler d1 execute travel_agent_db --local --command=\"SELECT subscription_status FROM tenants WHERE id='ten-demo-001';\""
  echo " Response nhận được: $ORDER_RES"
  exit 1
fi
pass "Đơn hàng tạo thành công → order_id=$ORDER_ID  grand_total_usd=$GRAND_TOTAL"

[ "$ORDER_STATUS" = "AWAITING_PROOF" ] \
  && pass "Status khởi tạo = AWAITING_PROOF" \
  || fail "Status mong đợi AWAITING_PROOF, thực tế: '$ORDER_STATUS'"

# GET order — phải bị mask
GET1=$(curl -s "$API/api/bookings/order/$ORDER_ID" -H "X-Tenant-ID: $TENANT")
info "GET /api/bookings/order/$ORDER_ID → $GET1"

echo "$GET1" | grep -q '"identity_note"' \
  && pass "Field 'identity_note' xuất hiện → identity bị lock" \
  || fail "'identity_note' vắng mặt → identity lock không hoạt động"

echo "$GET1" | grep -q '"guest"' \
  && fail "Rò rỉ identity: field 'guest' hiện ra khi chưa có proof" \
  || pass "Field 'guest' không có trong response → an toàn"

UNLOCKED1=$(json_bool "$GET1" "identity_unlocked")
[ "$UNLOCKED1" = "false" ] \
  && pass "identity_unlocked = false" \
  || fail "identity_unlocked mong đợi false, thực tế: '$UNLOCKED1'"

# ─────────────────────────────────────────────────────────────────────────────
# TEST 2 — Proof Unlock
# Upload ảnh → status PROOF_UPLOADED → GET lại thấy thông tin khách đầy đủ
# ─────────────────────────────────────────────────────────────────────────────
title "TEST 2: Proof Unlock (Upload bank slip)"
echo "  Mong đợi: status → PROOF_UPLOADED, 'guest' object hiện đầy đủ"
echo ""

# Tạo file giả JPEG cho mục đích test.
# Nội dung là text thuần — server check MIME type từ Content-Type header, không đọc bytes.
PROOF_FILE="/tmp/test_proof_$$.jpg"
echo "FAKE_BANK_TRANSFER_PROOF_FOR_TESTING_ONLY" > "$PROOF_FILE"

# Verify file was created before trying to upload
if [ ! -f "$PROOF_FILE" ]; then
  fail "Không thể tạo file proof tạm '$PROOF_FILE'. Kiểm tra quyền ghi /tmp."
  exit 1
fi
info "Tạo file proof tạm: $PROOF_FILE (đã xác nhận tồn tại)"

# curl on Windows/Git Bash cannot read POSIX /tmp/ paths via -F @path.
# Convert to native Windows path using cygpath before passing to curl.
PROOF_WIN=$(cygpath -w "$PROOF_FILE" 2>/dev/null || echo "$PROOF_FILE")
PROOF_RES=$(curl -s -X POST "$API/api/bookings/order/$ORDER_ID/proof" -H "X-Tenant-ID: $TENANT" -F "proof=@$PROOF_WIN;type=image/jpeg") || PROOF_RES="{}"

rm -f "$PROOF_FILE"
info "POST /api/bookings/order/$ORDER_ID/proof → $PROOF_RES"

PROOF_STATUS=$(json_str "$PROOF_RES" "status")
[ "$PROOF_STATUS" = "PROOF_UPLOADED" ] \
  && pass "Status sau upload = PROOF_UPLOADED" \
  || fail "Status mong đợi PROOF_UPLOADED, thực tế: '$PROOF_STATUS'"

PROOF_UNLOCKED=$(json_bool "$PROOF_RES" "identity_unlocked")
[ "$PROOF_UNLOCKED" = "true" ] \
  && pass "identity_unlocked = true trong upload response" \
  || fail "identity_unlocked mong đợi true, thực tế: '$PROOF_UNLOCKED'"

echo "$PROOF_RES" | grep -q '"proof_r2_key"' \
  && pass "proof_r2_key có trong response → file đã lên R2" \
  || fail "'proof_r2_key' vắng mặt → upload R2 có thể thất bại"

# GET lại — lần này phải thấy thông tin khách
GET2=$(curl -s "$API/api/bookings/order/$ORDER_ID" -H "X-Tenant-ID: $TENANT")
info "GET sau upload → $GET2"

GET2_STATUS=$(json_str "$GET2" "status")
[ "$GET2_STATUS" = "PROOF_UPLOADED" ] \
  && pass "GET sau upload: status = PROOF_UPLOADED" \
  || fail "GET sau upload: status mong đợi PROOF_UPLOADED, thực tế: '$GET2_STATUS'"

echo "$GET2" | grep -q '"guest"' \
  && pass "Field 'guest' xuất hiện → identity unlock thành công" \
  || fail "Field 'guest' KHÔNG xuất hiện dù identity_unlocked = 1"

GUEST_NAME=$(echo "$GET2" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
[ "$GUEST_NAME" = "Nguyen Van An" ] \
  && pass "guest.name đúng: '$GUEST_NAME'" \
  || fail "guest.name mong đợi 'Nguyen Van An', thực tế: '$GUEST_NAME'"

GUEST_EMAIL=$(echo "$GET2" | grep -o '"email":"[^"]*"' | head -1 | cut -d'"' -f4)
[ "$GUEST_EMAIL" = "anvan@example.com" ] \
  && pass "guest.email đúng: '$GUEST_EMAIL'" \
  || fail "guest.email mong đợi 'anvan@example.com', thực tế: '$GUEST_EMAIL'"

echo "$GET2" | grep -q '"confirm_receipt_available":true' \
  && pass "confirm_receipt_available = true → nút Confirm hiện cho agent" \
  || fail "'confirm_receipt_available' không hiển thị → agent UI sẽ không có nút Confirm"

# Upload lần 2 phải bị từ chối (409)
# Dùng file tạm thứ 2 (không dùng /dev/null — curl trên Windows không đọc được \\.\NUL qua -F @)
PROOF_FILE2="/tmp/test_proof2_$$.jpg"
echo "FAKE2" > "$PROOF_FILE2"
PROOF_WIN2=$(cygpath -w "$PROOF_FILE2" 2>/dev/null || echo "$PROOF_FILE2")
PROOF2_FULL=$(curl -s -w "\n%{http_code}" -X POST "$API/api/bookings/order/$ORDER_ID/proof" -H "X-Tenant-ID: $TENANT" -F "proof=@$PROOF_WIN2;type=image/jpeg") || true
PROOF2_RES=$(echo "$PROOF2_FULL" | tail -1)
rm -f "$PROOF_FILE2"
[ "$PROOF2_RES" = "409" ] \
  && pass "Upload lần 2 trả về 409 Conflict (đúng)" \
  || fail "Upload lần 2 mong đợi 409, thực tế HTTP $PROOF2_RES"

# ─────────────────────────────────────────────────────────────────────────────
# TEST 3 — Revenue Trigger
# Agent xác nhận → total_revenue_tracked tăng đúng số tiền + idempotency guard
# ─────────────────────────────────────────────────────────────────────────────
title "TEST 3: Revenue Trigger (Agent Confirm Receipt)"
echo "  Mong đợi: total_revenue_tracked += grand_total_usd; không bị cộng đôi"
echo ""

# 3a. Snapshot revenue TRƯỚC
SETTINGS_BEFORE=$(curl -s "$API/api/tenants/settings" -H "X-Tenant-ID: $TENANT")
REV_BEFORE=$(json_num "$SETTINGS_BEFORE" "total_revenue_tracked")
REV_BEFORE="${REV_BEFORE:-0}"
info "total_revenue_tracked trước confirm  = $REV_BEFORE"
info "grand_total_usd của đơn hàng         = $GRAND_TOTAL"

# 3b. Agent confirm receipt
CONFIRM_RES=$(curl -s -X POST "$API/api/bookings/order/$ORDER_ID/confirm-receipt" \
  -H "X-Tenant-ID: $TENANT") || CONFIRM_RES="{}"
info "POST confirm-receipt → $CONFIRM_RES"

CONFIRM_STATUS=$(json_str "$CONFIRM_RES" "status")
[ "$CONFIRM_STATUS" = "CONFIRMED" ] \
  && pass "Confirm thành công → status = CONFIRMED" \
  || fail "Status mong đợi CONFIRMED, thực tế: '$CONFIRM_STATUS'"

REVENUE_ADDED=$(json_num "$CONFIRM_RES" "revenue_added")
info "revenue_added trong response = $REVENUE_ADDED"

# 3c. Kiểm tra revenue SAU
SETTINGS_AFTER=$(curl -s "$API/api/tenants/settings" -H "X-Tenant-ID: $TENANT")
REV_AFTER=$(json_num "$SETTINGS_AFTER" "total_revenue_tracked")
REV_AFTER="${REV_AFTER:-0}"
info "total_revenue_tracked sau confirm     = $REV_AFTER"

EXPECTED=$(awk "BEGIN { printf \"%.4f\", ${REV_BEFORE} + ${GRAND_TOTAL:-0} }")
ACTUAL=$(awk    "BEGIN { printf \"%.4f\", $REV_AFTER }")

[ "$ACTUAL" = "$EXPECTED" ] \
  && pass "Revenue tăng đúng: $REV_BEFORE + $GRAND_TOTAL = $ACTUAL" \
  || fail "Revenue sai: mong đợi $EXPECTED, thực tế $ACTUAL"

# 3d. Confirm lần 2 → phải bị block (422)
CONFIRM2_HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$API/api/bookings/order/$ORDER_ID/confirm-receipt" \
  -H "X-Tenant-ID: $TENANT") || CONFIRM2_HTTP="000"
[ "$CONFIRM2_HTTP" = "422" ] \
  && pass "Idempotency guard: confirm lần 2 trả về 422 (đúng)" \
  || fail "Idempotency guard: mong đợi 422, thực tế HTTP $CONFIRM2_HTTP"

# 3e. Revenue KHÔNG được cộng thêm lần 2
SETTINGS_FINAL=$(curl -s "$API/api/tenants/settings" -H "X-Tenant-ID: $TENANT")
REV_FINAL=$(json_num "$SETTINGS_FINAL" "total_revenue_tracked")
REV_FINAL="${REV_FINAL:-0}"
ACTUAL_FINAL=$(awk "BEGIN { printf \"%.4f\", $REV_FINAL }")

[ "$ACTUAL_FINAL" = "$EXPECTED" ] \
  && pass "Double-count guard: revenue vẫn là $ACTUAL_FINAL sau confirm lần 2" \
  || fail "Double-count BUG! Revenue sau confirm lần 2: $ACTUAL_FINAL, mong đợi: $EXPECTED"

# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────────────────
title "KẾT QUẢ"
echo ""
echo -e "  ${GREEN}PASS: $PASS${NC}   |   ${RED}FAIL: $FAIL${NC}"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}Tất cả test PASSED. 3 đòn hiểm hoạt động đúng.${NC}"
  exit 0
else
  echo -e "  ${RED}$FAIL test FAILED. Kiểm tra log bên trên.${NC}"
  exit 1
fi
