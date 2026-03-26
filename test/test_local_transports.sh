#!/bin/bash

BASE="http://127.0.0.1:8787"

echo "=== 1) Creating local transport ==="
CREATE=$(curl -s -X POST $BASE/api/stops/1/local-transports \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: ten-demo-001" \
  -d '{"mode":"Car","supplier":"Local Driver Co","address":"123 Hanoi","person_in_charge":"Anna"}')

echo "$CREATE"

ITEM_ID=$(echo $CREATE | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

echo "Created local transport ID: $ITEM_ID"
echo ""

echo "=== 2) Fetching local transports with tasks ==="
LIST=$(curl -s $BASE/api/stops/1/local-transports \
  -H "X-Tenant-ID: ten-demo-001")
echo "$LIST"
echo ""

echo "=== 3) Extracting first task ID ==="
TASK_ID=$(echo $LIST | sed -n 's/.*"tasks":

\[\{"id":"\([^"]*\)".*/\1/p')

echo "Task ID: $TASK_ID"
echo ""

echo "=== 4) Marking task as done ==="
UPDATE=$(curl -s -X PATCH $BASE/api/tasks/$TASK_ID \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}')

echo "$UPDATE"
echo ""

echo "=== 5) Fetching local transports again to verify task updated ==="
FINAL=$(curl -s $BASE/api/stops/1/local-transports \
  -H "X-Tenant-ID: ten-demo-001")
echo "$FINAL"
echo ""

echo "=== TEST COMPLETE ==="
