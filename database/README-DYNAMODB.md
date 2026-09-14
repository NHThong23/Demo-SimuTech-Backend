# Hướng dẫn Thiết kế AWS DynamoDB cho Website Coding (Single-Table Design & GSI)

## 1. Giới thiệu Kiến Trúc Single-Table Design

Khác với mô hình Cơ sở dữ liệu Quan hệ (MySQL) chia nhỏ thành nhiều bảng (`problems`, `test_cases`, `submissions`), trong **Amazon DynamoDB (NoSQL)** chuẩn thiết kế tối ưu nhất là **Single-Table Design (Thiết kế Đơn Bảng)**:

1. **Gộp toàn bộ các thực thể liên quan đến Problem vào 1 bảng duy nhất**: `Problems`.
   - **Đề bài (Problem Metadata)**: Chứa thông tin bài tập, starter code và **nhúng trực tiếp danh sách test cases** (`test_cases: [...]`).
   - **Bài nộp (Submissions)**: Được lưu cùng bảng dưới cùng khóa phân vùng `problem_id` của bài tập đó.
2. **Sử dụng GSI (Global Secondary Index) để đảo chiều truy vấn**:
   - Khi bảng chính được phân vùng theo `problem_id`, để học viên xem được **lịch sử nộp bài cá nhân** theo `user_id`, ta sử dụng **GSI: `user-submissions-index`**.
   - Đây là một **Sparse Index (Chỉ mục thưa)**: Chỉ các item là lượt nộp bài (có thuộc tính `user_id`) mới được lập chỉ mục, các item đề bài không có `user_id` sẽ được bỏ qua, giúp tiết kiệm dung lượng và chi phí tối đa.
   - Thêm **GSI: `category-difficulty-index`** hỗ trợ lọc bài tập theo chuyên mục và độ khó.

---

## 2. Thiết Kế Bảng `Problems`

### Khóa chính của bảng (Primary Key):
- **Partition Key (PK - HASH)**: `problem_id` (String) — ví dụ: `"prob_1"`
- **Sort Key (SK - RANGE)**: `sk` (String)
  - Đối với đề bài: `sk = "METADATA"`
  - Đối với bài nộp: `sk = "SUBMISSION#<submission_id>"` (ví dụ: `"SUBMISSION#sub_1725700000001"`)

### Chỉ mục phụ toàn cục (Global Secondary Indexes - GSI):

| Tên GSI | Partition Key (HASH) | Sort Key (RANGE) | Loại chỉ mục | Mục đích sử dụng |
| :--- | :--- | :--- | :--- | :--- |
| **`user-submissions-index`** | `user_id` (String) | `created_at` (String) | Sparse GSI | Lấy toàn bộ lịch sử nộp bài của 1 học viên sắp xếp theo thời gian nộp |
| **`category-difficulty-index`** | `category` (String) | `difficulty` (String) | Sparse GSI | Lọc danh sách bài tập theo chủ đề (Array, String,...) và độ khó (EASY,...) |

---

## 3. Cấu Trúc Chi Tiết Các Item (Bản Ghi)

### 3.1. Item Đề bài (`sk = "METADATA"`)
```json
{
  "problem_id": "prob_1",
  "sk": "METADATA",
  "entity_type": "PROBLEM",
  "title": "Two Sum",
  "description": "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.\n\nExample:\nInput: nums = [2,7,11,15], target = 9\nOutput: [0,1]",
  "difficulty": "EASY",
  "category": "Array",
  "starter_code": "def two_sum(nums, target):\n    # Write your code here\n    pass",
  "test_cases": [
    { "id": 1, "input": "[2,7,11,15]\n9", "output": "[0,1]", "is_sample": true },
    { "id": 2, "input": "[3,2,4]\n6", "output": "[1,2]", "is_sample": true },
    { "id": 3, "input": "[3,3]\n6", "output": "[0,1]", "is_sample": false }
  ],
  "created_at": "2026-09-07T10:10:00Z"
}
```

> **Cập nhật cho module AI Interviewer:** đề bài có thêm 2 trường tùy chọn `hidden_constraints` (danh sách ràng buộc cố tình giấu ứng viên, AI chỉ tiết lộ khi ứng viên hỏi trúng) và `follow_up_topics` (danh sách câu hỏi mở rộng dùng ở chặng phản biện). Đề nào chưa có 2 trường này thì AI tự suy ra từ mô tả đề. Hai trường này **không bao giờ** trả về cho frontend.

### 3.2. Item Lượt nộp bài (`sk = "SUBMISSION#..."`)
```json
{
  "problem_id": "prob_1",
  "sk": "SUBMISSION#sub_1725700000001",
  "entity_type": "SUBMISSION",
  "submission_id": "sub_1725700000001",
  "user_id": "2",
  "language": "python",
  "code": "def two_sum(nums, target): ...",
  "status": "ACCEPTED",
  "execution_time_ms": 45,
  "created_at": "2026-09-07T10:30:00Z"
}
```

---

## 4. Bảng Tra Cứu Access Patterns (Mẫu Truy Vấn)

| STT | Nhu cầu người dùng | Cơ chế truy vấn DynamoDB | Câu lệnh mẫu |
| :--- | :--- | :--- | :--- |
| **AP1** | Xem nội dung đề bài & test cases | `GetItem` trên bảng chính | `Key: { problem_id: 'prob_1', sk: 'METADATA' }` |
| **AP2** | Xem danh sách bài nộp của bài toán | `Query` trên bảng chính | `problem_id = 'prob_1' AND begins_with(sk, 'SUBMISSION#')` |
| **AP3** | Lấy cả đề bài lẫn các lượt nộp gần nhất | `Query` trên bảng chính (1 request) | `problem_id = 'prob_1'` |
| **AP4** | Học viên xem lịch sử nộp bài của mình | `Query` qua **GSI: `user-submissions-index`** | `user_id = '2'` (sắp xếp giảm dần theo `created_at`) |
| **AP5** | Lọc bài tập theo dạng bài và độ khó | `Query` qua **GSI: `category-difficulty-index`** | `category = 'Array' AND difficulty = 'EASY'` |

---

## 5. Hướng Dẫn Thực Thi Bằng AWS CLI

### 5.1. Khởi tạo bảng bằng PowerShell (Windows):
```powershell
aws dynamodb create-table `
    --table-name Problems `
    --attribute-definitions `
        AttributeName=problem_id,AttributeType=S `
        AttributeName=sk,AttributeType=S `
        AttributeName=user_id,AttributeType=S `
        AttributeName=created_at,AttributeType=S `
        AttributeName=category,AttributeType=S `
        AttributeName=difficulty,AttributeType=S `
    --key-schema `
        AttributeName=problem_id,KeyType=HASH `
        AttributeName=sk,KeyType=RANGE `
    --global-secondary-indexes '[
        {
            "IndexName": "user-submissions-index",
            "KeySchema": [
                {"AttributeName": "user_id", "KeyType": "HASH"},
                {"AttributeName": "created_at", "KeyType": "RANGE"}
            ],
            "Projection": {"ProjectionType": "ALL"}
        },
        {
            "IndexName": "category-difficulty-index",
            "KeySchema": [
                {"AttributeName": "category", "KeyType": "HASH"},
                {"AttributeName": "difficulty", "KeyType": "RANGE"}
            ],
            "Projection": {"ProjectionType": "ALL"}
        }
    ]' `
    --billing-mode PAY_PER_REQUEST
```

### 5.2. Chạy tự động qua Script:
Bạn chỉ cần mở terminal và chạy script khởi tạo sẵn:
```bash
chmod +x setup-dynamodb.sh
./setup-dynamodb.sh
```

---

## 6. Truy Vấn Bằng SQL Trên DynamoDB (PartiQL)

Trong AWS Console -> DynamoDB -> **PartiQL editor**:

### Lấy thông tin đề bài Two Sum:
```sql
SELECT * FROM "Problems"
WHERE "problem_id" = 'prob_1' AND "sk" = 'METADATA';
```

### Lấy toàn bộ các bài nộp của bài Two Sum:
```sql
SELECT * FROM "Problems"
WHERE "problem_id" = 'prob_1' AND "sk" LIKE 'SUBMISSION#%';
```

### Dùng GSI lấy lịch sử nộp bài của user 2:
```sql
SELECT * FROM "Problems"."user-submissions-index"
WHERE "user_id" = '2';
```

### Dùng GSI lọc bài tập theo Category và Difficulty:
```sql
SELECT * FROM "Problems"."category-difficulty-index"
WHERE "category" = 'Array' AND "difficulty" = 'EASY';
```
