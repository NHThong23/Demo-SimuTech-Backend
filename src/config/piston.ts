// =============================================================================
// CẤU HÌNH PISTON CODE EXECUTION ENGINE
// Mapping ngôn ngữ frontend → Piston runtime + giới hạn tài nguyên
// =============================================================================

import { env } from './env';

/**
 * Thông tin runtime cho mỗi ngôn ngữ trên Piston
 */
export interface PistonLanguageConfig {
  /** Tên ngôn ngữ trên Piston (dùng khi gọi API) */
  pistonName: string;
  /** Phiên bản cụ thể đã cài trên Piston */
  version: string;
  /** Tên file mặc định cho source code */
  defaultFileName: string;
}

/**
 * Mapping ngôn ngữ từ frontend sang Piston runtime.
 * Key = tên ngôn ngữ mà frontend gửi lên (lowercase).
 * Value = thông tin cần thiết để Piston biên dịch/chạy.
 */
export const LANGUAGE_MAP: Record<string, PistonLanguageConfig> = {
  python: {
    pistonName: 'python',
    version: '3.12.0',
    defaultFileName: 'main.py',
  },
  python3: {
    pistonName: 'python',
    version: '3.12.0',
    defaultFileName: 'main.py',
  },
  javascript: {
    pistonName: 'javascript',
    version: '20.11.1',
    defaultFileName: 'main.js',
  },
  js: {
    pistonName: 'javascript',
    version: '20.11.1',
    defaultFileName: 'main.js',
  },
  node: {
    pistonName: 'javascript',
    version: '20.11.1',
    defaultFileName: 'main.js',
  },
  java: {
    pistonName: 'java',
    version: '17.0.6',
    defaultFileName: 'Main.java',
  },
  cpp: {
    pistonName: 'c++',
    version: '13.2.0',
    defaultFileName: 'main.cpp',
  },
  'c++': {
    pistonName: 'c++',
    version: '13.2.0',
    defaultFileName: 'main.cpp',
  },
  c: {
    pistonName: 'c',
    version: '13.2.0',
    defaultFileName: 'main.c',
  },
};

/**
 * Cấu hình tổng thể cho Piston Engine
 */
export const pistonConfig = {
  /** URL endpoint của Piston API */
  apiUrl: env.PISTON_API_URL || 'http://localhost:2000',

  /** Giới hạn timeout (ms) */
  timeout: {
    /** Thời gian tối đa cho compile (10 giây) */
    compile: 10_000,
    /** Thời gian tối đa cho run (5 giây) */
    run: 5_000,
  },

  /** Giới hạn bộ nhớ (bytes), -1 = không giới hạn (dùng mặc định của Piston) */
  memoryLimit: {
    compile: -1,
    run: -1,
  },

  /** Kích thước tối đa output (bytes) */
  maxOutputSize: 65_536,
};
