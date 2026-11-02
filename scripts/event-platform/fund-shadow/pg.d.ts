// The part of node-postgres the pilot runner uses. pg is a dependency of the
// runner bundle only (ops/event-platform/fund-shadow), not of the application,
// so the repository typecheck takes its types from here.
declare module "pg" {
  export interface ClientConfig {
    host?: string; port?: number; database?: string; user?: string; password?: string
    connectionString?: string; application_name?: string; connectionTimeoutMillis?: number
    ssl?: { ca?: string; servername?: string; rejectUnauthorized?: boolean }
  }
  export interface QueryResult { rows: any[]; rowCount: number | null }
  export class Client {
    constructor(config?: ClientConfig)
    connect(): Promise<void>
    query(text: string | { text: string; rowMode?: "array" }, values?: unknown[]): Promise<QueryResult>
    end(): Promise<void>
  }
}
