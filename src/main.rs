/**
 * tlsget — 一次性 TLS 指纹模拟 GET 工具
 *
 * 协议：stdin 读 JSON 请求 → stdout 写 JSON 响应；失败 exit 1 + stderr JSON。
 *   请求: {"url":"...", "headers":{...}, "cookies":{...}, "timeoutMs":30000, "proxy":"http://..."}
 *   响应: {"status":200, "body":<JSON值或字符串>}
 *   失败: {"error":"..."} （timeout / dns / tls / invalid-json-request 等）
 *
 * 自检: tlsget --selftest → {"ok":true,"version":"...","emulation":"Chrome147"}
 */
use std::io::Read;
use std::process::ExitCode;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use wreq::header::{HeaderMap, HeaderName, HeaderValue};
use wreq::Client;

#[derive(Deserialize)]
struct Request {
    url: String,
    #[serde(default)]
    headers: Option<std::collections::BTreeMap<String, String>>,
    #[serde(default)]
    cookies: Option<std::collections::BTreeMap<String, String>>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(default)]
    proxy: Option<String>,
}

fn fail(msg: impl std::fmt::Display) -> ExitCode {
    eprintln!("{}", json!({ "error": msg.to_string() }));
    ExitCode::FAILURE
}

fn build_headers(req: &Request) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    if let Some(headers) = &req.headers {
        for (k, v) in headers {
            let name = HeaderName::from_bytes(k.as_bytes()).map_err(|e| format!("invalid header name {k:?}: {e}"))?;
            let value = HeaderValue::from_str(v).map_err(|e| format!("invalid header value for {k:?}: {e}"))?;
            map.insert(name, value);
        }
    }
    if let Some(cookies) = &req.cookies {
        if !cookies.is_empty() {
            let joined = cookies.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("; ");
            if let Ok(v) = HeaderValue::from_str(&joined) {
                map.insert(HeaderName::from_static("cookie"), v);
            }
        }
    }
    Ok(map)
}

#[tokio::main]
async fn main() -> ExitCode {
    // 自检模式：无网络请求，供宿主诊断
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--selftest") {
        println!("{}", json!({ "ok": true, "version": env!("CARGO_PKG_VERSION"), "emulation": "Chrome147" }));
        return ExitCode::SUCCESS;
    }

    // stdin 读请求
    let mut input = String::new();
    if let Err(e) = std::io::stdin().read_to_string(&mut input) {
        return fail(format!("read stdin failed: {e}"));
    }
    let req: Request = match serde_json::from_str(&input) {
        Ok(r) => r,
        Err(e) => return fail(format!("invalid request json: {e}")),
    };

    let headers = match build_headers(&req) {
        Ok(h) => h,
        Err(e) => return fail(e),
    };

    let mut builder = Client::builder()
        .emulation(wreq_util::Emulation::Chrome147)
        .no_proxy()
        .timeout(Duration::from_millis(req.timeout_ms.unwrap_or(30_000).max(1)));

    if let Some(proxy) = &req.proxy {
        match wreq::Proxy::all(proxy) {
            Ok(p) => builder = builder.proxy(p),
            Err(e) => return fail(format!("invalid proxy {proxy:?}: {e}")),
        }
    }

    let client = match builder.build() {
        Ok(c) => c,
        Err(e) => return fail(format!("build client failed: {e}")),
    };

    let mut request = client.get(&req.url);
    if !headers.is_empty() {
        request = request.headers(headers);
    }

    let response = match request.send().await {
        Ok(r) => r,
        Err(e) => {
            let msg = e.to_string();
            let kind = if msg.contains("timed out") || msg.contains("timeout") {
                "timeout"
            } else if msg.contains("dns") || msg.contains("resolve") {
                "dns"
            } else if msg.contains("tls") || msg.contains("certificate") {
                "tls"
            } else {
                "network"
            };
            return fail(format!("{kind}: {msg}"));
        }
    };

    let status = response.status().as_u16();
    let body = match response.text().await {
        Ok(t) => t,
        Err(e) => return fail(format!("read body failed: {e}")),
    };
    let body_value: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => Value::String(body),
    };
    println!("{}", json!({ "status": status, "body": body_value }));
    ExitCode::SUCCESS
}
