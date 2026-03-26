# Pricing API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | /api/pricing/:group | Lấy danh sách bản ghi pricing cho group (tenant-seasons, pricing-segments, pax-bands, tour-prices) |
| POST   | /api/pricing/:group | Tạo mới bản ghi pricing cho group. Xem trường bắt buộc bên dưới |
| PATCH  | /api/pricing/:group/:itemId | Cập nhật bản ghi pricing theo id |
| DELETE | /api/pricing/:group/:itemId | Xóa bản ghi pricing theo id |

## Required fields for POST

| Group            | Required fields |
|------------------|----------------|
| tenant-seasons   | tenant_id, name, start_month, start_day, end_month, end_day |
| pricing-segments | tenant_id, name |
| pax-bands        | tenant_id, name, min_pax, max_pax |
| tour-prices      | tenant_id, tour_id, season_id, segment_id, pax_band_id, price |

## Curl Examples

### Lấy danh sách
curl http://127.0.0.1:8787/api/pricing/tenant-seasons

### Tạo mới
curl -X POST http://127.0.0.1:8787/api/pricing/tenant-seasons \
  -H 'Content-Type: application/json' \
  -d '{"tenant_id":"ten-demo-001","name":"Mùa cao điểm","start_month":6,"start_day":1,"end_month":8,"end_day":31}'

### Cập nhật
curl -X PATCH http://127.0.0.1:8787/api/pricing/tenant-seasons/<itemId> \
  -H 'Content-Type: application/json' \
  -d '{"name":"Mùa thấp điểm"}'

### Xóa
curl -X DELETE http://127.0.0.1:8787/api/pricing/tenant-seasons/<itemId>
