/**
 * wanGuard —— netlog v2 断网复活引擎（协议无关状态机，依赖注入可测）
 *
 * 职责（曼波 2026-09-27 三项设计 + v9 流量探测扩展）：
 *   ①复活强化：wan 断或「握手通但流量断（软踢/限速）」（当轮原始信号，抢在防抖判定前自愈）
 *     + lan 活 → 按账号池顺序逐个调 eportal login，
 *     每个 tick 尝试一个账号，wan+traffic 真恢复才算成功；全用尽 → 通知 + 30 分钟冷却重试；
 *   ①.5 被抢持续垫底（v18，曼波 2026-10-07 定「首选只是优先不是拉锯」）：复活成功后
 *     30 分钟内又掉线 = 该账号被别人抢——持久垫底 kickDemoteHours 小时（默认 24h，
 *     accountPool 垫底 store 持久化、跨重启保留），换下一个账号；到期自动复位，
 *     若仍被抢再次命中检测继续垫底（自适应）。检测窗口 30 分钟不变（判定依据）；
 *     窗口外的新掉线（无法判定被抢）仍按优先级首选开始。未注入 demote 时退化旧语义
 *     （仅本轮排队尾）。
 *   ②首选项：31108753 永远先试（accountPool.listCandidates 已保证）；
 *   ③慢速降级：复活恢复后 20s 宽限 → 连 3 次探针取中位数，超过健康基线 3 倍
 *     → 判该账号被限速 → 打「本月不再使用」→ 自动换下一个账号复活。
 *   ④成功判定核会话归属（v12）：复活成功前用 online_list 验证当前账号真在线——
 *     出口本通（TCP 代答/他人会话放行）时 login 被「IP 已经在线」拒而 wan 探测照样过，
 *     不核归属会把假阳性记成复活成功（2026-10-05 05:28 事故）；归属非本账号 →
 *     revive_session_mismatch 终止本轮（换号无效，需人工核对）。
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
const KICK_ROTATE_WINDOW_MS = 30 * 60 * 1000; // 被抢判定窗口：复活成功后 30 分钟内又掉线=账号被抢（判定依据不变）
const DEFAULT_KICK_DEMOTE_HOURS = 24; // 被抢垫底时长（v18）：24h 内持续避开，到期自动复位首选

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * @param {object} deps
 *   candidates() → [{user,password,priority}] 当前可用账号（弃用已滤；组装层按垫底状态重排）
 *   authIp() → Promise<string|null> 要放行的 IP（主路由 WAN IP）
 *   login({user,password,authIp}) → Promise 登录请求（成败由 wan 验证裁决）
 *   probeLatency() → Promise<number|null> 单次探测延迟 ms（失败 null）
 *   verifySession(user) → Promise<boolean> online_list 会话归属核验（v12：user 在线=true；
 *     无会话/他人会话=false；异常抛出由 guard 捕获降级）——未注入时退化为按 wan 探测放行
 *   ban(user, reason) → 打当月弃用
 *   [demote(user, hours, reason)] → 被抢垫底（v18；未注入=退化为本轮排队尾旧语义）
 *   [demotions()] → 当前垫底列表（summary 展示）
 *   [kickDemoteHours] → 垫底时长，默认 24
 *   emit(event, detail) → 事件上报（engine 的 record+notify）
 *   now() → Date；tickMs 探测周期
 */
function createWanGuard(deps) {
  const { candidates, authIp, login, probeLatency, verifySession, ban, emit, demote, demotions, kickDemoteHours = DEFAULT_KICK_DEMOTE_HOURS, now = () => new Date(), tickMs = 60000 } = deps;

  const state = {
    reviving: false,
    queue: [],            // 本轮复活剩余候选
    current: null,        // 当前已 login、待验证的账号
    roundStartedAt: 0,
    exhaustedUntil: 0,
    baseline: BASELINE_FLOOR_MS,
    samples: [],          // 健康期延迟样本
    pendingSlow: null,    // { user, at } 恢复后待慢速判定
    lastRevive: null,     // { user, at } 最近一次复活成功的账号与时刻（近期被踢轮换依据）
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
    let list = candidates();
    if (!list.length) {
      // 池空=体系失能：进 30 分钟冷却（同 exhausted）——否则每个 tick 都重发一次
      // revive_no_candidates（2026-09-28 刷屏事故：残留进程空池每分钟轰炸通知群）
      state.reviving = false;
      state.exhaustedUntil = now().getTime() + EXHAUSTED_COOLDOWN_MS;
      await emit('revive_no_candidates', `账号池全空或当月全弃用（${reason}），30 分钟后自动重试`);
      return;
    }
    // 被抢持续垫底（v18，曼波定「首选只是优先不是拉锯」）：复活成功后短时间内又掉线 =
    // 该账号有别人在抢——持久垫底（默认 24h）换其它账号，不再跟人对拍；到期自动复位，
    // 仍被抢会再次命中检测继续垫底。窗口外的新掉线（无法判定被抢）仍按优先级首选开始。
    let kickNote = '';
    const lr = state.lastRevive;
    if (lr && lr.user && now().getTime() - lr.at < KICK_ROTATE_WINDOW_MS && list.some((a) => a.user === lr.user)) {
      if (typeof demote === 'function') {
        await demote(lr.user, kickDemoteHours, 'kicked');
        await emit('account_demoted', `账号 ${lr.user} 疑被抢（复活成功 ${Math.max(1, Math.round((now().getTime() - lr.at) / 60000))} 分钟后又掉线），已垫底 ${kickDemoteHours} 小时——本轮起换其它账号，到期自动复位（池文件独立状态 account-demotions.json）`);
        kickNote = `；上次 ${lr.user} 刚被踢，已垫底 ${kickDemoteHours}h（换号避开）`;
      } else if (list.length > 1) {
        // 未注入垫底（旧桩/降级）：保持 v10 旧语义——仅本轮排队尾
        const idx = list.findIndex((a) => a.user === lr.user);
        list = list.slice(idx + 1).concat(list.slice(0, idx + 1));
        kickNote = `；上次 ${lr.user} 刚被踢，本轮轮换避开（排最后）`;
      }
    }
    if (typeof demote === 'function') list = candidates(); // 垫底已落盘：重取组装层排序后的候选
    state.reviving = true;
    state.queue = list.slice();
    state.current = null;
    state.pendingSlow = null; // 新一轮复活开始：上一会话的慢速判定作废（否则吞掉本轮 success 一个 tick）
    state.roundStartedAt = now().getTime();
    await emit('revive_start', `断网复活启动（${reason}${kickNote}）：候选 ${list.map((a) => a.user).join(' → ')}`);
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
        // 2026-10-10 修复：换号分支必须先清 pendingSlow——原样 return 会把挂起
        // 判定留在旧被 ban 账号上，下个 tick 的 slowCheck 优先执行：重复 ban、
        // 重复发事件、并对同一替号账号每 tick 重复 login，替号永不进入成功验证
        state.pendingSlow = null;
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
   * @param {boolean} [trafficOk=true] 当轮原始流量探测（v9：HTTP generate_204 全链路；
   *   TCP 握手通但流量断=软踢/限速，重新认证换号可救——2026-10-04 曼波实况）
   */
  async function onTick(wanOk, lanOk, trafficOk = true) {
    // 慢速判定挂起中（网络已恢复）
    if (state.pendingSlow && wanOk && trafficOk) {
      await slowCheck(state.pendingSlow.user);
      return;
    }

    if (state.reviving) {
      if (wanOk && trafficOk) {
        const user = state.current ? state.current.user : '?';
        // v12 成功判定核会话归属：出口本通时（TCP 代答假阴性 / IP 已被其它账号放行），
        // login 会被「IP 已经在线」拒绝而 wan 探测照样通过——「复活成功」是假阳性
        // （2026-10-05 05:28 事故实锤）。归属核验通过才算真复活。
        let mine = null;
        if (typeof verifySession === 'function') {
          try {
            mine = await verifySession(user);
          } catch (err) {
            act(`会话归属验证异常（${err.message}），按 wan 探测降级放行`);
          }
        }
        if (mine === false) {
          // 冷却防刷屏：出口本通时 onTick 的触发条件不满足，但「断网+IP 被占」组合下
          // 每轮都会重启复活又立刻 mismatch——挂 30 分钟冷却，给人工介入窗口
          state.reviving = false;
          state.exhaustedUntil = now().getTime() + EXHAUSTED_COOLDOWN_MS;
          await emit('revive_session_mismatch', `出口恢复但在线会话归属非 ${user}（IP 已被其它账号放行，换号无效，本轮终止，30 分钟后自动重试）。人工核对/换号 SOP：qianli-lab-network skill §十二.1`);
          return;
        }
        if (mine === null && typeof verifySession === 'function') {
          act(`会话归属未确认（接口异常），账号 ${user} 按 wan 探测降级放行`);
        }
        state.reviving = false;
        act(`wan 恢复（账号 ${user}），进入慢速判定`);
        state.pendingSlow = { user, at: now().getTime() };
        state.lastRevive = { user, at: now().getTime() };
        await emit('revive_success', `复活成功：账号 ${user} 认证后网络恢复，${Math.round((now().getTime() - state.roundStartedAt) / 1000)}s 内完成`);
        return;
      }
      // 还没恢复：当前账号给过一个 tick 的验证机会后换下一个
      if (state.current) {
        act(`${state.current.user} 登录后仍未恢复（wan=${wanOk} traffic=${trafficOk}），换下一个候选`);
        state.current = null;
      }
      await tryNextCandidate();
      return;
    }

    // 非复活态：wan 断（或握手通但流量断=软踢）+ lan 活 + 非冷却 → 启动复活
    if ((!wanOk || !trafficOk) && lanOk && now().getTime() >= state.exhaustedUntil) {
      await startRevive(wanOk
        ? 'wan 握手通但流量探测失败（软踢/限速嫌疑），lan 正常'
        : 'wan 断且 lan 正常');
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
      lastRevive: state.lastRevive ? { user: state.lastRevive.user, at: new Date(state.lastRevive.at + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ') + '+08:00' } : null,
      demotions: typeof demotions === 'function' ? demotions() : [], // v18：当前垫底中的账号（summary 可观测）
      lastActions: state.lastActions,
    };
  }

  return { onTick, sampleBaseline, forceRevive, summary, state };
}

module.exports = { createWanGuard, median, BASELINE_FLOOR_MS, SLOW_FACTOR };
