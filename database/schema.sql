-- =============================================================================
-- CƠ SỞ DỮ LIỆU SQL (MYSQL) - QUẢN LÝ TÀI KHOẢN VÀ XÁC THỰC
-- Kiến trúc Hybrid (Polyglot Persistence):
--   - MySQL: Quản lý bảng `users` (đảm bảo tính toàn vẹn ACID, unique username/email, bảo mật)
--   - AWS DynamoDB:
--       + Bảng `Problems` (Single-Table Design: đề bài + test cases + submissions) với GSI
--       + Bảng `Interviews` (Single-Table Design: phiên phỏng vấn + chat + code snapshots + AI evaluation)
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
-- Lưu trữ thông tin tài khoản, hồ sơ cá nhân, phân quyền, và thống kê phỏng vấn
-- =============================================================================
CREATE TABLE `users` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `username` VARCHAR(50) NOT NULL UNIQUE COMMENT 'Tên đăng nhập',
    `email` VARCHAR(120) NOT NULL UNIQUE COMMENT 'Địa chỉ email',
    `password` VARCHAR(255) NOT NULL COMMENT 'Mật khẩu (đã băm Bcrypt)',
    `full_name` VARCHAR(100) DEFAULT NULL COMMENT 'Họ và tên đầy đủ',
    `avatar_url` VARCHAR(500) DEFAULT NULL COMMENT 'URL ảnh đại diện',
    `role` ENUM('CANDIDATE', 'ADMIN') NOT NULL DEFAULT 'CANDIDATE' COMMENT 'Vai trò người dùng',
    `skill_level` ENUM('JUNIOR', 'MID', 'SENIOR') DEFAULT 'JUNIOR' COMMENT 'Trình độ kỹ năng',
    `target_role` VARCHAR(100) DEFAULT NULL COMMENT 'Vị trí ứng tuyển mong muốn (Backend, Frontend, Fullstack...)',
    `bio` TEXT DEFAULT NULL COMMENT 'Giới thiệu bản thân',
    `total_interviews` INT NOT NULL DEFAULT 0 COMMENT 'Tổng số phiên phỏng vấn đã hoàn thành',
    `avg_score` DECIMAL(4,1) NOT NULL DEFAULT 0.0 COMMENT 'Điểm trung bình phỏng vấn (0-100)',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Bảng người dùng - hệ thống mô phỏng phỏng vấn SE';

-- =============================================================================
-- DỮ LIỆU MẪU BAN ĐẦU (SEED DATA)
-- Mật khẩu mẫu đã được băm bằng chuẩn Bcrypt (Mật khẩu gốc là: 'password123')
-- =============================================================================
INSERT INTO `users` (`id`, `username`, `email`, `password`, `full_name`, `role`, `skill_level`, `target_role`, `bio`, `total_interviews`, `avg_score`) VALUES
(1, 'admin', 'admin@example.com', '$2b$10$8eX0xmjXpbD/ehWX.rlrBO/IA5VZV8O2VVm6AWDTbz79dM21n2nLu',
    'System Administrator', 'ADMIN', 'SENIOR', NULL, 'Quản trị viên hệ thống', 0, 0.0),
(2, 'student1', 'student1@example.com', '$2b$10$8eX0xmjXpbD/ehWX.rlrBO/IA5VZV8O2VVm6AWDTbz79dM21n2nLu',
    'Nguyễn Văn A', 'CANDIDATE', 'JUNIOR', 'Backend Developer', 'Sinh viên CNTT năm 4, đang tìm kiếm vị trí Backend Developer', 2, 72.5);

-- =============================================================================
-- LƯU Ý VỀ CÁC BẢNG ĐÃ CHUYỂN QUA NoSQL (AWS DYNAMODB):
-- 1. Bảng `Problems` (Single-Table Design):
--    Toàn bộ thực thể liên quan đến Problem (đề bài, test cases nhúng, và các
--    lượt nộp bài Submissions) đã được gộp vào 1 bảng duy nhất.
--    GSI: `user-submissions-index`, `category-difficulty-index`
--    → Xem: setup-dynamodb.sh
--
-- 2. Bảng `Interviews` (Single-Table Design) [MỚI]:
--    Toàn bộ thực thể liên quan đến phiên phỏng vấn mô phỏng (Interview Session,
--    Chat Messages, Code Snapshots, AI Evaluation) được quản lý trong 1 bảng.
--    GSI: `user-interviews-index`, `problem-interviews-index`
--    → Xem: setup-dynamodb.sh (Part 2)
-- =============================================================================

