#!/bin/bash

BASE="http://127.0.0.1:8787"

echo "=== 1) Creating intercity leg ==="
CREATE=$(curl -s -X POST $BASE/api/stops/1/intercity-legs \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: ten-demo-001" \
  -d '{"mode":"Train","supplier":"Vietnam Railways","address":"Hanoi Station","person_in_charge":"Anna","depart_point":"Hanoi","arrive_point":"Ninh Binh"}')

echo "$CREATE"

ITEM_ID=$(echo $CREATE | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

echo "Created intercity leg ID: $ITEM_ID"
echo ""

echo "=== 2) Fetching intercity legs with tasks ==="
LIST=$(curl -s $BASE/api/stops/1/intercity-legs \
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

echo "=== 5) Fetching intercity legs again to verify task updated ==="
FINAL=$(curl -s $BASE/api/stops/1/intercity-legs \
  -H "X-Tenant-ID: ten-demo-001")
echo "$FINAL"
echo ""

echo "=== TEST COMPLETE ==="
