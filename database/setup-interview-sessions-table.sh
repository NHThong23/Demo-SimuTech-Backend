#!/usr/bin/env bash
# =============================================================================
# Khởi tạo bảng DynamoDB `InterviewSessions` cho module AI Interviewer.
# Single-Table Design: META, TURN#, CODE#, RUN#, BOARD#, EVAL trong cùng 1 bảng.
# Usage:
#   chmod +x setup-interview-sessions-table.sh && ./setup-interview-sessions-table.sh
#   ENDPOINT_URL="http://localhost:8000" ./setup-interview-sessions-table.sh   # DynamoDB Local
# =============================================================================
set -e

REGION="${AWS_REGION:-us-east-1}"
EXTRA_ARGS=()

if [ -n "$ENDPOINT_URL" ]; then
    EXTRA_ARGS+=(--endpoint-url "$ENDPOINT_URL")
    echo "[*] Connecting to Endpoint: $ENDPOINT_URL"
else
    EXTRA_ARGS+=(--region "$REGION")
    echo "[*] Using AWS Region: $REGION"
fi

echo "=========================================================="
echo "CREATING TABLE 'InterviewSessions'..."
echo "=========================================================="

aws dynamodb create-table "${EXTRA_ARGS[@]}" \
    --table-name InterviewSessions \
    --attribute-definitions \
        AttributeName=session_id,AttributeType=S \
        AttributeName=sk,AttributeType=S \
        AttributeName=user_id,AttributeType=S \
        AttributeName=started_at,AttributeType=S \
    --key-schema \
        AttributeName=session_id,KeyType=HASH \
        AttributeName=sk,KeyType=RANGE \
    --global-secondary-indexes '[
        {
            "IndexName": "user-sessions-index",
            "KeySchema": [
                {"AttributeName": "user_id", "KeyType": "HASH"},
                {"AttributeName": "started_at", "KeyType": "RANGE"}
            ],
            "Projection": {"ProjectionType": "ALL"}
        }
    ]' \
    --billing-mode PAY_PER_REQUEST || echo "Table InterviewSessions may already exist, continuing..."

echo ""
echo "Waiting for table InterviewSessions to become ACTIVE..."
if [ -z "$ENDPOINT_URL" ]; then
    aws dynamodb wait table-exists --table-name InterviewSessions "${EXTRA_ARGS[@]}"
fi

echo "[SUCCESS] InterviewSessions table ready."
