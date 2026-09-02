export interface TlsGetRequest {
  url: string
  headers?: Record<string, string>
  cookies?: Record<string, string>
  timeoutMs?: number
  proxy?: string
}

export interface TlsGetResponse {
  status: number
  body: any
}

export interface SelftestResult {
  ok: boolean
  version: string
  emulation: string
}

export declare function tlsGet(req: TlsGetRequest): Promise<TlsGetResponse>
export declare function selftest(): Promise<SelftestResult>
export declare function binaryPath(): string | null
