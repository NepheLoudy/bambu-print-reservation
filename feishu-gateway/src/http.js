// ============================================================
// 出站 fetch 超时封装（AbortController）：全仓出站 fetch 统一走这里，
// 超时口径一处管——普通 8s（与 dispatch.postJson 先例一致）、
// tenant token 获取 15s（登录接口偶发慢，给宽些）。超时以 AbortError
// reject，由调用方按各自错误路径处理（postJson 转失败结果，其余走 catch）。
// ============================================================
const FETCH_TIMEOUT_MS = 8000;
const TOKEN_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url, opts = {}, ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchWithTimeout, FETCH_TIMEOUT_MS, TOKEN_TIMEOUT_MS };
