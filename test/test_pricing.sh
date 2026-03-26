#!/bin/bash
set -e

API_URL="http://127.0.0.1:8787/api/pricing"

# Chạy test lần lượt cho từng endpoint
for GROUP in "tenant-seasons" "pricing-segments" "pax-bands" "tour-prices"; do
    echo "-----------------------------------------------"
    echo ">>> Testing Group: $GROUP"
    
    # 1. CREATE
    CREATE_RES=$(curl -s -X POST "$API_URL/$GROUP" \
        -H 'Content-Type: application/json' \
        -H 'X-Tenant-ID: ten-demo-001' \
        -d "{\"name\":\"Test $GROUP\"}")
    
    # Kiểm tra nếu response là 404
    if [[ "$CREATE_RES" == *"Not Found"* ]]; then
        echo " [ERROR] Endpoint $API_URL/$GROUP return 404."
        echo " Hãy kiểm tra lại src/index.js đã route tới src/routes/pricing.js chưa."
        exit 1
    fi

    ID=$(echo $CREATE_RES | grep -o '"id":"[^"]*"' | head -1 | cut -d':' -f2 | tr -d '"')
    
    if [ -z "$ID" ]; then
        echo " [ERROR] Could not extract ID. Response: $CREATE_RES"
        exit 1
    fi
    echo " [+] Created ID: $ID"

    # 2. DELETE (Dọn dẹp luôn)
    echo " [+] Cleaning up $ID..."
    curl -s -X DELETE "$API_URL/$GROUP/$ID" \
        -H 'X-Tenant-ID: ten-demo-001' > /dev/null
    echo " [+] Done."
done

echo ""
echo "PRICING BASE TESTS FINISHED."