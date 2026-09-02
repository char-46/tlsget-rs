# tlsget-rs

一次性 TLS 指纹模拟（Chrome）HTTP GET 工具：Rust 二进制 + npm 分发。

替代 cycletls 在「登录态解析 X/Twitter」场景的使用：无需常驻 websocket 服务、
无端口管理、无生命周期问题，每次请求 spawn 一个静态二进制，`stdin` 进 JSON、
`stdout` 出 JSON。

- 指纹内核：[wreq](https://github.com/0x676e67/wreq)（BoringSSL，Chrome147 模拟：
  TLS ClientHello / JA3 / JA4 / HTTP2 SETTINGS / 头序全对齐）
- 已实测通过 X 的 Cloudflare 边缘：guest/activate.json 200 + GraphQL 200

## CLI 协议

```bash
echo '{"url":"https://x.com/","timeoutMs":30000}' | tlsget
# stdout: {"status":200,"body":"<!DOCTYPE html>..."}

echo '{"url":"...","headers":{"authorization":"Bearer ..."},"cookies":{"auth_token":"...","ct0":"..."}}' | tlsget
# body 为合法 JSON 时自动解析为 JSON 值

tlsget --selftest   # {"ok":true,"version":"1.0.0","emulation":"Chrome147"}
```

失败：exit 1，stderr 输出 `{"error":"timeout: ..."}`（timeout/dns/tls/network/invalid-*）。

## Node API（`@char46/tlsget-rs`）

```js
const { tlsGet, selftest } = require('@char46/tlsget-rs')

const { status, body } = await tlsGet({
  url: 'https://x.com/i/api/graphql/...',
  headers: { authorization: `Bearer ${WEB_BEARER}` },
  cookies: { auth_token, ct0 },
  timeoutMs: 30000,
})
```

平台二进制子包经 optionalDependencies 自动安装（win32-x64 / linux-x64 /
linux-musl-x64 / linux-arm64 / darwin-x64 / darwin-arm64），musl 环境自动切换
静态 musl 构建。

## 构建

```bash
cargo build --release            # 需要 cmake / perl / nasm（boringssl）
```

发布：推送 `v*` 标签触发 CI 六平台构建并发布 npm。

## 许可

MIT。二进制静态链接 [wreq](https://github.com/0x676e67/wreq)（Apache-2.0）与
BoringSSL（OpenSSL/BSD 风格许可），相应许可对其作者所有。
