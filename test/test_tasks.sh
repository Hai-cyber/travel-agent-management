#!/bin/bash

BASE="http://127.0.0.1:8787"

echo "=== 1) Creating accommodation ==="
CREATE=$(curl -s -X POST $BASE/api/stops/1/accommodations \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: ten-demo-001" \
  -d '{"hotel_name":"Test Hotel","person_in_charge":"Anna","address":"123 Street"}')

echo "$CREATE"

ITEM_ID=$(echo $CREATE | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

echo "Created item ID: $ITEM_ID"
echo ""

echo "=== 2) Fetching accommodations with tasks ==="
LIST=$(curl -s $BASE/api/stops/1/accommodations \
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
  -H "X-Tenant-ID: ten-demo-001" \
  -d '{"status":"done"}')

echo "$UPDATE"
echo ""

echo "=== 5) Fetching accommodations again to verify task updated ==="
FINAL=$(curl -s $BASE/api/stops/1/accommodations \
  -H "X-Tenant-ID: ten-demo-001")
echo "$FINAL"
echo ""

echo "=== TEST COMPLETE ==="
