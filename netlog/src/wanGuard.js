/**
 * wanGuard —— netlog v2 断网复活引擎（协议无关状态机，依赖注入可测）
 *
 * 职责（曼波 2026-09-27 三项设计）：
 *   ①复活强化：wan 断（当轮原始信号，抢在防抖判定前自愈）+ lan 活 → 按账号池顺序逐个调
 *     eportal login，每个 tick 尝试一个账号，wan 真恢复才算成功；全用尽 → 通知 + 30 分钟冷却重试；
 *   ②首选项：31108753 永远先试（accountPool.listCandidates 已保证）；
 *   ③慢速降级：复活恢复后 20s 宽限 → 连 3 次探针取中位数，超过健康基线 3 倍
 *     → 判该账号被限速 → 打「本月不再使用」→ 自动换下一个账号复活。
 *
 * 基线：wan 健康期间的探测延迟滑动样本（最近 20 个成功值取中位数，下限 BASELINE_FLOOR）。
 */
const BASELINE_FLOOR_MS = 30;
const BASELINE_SAMPLES = 20;
const SLOW_FACTOR = 3;
const SLOW_PROBE_COUNT = 3;
const SLOW_PROBE_GAP_MS = 2000;
const RECOVER_GRACE_MS = 20000; // 恢复后宽限：新会话/路由冷启动可能偏慢，等 20s 再判
const EXHAUSTED_COOLDOWN_MS = 30 * 60 * 1000;

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * @param {object} deps
 *   candidates() → [{user,password,priority}] 当前可用账号（弃用已滤）
 *   authIp() → Promise<string|null> 要放行的 IP（主路由 WAN IP）
 *   login({user,password,authIp}) → Promise 登录请求（成败由 wan 验证裁决）
 *   probeLatency() → Promise<number|null> 单次探测延迟 ms（失败 null）
 *   ban(user, reason) → 打当月弃用
 *   emit(event, detail) → 事件上报（engine 的 record+notify）
 *   now() → Date；tickMs 探测周期
 */
function createWanGuard(deps) {
  const { candidates, authIp, login, probeLatency, ban, emit, now = () => new Date(), tickMs = 60000 } = deps;

  const state = {
    reviving: false,
    queue: [],            // 本轮复活剩余候选
    current: null,        // 当前已 login、待验证的账号
    roundStartedAt: 0,
    exhaustedUntil: 0,
    baseline: BASELINE_FLOOR_MS,
    samples: [],          // 健康期延迟样本
    pendingSlow: null,    // { user, at } 恢复后待慢速判定
    lastActions: [],      // 最近动作日志（内存，summary 展示）
  };

  const act = (line) => {
    state.lastActions.unshift(`${new Date(now().getTime() + 8 * 3600 * 1000).toISOString().slice(11, 19)} ${line}`);
    if (state.lastActions.length > 20) state.lastActions.length = 20;
    console.log(`[wanGuard] ${line}`);
  };

  /** 健康期采样基线（wan up 时由主循环调用） */
  async function sampleBaseline() {
    const ms = await probeLatency();
    if (ms === null || ms === undefined) return state.baseline;
    state.samples.push(ms);
    if (state.samples.length > BASELINE_SAMPLES) state.samples.shift();
    state.baseline = Math.max(BASELINE_FLOOR_MS, median(state.samples));
    return state.baseline;
  }

  async function startRevive(reason) {
    const list = candidates();
    if (!list.length) {
      // 池空=体系失能：进 30 分钟冷却（同 exhausted）——否则每个 tick 都重发一次
      // revive_no_candidates（2026-09-28 刷屏事故：残留进程空池每分钟轰炸通知群）
      state.reviving = false;
      state.exhaustedUntil = now().getTime() + EXHAUSTED_COOLDOWN_MS;
      await emit('revive_no_candidates', `账号池全空或当月全弃用（${reason}），30 分钟后自动重试`);
      return;
    }
    state.reviving = true;
    state.queue = list.slice();
    state.current = null;
    state.roundStartedAt = now().getTime();
    await emit('revive_start', `断网复活启动（${reason}）：候选 ${list.map((a) => a.user).join(' → ')}`);
    await tryNextCandidate();
  }

  async function tryNextCandidate() {
    const acct = state.queue.shift();
    if (!acct) {
      state.reviving = false;
      state.exhaustedUntil = now().getTime() + EXHAUSTED_COOLDOWN_MS;
      await emit('revive_exhausted', `账号池用尽仍未能恢复，${EXHAUSTED_COOLDOWN_MS / 60000} 分钟后自动重试（期间可手动触发）`);
      return;
    }
    state.current = acct;
    const ip = await authIp();
    try {
      const res = await login({ user: acct.user, password: acct.password, authIp: ip });
      // eportal 响应 msg 极具诊断价值（如「IP 已经在线」=请求有效但 IP 已放行，断网场景不会出现）——记入动作日志
      const msg = res && res.data && res.data.msg ? res.data.msg : (res && res.raw ? res.raw.slice(0, 60) : 'no-resp');
      act(`login ${acct.user} (authIp=${ip || '?'}) → ${msg}`);
    } catch (err) {
      act(`login ${acct.user} 请求异常: ${err.message}`);
    }
    // 成败交给下一个 tick 的 wan 验证（Portal 放行通常秒级生效）
  }

  /** 慢速判定：恢复后宽限 → 3 次探针中位数 > 基线×3 → 限速弃用并换号 */
  async function slowCheck(user) {
    const waited = now().getTime() - state.pendingSlow.at;
    if (waited < RECOVER_GRACE_MS) return; // 宽限期内，下个 tick 再判
    const probes = [];
    for (let i = 0; i < SLOW_PROBE_COUNT; i++) {
      const ms = await probeLatency();
      if (ms !== null && ms !== undefined) probes.push(ms);
      if (i < SLOW_PROBE_COUNT - 1) await new Promise((r) => setTimeout(r, SLOW_PROBE_GAP_MS));
    }
    const m = median(probes);
    const base = state.baseline;
    if (probes.length < 2) {
      act(`慢速判定样本不足（${probes.length}），跳过判定 ${user}`);
    } else if (m > base * SLOW_FACTOR) {
      await ban(user, 'slow-throttled');
      await emit('account_throttled', `账号 ${user} 疑似被限速（探针中位 ${m}ms > 基线 ${base}ms ×3），已打「本月不再使用」`);
      // 立即换号：剩余候选还有就继续复活，否则收摊（网络已通，只是账号慢）
      if (candidates().length) {
        await emit('revive_start', `换号复活：弃用 ${user} 后重新走账号池`);
        state.reviving = true;
        state.queue = candidates();
        await tryNextCandidate();
        return;
      }
    } else {
      act(`慢速判定通过：${user} 探针中位 ${m}ms ≤ 基线 ${base}ms×3`);
    }
    state.pendingSlow = null;
  }

  /**
   * 主循环每 tick 调用。
   * @param {boolean} wanOk 当轮原始探测结果（engine 传入；有意不用防抖态——抢在
   *   2 轮防抖判定前自愈，单轮抖动也会触发复活，由 eportal 应答与池冷却兜底）
   * @param {boolean} lanOk lan 状态（lan 断=路由器问题，登录无意义，不复活）
   */
  async function onTick(wanOk, lanOk) {
    // 慢速判定挂起中（网络已恢复）
    if (state.pendingSlow && wanOk) {
      await slowCheck(state.pendingSlow.user);
      return;
    }

    if (state.reviving) {
      if (wanOk) {
        const user = state.current ? state.current.user : '?';
        state.reviving = false;
        act(`wan 恢复（账号 ${user}），进入慢速判定`);
        state.pendingSlow = { user, at: now().getTime() };
        await emit('revive_success', `复活成功：账号 ${user} 认证后网络恢复，${Math.round((now().getTime() - state.roundStartedAt) / 1000)}s 内完成`);
        return;
      }
      // 还没恢复：当前账号给过一个 tick 的验证机会后换下一个
      if (state.current) {
        act(`${state.current.user} 登录后 wan 仍未恢复，换下一个候选`);
        state.current = null;
      }
      await tryNextCandidate();
      return;
    }

    // 非复活态：wan 断 + lan 活 + 非冷却 → 启动复活
    if (!wanOk && lanOk && now().getTime() >= state.exhaustedUntil) {
      await startRevive(`wan 断且 lan 正常`);
    }
  }

  /** 手动触发（管理端点用）：无条件重启复活流程（网络已通时也执行，供实测协议） */
  async function forceRevive() {
    state.reviving = false;
    state.pendingSlow = null;
    state.exhaustedUntil = 0;
    await startRevive('手动触发');
  }

  function summary() {
    return {
      reviving: state.reviving,
      currentUser: state.current ? state.current.user : null,
      queueRemaining: state.reviving ? state.queue.map((a) => a.user) : [], // 非复活态不展示残留队列
      baseline: state.baseline,
      exhaustedUntil: state.exhaustedUntil ? new Date(state.exhaustedUntil + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ') + '+08:00' : null,
      pendingSlow: state.pendingSlow ? state.pendingSlow.user : null,
      lastActions: state.lastActions,
    };
  }

  return { onTick, sampleBaseline, forceRevive, summary, state };
}

module.exports = { createWanGuard, median, BASELINE_FLOOR_MS, SLOW_FACTOR };
