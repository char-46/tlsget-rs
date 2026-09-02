'use strict'
/**
 * @char46/tlsget-rs — 一次性 TLS 指纹模拟 GET 的 Node 包装。
 *
 * 二进制备份在平台子包（optionalDependencies 自动按 OS/架构安装其一），
 * spawn 后 stdin 写 JSON 请求、stdout 读 JSON 响应。
 */
const { spawn } = require('child_process')
const path = require('path')

const PLATFORM_PACKAGES = {
  'win32-x64': { pkg: '@char46/tlsget-rs-win32-x64', bin: 'tlsget.exe' },
  'linux-x64': { pkg: '@char46/tlsget-rs-linux-x64', bin: 'tlsget' },
  'linux-arm64': { pkg: '@char46/tlsget-rs-linux-arm64', bin: 'tlsget' },
  'darwin-x64': { pkg: '@char46/tlsget-rs-darwin-x64', bin: 'tlsget' },
  'darwin-arm64': { pkg: '@char46/tlsget-rs-darwin-arm64', bin: 'tlsget' },
}

/** musl 检测（Alpine 等）：静态 musl 二进制在 glibc 与 musl 环境均可运行，musl 环境必须用它 */
function detectMusl() {
  if (process.platform !== 'linux') return false
  const report = process.report?.getReport?.()
  const header = report?.header?.glibcVersionRuntime
  if (header) return false // glibc 运行时存在
  return process.features?.musl !== undefined ? process.features.musl : true
}

/** 解析二进制绝对路径；未安装对应平台包时返回 null */
function binaryPath() {
  const key = `${process.platform}-${process.arch}`
  const entry = PLATFORM_PACKAGES[key]
  if (!entry) return null
  // musl 环境：glibc 构建无法运行，强制使用 musl 静态子包
  const pkg = entry.pkg === '@char46/tlsget-rs-linux-x64' && detectMusl()
    ? '@char46/tlsget-rs-linux-musl-x64'
    : entry.pkg
  try {
    return require.resolve(path.join(pkg, entry.bin))
  } catch {
    return null
  }
}

/**
 * 自检：无网络请求，验证二进制可执行。返回 { ok, version, emulation } 或抛错。
 */
async function selftest() {
  const bin = binaryPath()
  if (!bin) throw new Error(`tlsget: no binary for ${process.platform}-${process.arch}（平台子包未安装）`)
  const out = await new Promise((resolve, reject) => {
    const child = spawn(bin, ['--selftest'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr || `exit ${code}`))))
  })
  return JSON.parse(out)
}

/**
 * TLS 指纹模拟 GET。
 * @param {{url:string, headers?:Record<string,string>, cookies?:Record<string,string>, timeoutMs?:number, proxy?:string}} req
 * @returns {Promise<{status:number, body:any}>}
 */
async function tlsGet(req) {
  const bin = binaryPath()
  if (!bin) throw new Error(`tlsget: no binary for ${process.platform}-${process.arch}（平台子包未安装）`)
  const payload = JSON.stringify({
    url: req.url,
    headers: req.headers,
    cookies: req.cookies,
    timeoutMs: req.timeoutMs,
    proxy: req.proxy,
  })
  const graceMs = (req.timeoutMs || 30000) + 10000

  return new Promise((resolve, reject) => {
    const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let stdout = '', stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('tlsget: process timeout (killed)'))
    }, graceMs)
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`tlsget: spawn failed: ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout))
        } catch (e) {
          reject(new Error(`tlsget: unparseable output: ${stdout.slice(0, 120)}`))
        }
      } else {
        let msg = `exit ${code}`
        try {
          msg = JSON.parse(stderr).error || msg
        } catch {}
        reject(new Error(`tlsget: ${msg}`))
      }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(payload)
  })
}

module.exports = { tlsGet, selftest, binaryPath }
