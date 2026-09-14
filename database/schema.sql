-- =============================================================================
-- CƠ SỞ DỮ LIỆU SQL (MYSQL) - QUẢN LÝ TÀI KHOẢN VÀ XÁC THỰC
-- Kiến trúc Hybrid (Polyglot Persistence):
--   - MySQL: Quản lý bảng `users` (đảm bảo tính toàn vẹn ACID, unique username/email, bảo mật)
--   - AWS DynamoDB: Quản lý bảng đơn `Problems` (Single-Table Design: đề bài + test cases + submissions) với GSI
-- =============================================================================

CREATE DATABASE IF NOT EXISTS `online_judge_db`
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_unicode_ci;

USE `online_judge_db`;

-- Xóa bảng cũ nếu đã tồn tại
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `users`;
SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- BẢNG NGƯỜI DÙNG (USERS)
-- Lưu trữ thông tin tài khoản, mật khẩu băm, phục vụ đăng nhập/đăng ký
-- =============================================================================
CREATE TABLE `users` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `username` VARCHAR(50) NOT NULL UNIQUE COMMENT 'Tên đăng nhập',
    `email` VARCHAR(120) NOT NULL UNIQUE COMMENT 'Địa chỉ email',
    `password` VARCHAR(255) NOT NULL COMMENT 'Mật khẩu (đã băm hoặc chuỗi hash)',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Bảng người dùng lưu trên MySQL';

-- =============================================================================
-- DỮ LIỆU MẪU BAN ĐẦU (SEED DATA)
-- Mật khẩu mẫu đã được băm bằng chuẩn Bcrypt (Mật khẩu gốc là: 'password123')
-- =============================================================================
INSERT INTO `users` (`id`, `username`, `email`, `password`) VALUES
(1, 'admin', 'admin@example.com', '$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe/QLSUG6xNekdHgTGmrpHEfIoxm'),
(2, 'student1', 'student1@example.com', '$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe/QLSUG6xNekdHgTGmrpHEfIoxm');

-- =============================================================================
-- LƯU Ý VỀ CÁC BẢNG ĐÃ CHUYỂN QUA NoSQL (AWS DYNAMODB):
-- Áp dụng Single-Table Design: Toàn bộ thực thể liên quan đến Problem (đề bài,
-- test cases nhúng, và các lượt nộp bài Submissions) đã được gộp vào 1 bảng duy nhất
-- tên là `Problems` trên AWS DynamoDB (xem setup-dynamodb.sh).
-- Sử dụng GSI `user-submissions-index` để truy vấn lịch sử nộp bài của học viên theo user_id.
-- =============================================================================

