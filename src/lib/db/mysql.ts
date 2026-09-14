import mysql from 'mysql2/promise';
import { env } from '@/config/env';

/**
 * MySQL Connection Pool (Singleton)
 * Uses globalThis caching pattern to survive Next.js hot-reloading in development.
 */
declare global {
  // eslint-disable-next-line no-var
  var __mysqlPool: mysql.Pool | undefined;
}

function createPool(): mysql.Pool {
  return mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    dateStrings: true,
  });
}

export const pool: mysql.Pool = global.__mysqlPool ?? createPool();

if (process.env.NODE_ENV !== 'production') {
  global.__mysqlPool = pool;
}

/**
 * Helper to execute SELECT queries
 */
export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

/**
 * Helper to execute INSERT, UPDATE, DELETE queries
 */
export async function execute(sql: string, params: any[] = []): Promise<mysql.ResultSetHeader> {
  const [result] = await pool.execute(sql, params);
  return result as mysql.ResultSetHeader;
}
